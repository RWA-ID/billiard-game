/**
 * Signed-result persistence + leaderboard, backed by KV namespace STATS.
 *
 * Key layout:
 *   player:<lowercased address>  → PlayerStats JSON
 *   index:leaderboard            → string[] of addresses (maintained sorted)
 *
 * Anti-cheat: recordResult is only ever called by the GameRoom DO, which has
 * already either (a) collected both players' signatures on the same payload, or
 * (b) self-adjudicated from its own authoritative simulation (disputed=true).
 * A client can never write here directly.
 */
import type { PlayerInfo, ResultPayload } from '@/lib/net/protocol';

export type PlayerStats = {
  address: string;
  ensName: string | null;
  avatar: string | null;
  wins: number;
  losses: number;
  lastPlayed: number;
  disputed: number;
  history: string[]; // recent match ids
};

const LEADERBOARD_KEY = 'index:leaderboard';
const playerKey = (addr: string) => `player:${addr.toLowerCase()}`;

function empty(p: PlayerInfo): PlayerStats {
  return {
    address: p.address.toLowerCase(),
    ensName: p.ensName,
    avatar: p.avatar,
    wins: 0,
    losses: 0,
    lastPlayed: 0,
    disputed: 0,
    history: [],
  };
}

async function load(kv: KVNamespace, p: PlayerInfo): Promise<PlayerStats> {
  const raw = await kv.get(playerKey(p.address));
  if (!raw) return empty(p);
  const s = JSON.parse(raw) as PlayerStats;
  // Refresh identity fields opportunistically.
  s.ensName = p.ensName ?? s.ensName;
  s.avatar = p.avatar ?? s.avatar;
  return s;
}

export async function recordResult(
  kv: KVNamespace,
  args: { payload: ResultPayload; players: PlayerInfo[]; disputed: boolean },
): Promise<void> {
  const { payload, players, disputed } = args;
  const byAddr = new Map(players.map((p) => [p.address.toLowerCase(), p]));
  const winnerInfo = byAddr.get(payload.winner.toLowerCase());
  const loserInfo = byAddr.get(payload.loser.toLowerCase());
  if (!winnerInfo || !loserInfo) return;

  const winner = await load(kv, winnerInfo);
  const loser = await load(kv, loserInfo);

  winner.wins += 1;
  winner.lastPlayed = payload.finishedAt;
  winner.history = [payload.matchId, ...winner.history].slice(0, 20);

  loser.losses += 1;
  loser.lastPlayed = payload.finishedAt;
  loser.history = [payload.matchId, ...loser.history].slice(0, 20);

  if (disputed) {
    winner.disputed += 1;
    loser.disputed += 1;
  }

  await Promise.all([
    kv.put(playerKey(winner.address), JSON.stringify(winner)),
    kv.put(playerKey(loser.address), JSON.stringify(loser)),
  ]);

  await updateIndex(kv, [winner.address, loser.address]);
}

async function updateIndex(kv: KVNamespace, addrs: string[]): Promise<void> {
  const raw = await kv.get(LEADERBOARD_KEY);
  const set = new Set<string>(raw ? (JSON.parse(raw) as string[]) : []);
  for (const a of addrs) set.add(a.toLowerCase());
  await kv.put(LEADERBOARD_KEY, JSON.stringify([...set]));
}

export async function readPlayer(kv: KVNamespace, address: string): Promise<PlayerStats | null> {
  const raw = await kv.get(playerKey(address));
  return raw ? (JSON.parse(raw) as PlayerStats) : null;
}

export async function readLeaderboard(kv: KVNamespace): Promise<PlayerStats[]> {
  const raw = await kv.get(LEADERBOARD_KEY);
  const addrs = raw ? (JSON.parse(raw) as string[]) : [];
  const rows = await Promise.all(addrs.map((a) => readPlayer(kv, a)));
  return rows
    .filter((r): r is PlayerStats => r !== null)
    .sort((a, b) => b.wins - a.wins || a.losses - b.losses);
}
