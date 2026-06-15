'use client';

import { useCallback, useEffect, useState } from 'react';
import { useAccount, useSignMessage } from 'wagmi';
import { toBytes, type Address } from 'viem';

/**
 * XMTP messaging (browser-sdk v7, MLS).
 *
 * The SDK ships WebAssembly + a web worker and must run client-side only, so it
 * is loaded via dynamic `import()` — never at module scope — to keep it out of
 * the static-export prerender.
 *
 * The created client is a MODULE-LEVEL SINGLETON shared by every component/page
 * (play, profile, …) so the user enables messaging ONCE per session — enabling
 * on the play page also enables it on the profile page, and we never create more
 * than one XMTP "installation" per session.
 */
export type ChatMessage = {
  id: string;
  text: string;
  sentAtNs: bigint;
  mine: boolean;
};

export type Conversation = {
  send: (text: string) => Promise<string>;
  close: () => void;
};

// The SDK types are heavy/generic; we keep the client as unknown and narrow at
// the call sites to avoid leaking wasm types into the static bundle's surface.
type XmtpStream = { end?: () => void; return?: () => void };
type XmtpClient = {
  inboxId: string;
  canMessage: (ids: { identifier: string; identifierKind: number }[]) => Promise<Map<string, boolean>>;
  conversations: {
    // Pull the conversation list (welcomes/new DMs) from the network.
    sync: () => Promise<void>;
    // Pull every conversation AND its messages from the network.
    syncAll: () => Promise<void>;
    createDmWithIdentifier: (id: { identifier: string; identifierKind: number }) => Promise<XmtpDm>;
    getConversationById: (id: string) => Promise<XmtpConversation | undefined>;
    getDmByInboxId: (inboxId: string) => Promise<XmtpDm | undefined>;
    // Client-level stream: delivers messages from ANY conversation, including
    // duplicate / freshly-joined DM groups a per-DM stream would miss.
    streamAllMessages: (opts: { onValue?: (m: XmtpMessage) => void }) => Promise<XmtpStream>;
  };
};
type XmtpConversation = {
  id: string;
  messages: () => Promise<XmtpMessage[]>;
  sendText: (text: string) => Promise<string>;
};
type XmtpDm = XmtpConversation & {
  peerInboxId: () => Promise<string>;
  duplicateDms: () => Promise<XmtpDm[]>;
};
type XmtpMessage = {
  id: string;
  content: unknown;
  senderInboxId: string;
  sentAtNs: bigint;
  conversationId: string;
};

// Building the XMTP client occasionally stalls before the wallet ever shows the
// signature prompt (a lost WalletConnect request, an OPFS/IndexedDB lock held by
// another open tab, or an unsupported wallet). Without a deadline the UI sits on
// "Enabling…" forever, so we race the build against this timeout.
const ENABLE_TIMEOUT_MS = 60_000;
const ENABLE_TIMEOUT_MSG =
  'Enabling timed out. Check your wallet for a pending signature request, close any other billiard.eth tabs, then try again.';

function withTimeout<T>(p: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

// ── Shared singleton state ──────────────────────────────────────────────────
let sharedClient: XmtpClient | null = null;
let sharedAddress = ''; // lowercased wallet address the client was built for
let sharedInboxId = '';
let ethKind = 0; // IdentifierKind.Ethereum
let createPromise: Promise<void> | null = null; // de-dupes concurrent enable()s
const subscribers = new Set<() => void>();
const emit = () => subscribers.forEach((f) => f());

/**
 * Build the XMTP client for `lower`, recovering from the 10-installations-per-
 * inbox limit by revoking the oldest installations and retrying. Sets the shared
 * singletons on success.
 */
async function createClient(
  lower: string,
  signMessageAsync: (args: { message: string }) => Promise<`0x${string}`>,
): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sdk = (await import('@xmtp/browser-sdk')) as any;
  const { Client, IdentifierKind, createBackend, getInboxIdForIdentifier } = sdk;
  ethKind = IdentifierKind.Ethereum;
  const identifier = { identifier: lower, identifierKind: IdentifierKind.Ethereum };
  const signer = {
    type: 'EOA' as const,
    getIdentifier: () => identifier,
    signMessage: async (message: string) => toBytes(await signMessageAsync({ message })),
  };

  let client: XmtpClient;
  try {
    client = (await Client.create(signer, { env: 'production' })) as XmtpClient;
  } catch (e) {
    const msg = `${(e as { message?: string })?.message ?? ''} ${String(e)}`;
    const atLimit =
      /installation/i.test(msg) && /(\d+\/\d+|revoke|limit|already registered)/i.test(msg);
    if (!atLimit) throw e;

    // Inbox is at the 10-installation cap. Free the OLDEST slots (keeping the
    // most recent devices) so a new installation can register, then retry. This
    // requires one extra signature for the revocation.
    const backend = await createBackend({ env: 'production' });
    const inboxId: string | undefined = await getInboxIdForIdentifier(backend, identifier);
    if (!inboxId) throw e;
    const states = await Client.fetchInboxStates([inboxId], backend);
    const installs: { bytes: Uint8Array; clientTimestampNs?: bigint }[] =
      states[0]?.installations ?? [];
    const oldestFirst = [...installs].sort(
      (a, b) => Number((a.clientTimestampNs ?? 0n) - (b.clientTimestampNs ?? 0n)),
    );
    // Keep the 7 newest; revoke the rest (at least one) to leave headroom.
    const toRevoke = oldestFirst.slice(0, Math.max(1, oldestFirst.length - 7)).map((i) => i.bytes);
    if (toRevoke.length) await Client.revokeInstallations(signer, inboxId, toRevoke, backend);
    client = (await Client.create(signer, { env: 'production' })) as XmtpClient;
  }

  sharedClient = client;
  sharedAddress = lower;
  sharedInboxId = client.inboxId;
}

export function useXmtp() {
  const { address } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const lower = address?.toLowerCase() ?? '';

  const isReady = () => !!sharedClient && sharedAddress === lower;
  const [ready, setReady] = useState(isReady());
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Stay in sync with the shared singleton (e.g. enabled on another page).
  useEffect(() => {
    const update = () => setReady(!!sharedClient && sharedAddress === lower);
    subscribers.add(update);
    update();
    return () => {
      subscribers.delete(update);
    };
  }, [lower]);

  const enable = useCallback(async () => {
    if (!address) return;
    const addr = address.toLowerCase();
    if (sharedClient && sharedAddress === addr) {
      setReady(true);
      return;
    }
    // Wallet switched: drop the stale client so we build one for the new inbox.
    if (sharedClient && sharedAddress !== addr) {
      sharedClient = null;
      sharedInboxId = '';
    }
    setConnecting(true);
    setError(null);
    try {
      if (!createPromise) {
        createPromise = createClient(addr, signMessageAsync).finally(() => {
          createPromise = null;
        });
      }
      const pending = createPromise;
      try {
        await withTimeout(pending, ENABLE_TIMEOUT_MS, ENABLE_TIMEOUT_MSG);
      } catch (err) {
        // If this attempt stalled (and is still the in-flight one), drop it so the
        // next enable() builds a fresh client instead of re-awaiting a hung promise.
        if (createPromise === pending) createPromise = null;
        throw err;
      }
      setReady(true);
      emit();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to enable messaging');
    } finally {
      setConnecting(false);
    }
  }, [address, signMessageAsync]);

  /** Open (or create) a DM with `peer`, replay history, and stream new messages. */
  const openConversation = useCallback(
    async (peer: Address, onMessage: (m: ChatMessage) => void): Promise<Conversation> => {
      const client = sharedClient;
      if (!client) throw new Error('Messaging not enabled');
      const identifier = { identifier: peer.toLowerCase(), identifierKind: ethKind };

      const reachable = await client.canMessage([identifier]);
      if (!reachable.get(peer.toLowerCase())) {
        throw new Error('This player has not enabled XMTP messaging yet.');
      }

      // Pull the conversation list from the network FIRST. If the peer already
      // started a DM with us, this receives their welcome so the DM we resolve
      // below joins THEIR group instead of spawning a separate (duplicate) DM
      // that never sees their messages — the root cause of "messages never
      // arrive on the other browser".
      await client.conversations.sync().catch(() => {});

      const dm = await client.conversations.createDmWithIdentifier(identifier);
      const peerInbox = await dm.peerInboxId().catch(() => '');

      // Even after syncing, XMTP can end up with more than one DM group for the
      // same pair (both sides create one before the other's welcome arrives).
      // Messages get split across these groups, so we track EVERY backing group
      // id and read/stream from all of them ("DM stitching").
      const dmIds = new Set<string>([dm.id]);
      const refreshDmIds = async () => {
        try {
          if (peerInbox) {
            const canonical = await client.conversations.getDmByInboxId(peerInbox);
            if (canonical) dmIds.add(canonical.id);
          }
          for (const d of await dm.duplicateDms().catch(() => [])) dmIds.add(d.id);
        } catch {
          /* keep whatever ids we already have */
        }
      };

      const toChat = (m: XmtpMessage): ChatMessage | null =>
        typeof m.content === 'string'
          ? { id: m.id, text: m.content, sentAtNs: m.sentAtNs, mine: m.senderInboxId === sharedInboxId }
          : null;

      const drain = async () => {
        await refreshDmIds();
        for (const id of dmIds) {
          const conv = id === dm.id ? dm : await client.conversations.getConversationById(id);
          if (!conv) continue;
          for (const m of await conv.messages()) {
            const c = toChat(m);
            if (c) onMessage(c);
          }
        }
      };

      // Sync history across all of this peer's DM groups, then replay it.
      await client.conversations.syncAll().catch(() => {});
      await drain();

      // Live stream across ALL conversations: unlike a per-DM stream, this also
      // delivers messages landing in a duplicate / newly-joined DM group. Filter
      // to this peer's group ids; anything that arrives before its id is known is
      // caught by the periodic drain below (deduped by id upstream).
      const stream = await client.conversations.streamAllMessages({
        onValue: (m) => {
          if (!dmIds.has(m.conversationId)) return;
          const c = toChat(m);
          if (c) onMessage(c);
        },
      });

      // Reliability fallback: browser-SDK live streams can silently miss a
      // message (especially the first a peer ever sends, or one in a freshly
      // stitched DM). Periodically pull from the network and replay; everything
      // is deduped by id upstream, so this only surfaces what the stream dropped.
      let stopped = false;
      void (async () => {
        while (!stopped) {
          await new Promise((r) => setTimeout(r, 2500));
          if (stopped) break;
          try {
            await client.conversations.sync().catch(() => {});
            await drain();
          } catch {
            /* transient network/sync error — try again next tick */
          }
        }
      })();

      return {
        send: (text: string) => dm.sendText(text),
        close: () => {
          stopped = true;
          stream.end?.() ?? stream.return?.();
        },
      };
    },
    [],
  );

  return { enable, ready, connecting, error, openConversation };
}
