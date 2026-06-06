'use client';

import { useEffect, useRef, useState } from 'react';
import type { Address } from 'viem';
import type { ChatMessage, Conversation } from '@/lib/xmtp/useXmtp';
import { Avatar } from './Avatar';
import { Spinner } from './ui/Spinner';

type Peer = { address: Address; display: string; avatar: string | null };

/** A single XMTP DM thread with a peer. Manages history + live stream. */
export function ChatPanel({
  peer,
  openConversation,
}: {
  peer: Peer;
  openConversation: (peer: Address, onMessage: (m: ChatMessage) => void) => Promise<Conversation>;
}) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState<string | null>(null);
  const convRef = useRef<Conversation | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let alive = true;
    setMessages([]);
    setStatus('loading');
    setError(null);

    const seen = new Set<string>();
    const onMessage = (m: ChatMessage) => {
      if (!alive || seen.has(m.id)) return;
      seen.add(m.id);
      setMessages((prev) => [...prev, m].sort((a, b) => Number(a.sentAtNs - b.sentAtNs)));
    };

    openConversation(peer.address, onMessage)
      .then((conv) => {
        if (!alive) {
          conv.close();
          return;
        }
        convRef.current = conv;
        setStatus('ready');
      })
      .catch((e) => {
        if (alive) {
          setError(e instanceof Error ? e.message : 'Could not open chat');
          setStatus('error');
        }
      });

    return () => {
      alive = false;
      convRef.current?.close();
      convRef.current = null;
    };
  }, [peer.address, openConversation]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages]);

  const send = async () => {
    const text = draft.trim();
    if (!text || !convRef.current) return;
    setDraft('');
    try {
      await convRef.current.send(text);
    } catch {
      setError('Message failed to send.');
    }
  };

  return (
    <div className="flex h-[460px] flex-col rounded-2xl border border-ink-line bg-ink-card/60">
      <div className="flex items-center gap-3 border-b border-ink-line px-4 py-3">
        <Avatar address={peer.address} avatar={peer.avatar} size={34} />
        <div>
          <p className="text-sm font-600 text-zinc-100">{peer.display}</p>
          <p className="text-xs text-zinc-500">
            {status === 'ready' ? 'Encrypted via XMTP' : status === 'loading' ? 'Connecting…' : 'Unavailable'}
          </p>
        </div>
      </div>

      <div ref={scrollRef} className="no-scrollbar flex-1 space-y-2 overflow-y-auto px-4 py-3">
        {status === 'loading' && (
          <div className="grid h-full place-items-center text-zinc-500">
            <Spinner size={20} />
          </div>
        )}
        {status === 'error' && (
          <div className="grid h-full place-items-center px-6 text-center text-sm text-zinc-400">
            {error}
          </div>
        )}
        {status === 'ready' && messages.length === 0 && (
          <div className="grid h-full place-items-center text-sm text-zinc-600">
            Say hi 👋 — challenge them to a game.
          </div>
        )}
        {messages.map((m) => (
          <div key={m.id} className={'flex ' + (m.mine ? 'justify-end' : 'justify-start')}>
            <span
              className={
                'max-w-[78%] rounded-2xl px-3.5 py-2 text-sm ' +
                (m.mine
                  ? 'rounded-br-sm bg-sage text-ink'
                  : 'rounded-bl-sm bg-ink-soft text-zinc-100')
              }
            >
              {m.text}
            </span>
          </div>
        ))}
      </div>

      <div className="flex items-center gap-2 border-t border-ink-line p-3">
        <input
          value={draft}
          disabled={status !== 'ready'}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && send()}
          placeholder={status === 'ready' ? 'Message…' : 'Chat unavailable'}
          className="flex-1 rounded-xl border border-ink-line bg-[#0e1512] px-3.5 py-2.5 text-sm outline-none placeholder:text-zinc-600 disabled:opacity-50"
        />
        <button
          onClick={send}
          disabled={status !== 'ready' || !draft.trim()}
          className="rounded-xl bg-sage px-4 py-2.5 text-sm font-600 text-ink transition hover:bg-sage-bright disabled:opacity-40"
        >
          Send
        </button>
      </div>
    </div>
  );
}
