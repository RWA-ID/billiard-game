/**
 * Cloudflare Worker entry — routes WebSocket upgrades to Durable Objects and
 * serves the read-only stats HTTP API. This is the ONLY always-on, non-IPFS
 * piece of billiard.eth.
 *
 *   /lobby            → singleton Lobby DO (presence + signed challenges)
 *   /room/:id         → per-match GameRoom DO (authoritative simulation)
 *   GET /stats        → leaderboard JSON
 *   GET /stats/:addr  → one player's record
 */
import { Lobby } from './Lobby';
import { GameRoom } from './GameRoom';
import { readLeaderboard, readPlayer } from './stats';

export interface Env {
  LOBBY: DurableObjectNamespace;
  GAME_ROOM: DurableObjectNamespace;
  STATS: KVNamespace;
}

// Allow the .eth.link / .eth gateways (and local dev) to hit the stats API.
function corsHeaders(origin: string | null): Record<string, string> {
  const allowed =
    !origin ||
    /\.eth(\.link|\.limo)?$/.test(new URL(origin).hostname) ||
    /localhost|127\.0\.0\.1/.test(origin);
  return {
    'Access-Control-Allow-Origin': allowed && origin ? origin : '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const origin = req.headers.get('Origin');

    if (req.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders(origin) });
    }

    // ── WebSocket: Lobby ──────────────────────────────────────────────────
    if (url.pathname === '/lobby') {
      const id = env.LOBBY.idFromName('global-lobby'); // singleton
      return env.LOBBY.get(id).fetch(req);
    }

    // ── WebSocket: GameRoom ───────────────────────────────────────────────
    const roomMatch = url.pathname.match(/^\/room\/([\w-]+)$/);
    if (roomMatch) {
      const id = env.GAME_ROOM.idFromName(roomMatch[1]);
      return env.GAME_ROOM.get(id).fetch(req);
    }

    // ── Stats (read-only) ─────────────────────────────────────────────────
    if (url.pathname === '/stats' && req.method === 'GET') {
      const leaderboard = await readLeaderboard(env.STATS);
      return json({ leaderboard }, origin);
    }
    const statMatch = url.pathname.match(/^\/stats\/(0x[a-fA-F0-9]{40})$/);
    if (statMatch && req.method === 'GET') {
      const player = await readPlayer(env.STATS, statMatch[1]);
      return json({ player }, origin);
    }

    if (url.pathname === '/health') {
      return json({ ok: true, service: 'billiard-worker' }, origin);
    }

    return json({ error: 'not found' }, origin, 404);
  },
};

function json(body: unknown, origin: string | null, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) },
  });
}

export { Lobby, GameRoom };
