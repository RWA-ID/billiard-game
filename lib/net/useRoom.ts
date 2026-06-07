'use client';

import { useEffect, useRef, useState } from 'react';
import { connectRoom, type RoomChannel } from '@/lib/net/socket';
import type { Identity } from '@/lib/ens/resolve';
import type {
  Matched,
  ResultPayload,
  RoomClientMsg,
  RoomServerMsg,
  Signed,
} from '@/lib/net/protocol';
import type { ShotInput } from '@/lib/game/physics';

export type { Matched } from '@/lib/net/protocol';

/**
 * GameRoom connection. The DO is authoritative for outcomes; this hook joins
 * the room, sends shot inputs + diagnostic state hashes, and delivers every
 * authoritative message to `onMessage`.
 *
 * IMPORTANT: the socket effect depends ONLY on the wallet address + room id (+
 * youBreak) — NOT the whole identity object. ENS resolution mutates identity's
 * reference, and re-subscribing on that would tear down and rejoin the room
 * mid-handshake (racing the DO's one-shot `start`). The latest identity is read
 * from a ref at join time, and messages go through a ref'd callback so none are
 * dropped (a single `last` state would coalesce bursts).
 */
export function useRoom(
  identity: Identity | null,
  match: Matched | null,
  onMessage?: (msg: RoomServerMsg) => void,
) {
  const chan = useRef<RoomChannel | null>(null);
  const [connected, setConnected] = useState(false);

  const idRef = useRef(identity);
  idRef.current = identity;
  const msgRef = useRef(onMessage);
  msgRef.current = onMessage;

  const address = identity?.address;
  const roomId = match?.roomId;
  const youBreak = match?.youBreak ?? false;

  useEffect(() => {
    if (!address || !roomId) return;
    const ch = connectRoom(roomId);
    chan.current = ch;

    const offOpen = ch.onOpen(() => {
      setConnected(true);
      const id = idRef.current;
      if (!id) return;
      ch.send({
        t: 'join',
        player: { address: id.address, ensName: id.ensName, avatar: id.avatar },
        youBreak,
      });
    });
    const offClose = ch.onClose(() => setConnected(false));
    const off = ch.on((msg) => msgRef.current?.(msg));

    return () => {
      offOpen();
      offClose();
      off();
      ch.close();
      chan.current = null;
    };
  }, [address, roomId, youBreak]);

  const send = (msg: RoomClientMsg) => chan.current?.send(msg);

  return {
    connected,
    sendShot: (input: ShotInput) => send({ t: 'shot', input }),
    sendStateHash: (turn: number, hash: string) => send({ t: 'statehash', turn, hash }),
    sendSignedResult: (signed: Signed<ResultPayload>) => send({ t: 'sign-result', signed }),
    resign: () => send({ t: 'resign' }),
  };
}
