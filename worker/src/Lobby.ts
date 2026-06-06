/**
 * Lobby Durable Object (singleton): presence + signed-challenge routing +
 * matchmaking. When a challenge is accepted, allocates a room id and tells
 * both clients to join the GameRoom.
 */
import { verifyChallenge } from '@/lib/crypto/sign';
import type {
  LobbyClientMsg,
  LobbyServerMsg,
  PlayerInfo,
  Signed,
  ChallengePayload,
} from '@/lib/net/protocol';

type Conn = { ws: WebSocket; player: PlayerInfo };

export class Lobby {
  private conns = new Map<string, Conn>(); // key: lowercased address
  // Pending outgoing challenges by nonce → challenger address.
  private pending = new Map<string, { from: string; to: string }>();

  constructor(
    private state: DurableObjectState,
    private env: unknown,
  ) {}

  async fetch(req: Request): Promise<Response> {
    if (req.headers.get('Upgrade') !== 'websocket') {
      return new Response('expected websocket', { status: 426 });
    }
    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];
    server.accept();
    this.wire(server);
    return new Response(null, { status: 101, webSocket: client });
  }

  private wire(ws: WebSocket) {
    let key: string | null = null;

    ws.addEventListener('message', async (ev) => {
      let msg: LobbyClientMsg;
      try {
        msg = JSON.parse(ev.data as string);
      } catch {
        return;
      }

      switch (msg.t) {
        case 'hello': {
          key = msg.player.address.toLowerCase();
          this.conns.set(key, { ws, player: msg.player });
          this.broadcastPresence();
          break;
        }
        case 'challenge': {
          await this.routeChallenge(msg.signed);
          break;
        }
        case 'accept': {
          this.routeAccept(msg.nonce, msg.signed);
          break;
        }
        case 'decline': {
          const p = this.pending.get(msg.nonce);
          if (p) {
            this.sendTo(p.from, { t: 'declined', nonce: msg.nonce });
            this.pending.delete(msg.nonce);
          }
          break;
        }
        case 'ping':
          this.send(ws, { t: 'pong' });
          break;
      }
    });

    ws.addEventListener('close', () => {
      if (key) {
        this.conns.delete(key);
        this.broadcastPresence();
      }
    });
    ws.addEventListener('error', () => {
      if (key) {
        this.conns.delete(key);
        this.broadcastPresence();
      }
    });
  }

  private async routeChallenge(signed: Signed<ChallengePayload>) {
    // Verify the signature server-side too — proves who issued it.
    const ok = await verifyChallenge(signed.payload, signed.signature);
    if (!ok) return;
    const to = signed.payload.opponent.toLowerCase();
    const from = signed.payload.challenger.toLowerCase();
    this.pending.set(signed.payload.nonce, { from, to });
    this.sendTo(to, { t: 'incoming', signed });
  }

  private routeAccept(nonce: string, signed: Signed<ChallengePayload>) {
    const p = this.pending.get(nonce);
    if (!p) return;
    this.pending.delete(nonce);

    const roomId = `${nonce.slice(2, 14)}-${Date.now().toString(36)}`;
    const a = this.conns.get(p.from); // challenger breaks
    const b = this.conns.get(p.to);
    if (a) {
      this.send(a.ws, {
        t: 'matched',
        roomId,
        opponent: b?.player ?? fallback(p.to),
        youBreak: true,
      });
    }
    if (b) {
      this.send(b.ws, {
        t: 'matched',
        roomId,
        opponent: a?.player ?? fallback(p.from),
        youBreak: false,
      });
    }
  }

  private broadcastPresence() {
    const players = [...this.conns.values()].map((c) => c.player);
    const msg: LobbyServerMsg = { t: 'presence', players };
    for (const c of this.conns.values()) this.send(c.ws, msg);
  }

  private sendTo(addr: string, msg: LobbyServerMsg) {
    const c = this.conns.get(addr.toLowerCase());
    if (c) this.send(c.ws, msg);
  }

  private send(ws: WebSocket, msg: LobbyServerMsg) {
    try {
      ws.send(JSON.stringify(msg));
    } catch {
      /* socket closing */
    }
  }
}

function fallback(addr: string): PlayerInfo {
  return { address: addr as `0x${string}`, ensName: null, avatar: null };
}
