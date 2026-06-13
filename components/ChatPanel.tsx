'use client';

import { useEffect, useRef, useState } from 'react';
import type { Address } from 'viem';
import type { ChatMessage, Conversation } from '@/lib/xmtp/useXmtp';
import { Avatar } from './Avatar';
import { Spinner } from './ui/Spinner';

type Peer = { address: Address; display: string; avatar: string | null };

// Quick-tap emojis for pool banter — no heavy picker dependency.
const EMOJIS = ['👍', '🔥', '😂', '🎱', '😮', '😅', '🤝', '👏', '🙌', '💪', '😎', '🫡', '🎯', '😭', '🤯', '❤️'];

/** A single XMTP DM thread with a peer. Manages history + live stream. */
export function ChatPanel({
  peer,
  openConversation,
  compact = false,
}: {
  peer: Peer;
  openConversation: (peer: Address, onMessage: (m: ChatMessage) => void) => Promise<Conversation>;
  compact?: boolean;
}) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState<string | null>(null);
  const [showEmoji, setShowEmoji] = useState(false);
  const convRef = useRef<Conversation | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  // IDs we've already rendered (incl. our own optimistic sends) so the live
  // stream — which echoes back your own messages — never double-posts them.
  const seenRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    let alive = true;
    setMessages([]);
    setStatus('loading');
    setError(null);
    seenRef.current = new Set();

    const onMessage = (m: ChatMessage) => {
      if (!alive || seenRef.current.has(m.id)) return;
      seenRef.current.add(m.id);
      setMessages((prev) => {
        // If this is the stream echo of one of our own optimistic sends,
        // reconcile it in place (match by text) instead of posting a duplicate —
        // robust even if send() didn't hand back the real message id.
        if (m.mine) {
          const i = prev.findIndex((p) => p.id.startsWith('tmp-') && p.text === m.text);
          if (i !== -1) {
            const copy = prev.slice();
            copy[i] = m;
            return copy;
          }
        }
        return [...prev, m].sort((a, b) => Number(a.sentAtNs - b.sentAtNs));
      });
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
    setShowEmoji(false);
    // Optimistic echo: show it immediately, dedupe the stream copy by real id.
    const tempId = `tmp-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    seenRef.current.add(tempId);
    const optimistic: ChatMessage = {
      id: tempId,
      text,
      sentAtNs: BigInt(Date.now()) * 1_000_000n,
      mine: true,
    };
    setMessages((prev) => [...prev, optimistic]);
    try {
      const realId = await convRef.current.send(text);
      if (realId) {
        seenRef.current.add(realId);
        setMessages((prev) => prev.map((m) => (m.id === tempId ? { ...m, id: realId } : m)));
      }
    } catch {
      setError('Message failed to send.');
    }
  };

  const addEmoji = (e: string) => {
    setDraft((d) => d + e);
    inputRef.current?.focus();
  };

  const pad = compact ? 'px-3 py-2.5' : 'px-4 py-3';

  return (
    <div
      className={
        'flex flex-col rounded-2xl border border-ink-line bg-ink-card/60 ' +
        (compact ? 'h-full min-h-[320px]' : 'h-[460px]')
      }
    >
      <div className={'flex items-center gap-2.5 border-b border-ink-line ' + pad}>
        <Avatar address={peer.address} avatar={peer.avatar} size={compact ? 28 : 34} />
        <div className="min-w-0">
          <p className={'truncate font-600 text-zinc-100 ' + (compact ? 'text-[13px]' : 'text-sm')}>
            {peer.display}
          </p>
          <p className="flex items-center gap-1.5 text-[11px] text-zinc-500">
            <span
              className={
                'h-1.5 w-1.5 rounded-full ' +
                (status === 'ready' ? 'bg-sage-bright' : status === 'loading' ? 'bg-brass' : 'bg-zinc-600')
              }
            />
            {status === 'ready' ? 'Encrypted · XMTP' : status === 'loading' ? 'Connecting…' : 'Unavailable'}
          </p>
        </div>
      </div>

      <div ref={scrollRef} className={'no-scrollbar flex-1 space-y-1.5 overflow-y-auto ' + pad}>
        {status === 'loading' && (
          <div className="grid h-full place-items-center text-zinc-500">
            <Spinner size={20} />
          </div>
        )}
        {status === 'error' && (
          <div className="grid h-full place-items-center px-4 text-center text-sm text-zinc-400">
            {error}
          </div>
        )}
        {status === 'ready' && messages.length === 0 && (
          <div className="grid h-full place-items-center px-4 text-center text-sm text-zinc-600">
            Say hi 👋 — talk a little trash.
          </div>
        )}
        {messages.map((m) => (
          <div key={m.id} className={'flex ' + (m.mine ? 'justify-end' : 'justify-start')}>
            <span
              className={
                'max-w-[82%] break-words rounded-2xl px-3 py-1.5 ' +
                (compact ? 'text-[13px]' : 'text-sm') +
                ' ' +
                (m.mine
                  ? 'rounded-br-sm bg-sage text-ink'
                  : 'rounded-bl-sm bg-blue-600 text-white')
              }
            >
              {m.text}
            </span>
          </div>
        ))}
      </div>

      {/* Emoji tray */}
      {showEmoji && status === 'ready' && (
        <div className="grid grid-cols-8 gap-0.5 border-t border-ink-line px-2 py-2">
          {EMOJIS.map((e) => (
            <button
              key={e}
              type="button"
              onClick={() => addEmoji(e)}
              className="rounded-lg py-1 text-lg transition hover:bg-white/10"
              aria-label={`Add ${e}`}
            >
              {e}
            </button>
          ))}
        </div>
      )}

      <div className={'flex items-center gap-1.5 border-t border-ink-line ' + (compact ? 'p-2' : 'p-3')}>
        <button
          type="button"
          onClick={() => setShowEmoji((v) => !v)}
          disabled={status !== 'ready'}
          className="shrink-0 rounded-lg px-2 py-2 text-lg leading-none text-zinc-400 transition hover:bg-white/10 hover:text-zinc-100 disabled:opacity-40"
          aria-label="Emojis"
          title="Emojis"
        >
          😊
        </button>
        <input
          ref={inputRef}
          value={draft}
          disabled={status !== 'ready'}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && send()}
          placeholder={status === 'ready' ? 'Message…' : 'Chat unavailable'}
          className="min-w-0 flex-1 rounded-xl border border-ink-line bg-[#0e1512] px-3 py-2 text-sm outline-none placeholder:text-zinc-600 disabled:opacity-50"
        />
        <button
          onClick={send}
          disabled={status !== 'ready' || !draft.trim()}
          className="shrink-0 rounded-xl bg-sage px-3.5 py-2 text-sm font-600 text-ink transition hover:bg-sage-bright disabled:opacity-40"
        >
          Send
        </button>
      </div>
    </div>
  );
}
