'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useSignMessage } from 'wagmi';
import type { Address } from 'viem';
import { connectLobby, type LobbyChannel } from '@/lib/net/socket';
import type {
  ChallengePayload,
  Matched,
  PlayerInfo,
  Signed,
} from '@/lib/net/protocol';
import { challengeMessage, randomNonce, verifyChallenge } from '@/lib/crypto/sign';
import type { Identity } from '@/lib/ens/resolve';

export type { Matched } from '@/lib/net/protocol';

/**
 * Lobby connection + signed challenge flow. ENS optional: a connected wallet
 * is all that's required to appear in presence and challenge others.
 */
export function useLobby(identity: Identity | null) {
  const { signMessageAsync } = useSignMessage();
  const chan = useRef<LobbyChannel | null>(null);

  const [players, setPlayers] = useState<PlayerInfo[]>([]);
  const [incoming, setIncoming] = useState<Signed<ChallengePayload> | null>(null);
  const [outgoing, setOutgoing] = useState<Address | null>(null);
  const [matched, setMatched] = useState<Matched | null>(null);
  const [connected, setConnected] = useState(false);

  // Read the latest identity from a ref so the socket effect can depend ONLY on
  // the stable wallet address — re-subscribing when ENS resolution mutates the
  // identity object would drop a `matched`/`incoming` during the reconnect gap.
  const idRef = useRef(identity);
  idRef.current = identity;
  const address = identity?.address;

  useEffect(() => {
    if (!address) return;
    const ch = connectLobby();
    chan.current = ch;

    const offOpen = ch.onOpen(() => {
      setConnected(true);
      const id = idRef.current;
      if (!id) return;
      ch.send({
        t: 'hello',
        player: {
          address: id.address,
          ensName: id.ensName,
          avatar: id.avatar,
        },
      });
    });
    const offClose = ch.onClose(() => setConnected(false));

    const off = ch.on(async (msg) => {
      const me = idRef.current?.address ?? '';
      switch (msg.t) {
        case 'presence':
          setPlayers(msg.players.filter((p) => p.address.toLowerCase() !== me.toLowerCase()));
          break;
        case 'incoming': {
          // Verify the signature before surfacing — proves who issued it.
          const ok = await verifyChallenge(msg.signed.payload, msg.signed.signature);
          if (ok) setIncoming(msg.signed);
          break;
        }
        case 'declined':
          setOutgoing(null);
          break;
        case 'matched':
          setOutgoing(null);
          setIncoming(null);
          setMatched({ roomId: msg.roomId, opponent: msg.opponent, youBreak: msg.youBreak });
          break;
        case 'error':
          console.warn('lobby error:', msg.message);
          break;
      }
    });

    return () => {
      offOpen();
      offClose();
      off();
      ch.close();
      chan.current = null;
    };
  }, [address]);

  // Re-broadcast presence when ENS resolves AFTER connecting (the socket no
  // longer reconnects on identity change), so other players see the name/avatar
  // instead of a hex address. Queued if the socket isn't open yet.
  useEffect(() => {
    const id = idRef.current;
    if (!id || !chan.current) return;
    chan.current.send({
      t: 'hello',
      player: { address: id.address, ensName: id.ensName, avatar: id.avatar },
    });
  }, [identity?.ensName, identity?.avatar]);

  const challenge = useCallback(
    async (opponent: Address) => {
      if (!identity || !chan.current) return;
      const payload: ChallengePayload = {
        kind: 'challenge',
        challenger: identity.address,
        opponent,
        nonce: randomNonce(),
        issuedAt: Date.now(),
      };
      const signature = await signMessageAsync({ message: challengeMessage(payload) });
      chan.current.send({ t: 'challenge', signed: { payload, signature } });
      setOutgoing(opponent);
    },
    [identity, signMessageAsync],
  );

  const accept = useCallback(async () => {
    if (!identity || !chan.current || !incoming) return;
    // Sign an acceptance referencing the challenger's nonce.
    const payload: ChallengePayload = {
      ...incoming.payload,
      kind: 'challenge',
    };
    const signature = await signMessageAsync({ message: challengeMessage(payload) });
    chan.current.send({ t: 'accept', nonce: incoming.payload.nonce, signed: { payload, signature } });
    setIncoming(null);
  }, [identity, incoming, signMessageAsync]);

  const decline = useCallback(() => {
    if (!chan.current || !incoming) return;
    chan.current.send({ t: 'decline', nonce: incoming.payload.nonce });
    setIncoming(null);
  }, [incoming]);

  return { players, incoming, outgoing, matched, connected, challenge, accept, decline };
}
