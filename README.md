# billiard.eth

Free, browser-based online **8-ball pool** with on-chain (ENS) identity. Hosted
fully static on IPFS via `billiard.eth` / `billiard.eth.link`. The only always-on
service is a Cloudflare Worker that relays signed challenges and runs the
**authoritative** game simulation. **No game smart contract** — challenges and
results are wallet-signed messages. The only on-chain action is optional ENS
name registration.

## Architecture

```
┌─ Frontend (Next.js static export → IPFS) ────────────────┐
│  app/         landing+lobby, /play (canvas), /stats       │
│  lib/wallet   wagmi config — Reown AppKit (WC QR + more)  │
│  lib/ens      pinned ENS ABIs, resolve, commit/reveal     │
│  lib/game     deterministic physics + 8-ball rules        │
│  lib/net      WS client + shared protocol shapes          │
│  lib/crypto   challenge/result signing (viem)             │
└───────────────────────────────────────────────────────────┘
                     │ WebSocket (wss)
┌─ Worker (Cloudflare) ─────────────────────────────────────┐
│  Lobby DO      presence + signed-challenge matchmaking     │
│  GameRoom DO   AUTHORITATIVE sim (imports lib/game), turns │
│  stats.ts      signed-result verification → KV leaderboard │
└───────────────────────────────────────────────────────────┘
```

### Why a Durable Object and not WebRTC / a contract
A DO is a free-tier-friendly always-on coordinator that doubles as the stats
store. Crucially it is the **single source of truth** for shot outcomes: clients
send only `{angle, power, spin}`, the DO runs the one simulation that counts and
broadcasts `{finalState, events}`. JS float math isn't bit-identical across
engines, so client-side results can't be trusted to decide a match — the DO's
result is authoritative. Clients animate locally for instant feedback then snap
to the DO. A client-sent state hash is a **diagnostic desync detector only**.

## Wallet — Reown AppKit (WalletConnect)
`lib/wallet/config.ts` builds a wagmi `WagmiAdapter` from
`@reown/appkit-adapter-wagmi`, and `app/providers.tsx` calls `createAppKit()`
once at module load. The AppKit modal offers a **WalletConnect QR code** for all
mobile wallets (Rainbow, MetaMask Mobile, Trust, …) alongside injected/EIP-6963
extensions and Coinbase Smart Wallet. The connect UI is opened imperatively via
`useAppKit().open()` — the shared `components/ConnectWallet.tsx` button wraps it.

Set the Reown (WalletConnect) project id via `NEXT_PUBLIC_WC_PROJECT_ID`; it
defaults to the project's canonical id `43bdd1b8c477ac4d4a4264a14a8472f8`. Create
your own at <https://dashboard.reown.com>.

> Build note: WalletConnect's `pino` logger optionally requires `pino-pretty`
> (dev only); `next.config.js` aliases it to `false` to silence the webpack
> "Module not found" warning.

## ENS is optional
A connected wallet is enough to play, challenge, and rank. ENS just gives a
recognizable name + avatar. `EnsPrompt` is a soft, dismissible nudge — never a
gate. `EnsRegister` performs a real two-tx commit/reveal against the current
struct-based `ETHRegistrarController`, with ABIs/addresses **pinned** in
`lib/ens/contracts.ts` (fetched from ens-contracts deployments on 2026-06-06).

## Develop

```bash
# Frontend
npm install
cp .env.example .env.local        # set NEXT_PUBLIC_WS_URL after deploying the worker
npm run dev                        # http://localhost:3000
npm run build                      # emits ./out (static, IPFS-ready)

# Worker
cd worker
npm install
wrangler kv namespace create STATS # paste id into wrangler.toml
npm run dev                        # local DO + WS
npm run deploy                     # wrangler deploy
```

Visit `/play` directly (no match context) for a **local hot-seat table** that
exercises the physics + rules without the Worker.

## Deploy

1. `npm run build` → pin `out/` to IPFS (Pinata / cluster), get a **CIDv1**.
2. Set the `billiard.eth` contenthash to `ipfs://<cid>` via the ENS resolver.
3. `cd worker && wrangler deploy`; set `NEXT_PUBLIC_WS_URL` to the `wss://` URL,
   rebuild, re-pin. Worker CORS already allows `.eth` / `.eth.link` origins.

## Constraints (do not violate)
- Wallet via Reown AppKit (WalletConnect QR + injected/EIP-6963 + Coinbase);
  project id from `NEXT_PUBLIC_WC_PROJECT_ID`.
- No game contract; challenges/results are signed messages.
- Fully static frontend; all dynamic behavior in the Worker/DO.
- Deterministic physics, but the GameRoom DO is authoritative; hashes detect drift.
- ENS ABIs/addresses pinned from source; ENS optional, never required.
