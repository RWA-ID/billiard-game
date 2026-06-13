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
type XmtpClient = {
  inboxId: string;
  canMessage: (ids: { identifier: string; identifierKind: number }[]) => Promise<Map<string, boolean>>;
  conversations: {
    createDmWithIdentifier: (id: { identifier: string; identifierKind: number }) => Promise<XmtpDm>;
  };
};
type XmtpDm = {
  messages: () => Promise<XmtpMessage[]>;
  sendText: (text: string) => Promise<string>;
  sync?: () => Promise<void>;
  stream: (opts: { onValue?: (m: XmtpMessage) => void }) => Promise<{ end?: () => void; return?: () => void }>;
};
type XmtpMessage = { id: string; content: unknown; senderInboxId: string; sentAtNs: bigint };

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
      await createPromise;
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

      const dm = await client.conversations.createDmWithIdentifier(identifier);
      const toChat = (m: XmtpMessage): ChatMessage | null =>
        typeof m.content === 'string'
          ? { id: m.id, text: m.content, sentAtNs: m.sentAtNs, mine: m.senderInboxId === sharedInboxId }
          : null;

      for (const m of await dm.messages()) {
        const c = toChat(m);
        if (c) onMessage(c);
      }

      const stream = await dm.stream({
        onValue: (m) => {
          const c = toChat(m);
          if (c) onMessage(c);
        },
      });

      // Reliability fallback: browser-SDK live streams can silently miss a
      // message (especially the first one a peer ever sends). Sync the DM from
      // the network and replay its messages every few seconds; everything is
      // deduped by id upstream, so this only surfaces what the stream dropped.
      // Without this, a sent message can show on the sender but not the receiver.
      let stopped = false;
      void (async () => {
        while (!stopped) {
          await new Promise((r) => setTimeout(r, 2500));
          if (stopped) break;
          try {
            await dm.sync?.();
            for (const m of await dm.messages()) {
              const c = toChat(m);
              if (c) onMessage(c);
            }
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
