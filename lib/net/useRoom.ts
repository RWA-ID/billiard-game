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
 * the room, sends shot inputs + diagnostic state hashes, and surfaces the
 * authoritative messages the parent reconciles to.
 */
export function useRoom(identity: Identity | null, match: Matched | null) {
  const chan = useRef<RoomChannel | null>(null);
  const [last, setLast] = useState<RoomServerMsg | null>(null);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    if (!identity || !match) return;
    const ch = connectRoom(match.roomId);
    chan.current = ch;

    const offOpen = ch.onOpen(() => {
      setConnected(true);
      ch.send({
        t: 'join',
        player: { address: identity.address, ensName: identity.ensName, avatar: identity.avatar },
        youBreak: match.youBreak,
      });
    });
    const offClose = ch.onClose(() => setConnected(false));
    const off = ch.on((msg) => setLast(msg));

    return () => {
      offOpen();
      offClose();
      off();
      ch.close();
      chan.current = null;
    };
  }, [identity, match]);

  const send = (msg: RoomClientMsg) => chan.current?.send(msg);

  return {
    connected,
    last,
    sendShot: (input: ShotInput) => send({ t: 'shot', input }),
    sendStateHash: (turn: number, hash: string) => send({ t: 'statehash', turn, hash }),
    sendSignedResult: (signed: Signed<ResultPayload>) => send({ t: 'sign-result', signed }),
    resign: () => send({ t: 'resign' }),
  };
}
