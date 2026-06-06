/**
 * Thin WebSocket client to the Worker (Lobby + GameRoom Durable Objects).
 * Auto-reconnects with backoff. Typed via the shared protocol shapes.
 */
import type {
  LobbyClientMsg,
  LobbyServerMsg,
  RoomClientMsg,
  RoomServerMsg,
} from '@/lib/net/protocol';

export const WS_BASE =
  process.env.NEXT_PUBLIC_WS_URL ?? 'wss://billiard-worker.example.workers.dev';

type Listener<T> = (msg: T) => void;

class Channel<TServer, TClient> {
  private ws: WebSocket | null = null;
  private url: string;
  private listeners = new Set<Listener<TServer>>();
  private openListeners = new Set<() => void>();
  private closeListeners = new Set<() => void>();
  private queue: TClient[] = [];
  private retries = 0;
  private closed = false;

  constructor(url: string) {
    this.url = url;
  }

  connect() {
    this.closed = false;
    this.open();
  }

  private open() {
    if (typeof window === 'undefined') return;
    const ws = new WebSocket(this.url);
    this.ws = ws;

    ws.onopen = () => {
      this.retries = 0;
      for (const m of this.queue) ws.send(JSON.stringify(m));
      this.queue = [];
      this.openListeners.forEach((l) => l());
    };
    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data) as TServer;
        this.listeners.forEach((l) => l(msg));
      } catch {
        /* ignore malformed frames */
      }
    };
    ws.onclose = () => {
      this.closeListeners.forEach((l) => l());
      if (!this.closed) {
        const delay = Math.min(1000 * 2 ** this.retries, 10_000);
        this.retries++;
        setTimeout(() => this.open(), delay);
      }
    };
    ws.onerror = () => ws.close();
  }

  send(msg: TClient) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    } else {
      this.queue.push(msg);
    }
  }

  on(l: Listener<TServer>) {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }
  onOpen(l: () => void) {
    this.openListeners.add(l);
    return () => this.openListeners.delete(l);
  }
  onClose(l: () => void) {
    this.closeListeners.add(l);
    return () => this.closeListeners.delete(l);
  }

  close() {
    this.closed = true;
    this.ws?.close();
    this.ws = null;
  }
}

export function connectLobby() {
  const ch = new Channel<LobbyServerMsg, LobbyClientMsg>(`${WS_BASE}/lobby`);
  ch.connect();
  return ch;
}

export function connectRoom(roomId: string) {
  const ch = new Channel<RoomServerMsg, RoomClientMsg>(
    `${WS_BASE}/room/${encodeURIComponent(roomId)}`,
  );
  ch.connect();
  return ch;
}

export type LobbyChannel = ReturnType<typeof connectLobby>;
export type RoomChannel = ReturnType<typeof connectRoom>;

/** Read-only stats fetch (Worker exposes GET /stats and /stats/:address). */
export async function fetchStats(address?: string) {
  const httpBase = WS_BASE.replace(/^ws/, 'http');
  const url = address ? `${httpBase}/stats/${address}` : `${httpBase}/stats`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`stats fetch failed: ${res.status}`);
  return res.json();
}
