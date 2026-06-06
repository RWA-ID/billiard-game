'use client';

import { useCallback, useRef, useState } from 'react';
import { useAccount, useSignMessage } from 'wagmi';
import { toBytes, type Address } from 'viem';

/**
 * XMTP messaging (browser-sdk v7, MLS).
 *
 * The SDK ships WebAssembly + a web worker and must run client-side only, so it
 * is loaded via dynamic `import()` inside `enable()` — never at module scope —
 * to keep it out of the static-export prerender. A client is created once the
 * user opts in (one wallet signature), then DMs are opened per peer address.
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
  stream: (opts: { onValue?: (m: XmtpMessage) => void }) => Promise<{ end?: () => void; return?: () => void }>;
};
type XmtpMessage = { id: string; content: unknown; senderInboxId: string; sentAtNs: bigint };

export function useXmtp() {
  const { address } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const clientRef = useRef<XmtpClient | null>(null);
  const inboxIdRef = useRef('');
  const ethKindRef = useRef(0); // IdentifierKind.Ethereum

  const [ready, setReady] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const enable = useCallback(async () => {
    if (!address || clientRef.current) return;
    setConnecting(true);
    setError(null);
    try {
      // The SDK is wasm-backed with heavy generic types; treat the module as
      // loosely typed and narrow to our own minimal XmtpClient surface below.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { Client, IdentifierKind } = (await import('@xmtp/browser-sdk')) as any;
      ethKindRef.current = IdentifierKind.Ethereum;
      const lower = address.toLowerCase();
      const signer = {
        type: 'EOA' as const,
        getIdentifier: () => ({ identifier: lower, identifierKind: IdentifierKind.Ethereum }),
        signMessage: async (message: string) => toBytes(await signMessageAsync({ message })),
      };
      const client = (await Client.create(signer, { env: 'production' })) as XmtpClient;
      clientRef.current = client;
      inboxIdRef.current = client.inboxId;
      setReady(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to enable messaging');
    } finally {
      setConnecting(false);
    }
  }, [address, signMessageAsync]);

  /** Open (or create) a DM with `peer`, replay history, and stream new messages. */
  const openConversation = useCallback(
    async (peer: Address, onMessage: (m: ChatMessage) => void): Promise<Conversation> => {
      const client = clientRef.current;
      if (!client) throw new Error('Messaging not enabled');
      const identifier = { identifier: peer.toLowerCase(), identifierKind: ethKindRef.current };

      const reachable = await client.canMessage([identifier]);
      if (!reachable.get(peer.toLowerCase())) {
        throw new Error('This player has not enabled XMTP messaging yet.');
      }

      const dm = await client.conversations.createDmWithIdentifier(identifier);
      const toChat = (m: XmtpMessage): ChatMessage | null =>
        typeof m.content === 'string'
          ? { id: m.id, text: m.content, sentAtNs: m.sentAtNs, mine: m.senderInboxId === inboxIdRef.current }
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

      return {
        send: (text: string) => dm.sendText(text),
        close: () => stream.end?.() ?? stream.return?.(),
      };
    },
    [],
  );

  return { enable, ready, connecting, error, openConversation };
}
