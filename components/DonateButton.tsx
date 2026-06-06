'use client';

import { useState } from 'react';
import { useAccount, useSendTransaction, useWaitForTransactionReceipt } from 'wagmi';
import { parseEther, type Address } from 'viem';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import { Button } from './ui/Button';
import { Spinner } from './ui/Spinner';

/** Tip jar — supports the developer. ENS name shown, address is authoritative. */
export const DONATE_TO: Address = '0x2D037f66b9e0EDE90c2080558a7d3FF7BE36E9A1';
export const DONATE_ENS = 'ensgiant.eth';
const PRESETS = ['0.005', '0.01', '0.05'];

export function DonateCard() {
  const { isConnected } = useAccount();
  const [amount, setAmount] = useState('0.01');
  const { data: hash, sendTransaction, isPending, error, reset } = useSendTransaction();
  const { isLoading: confirming, isSuccess } = useWaitForTransactionReceipt({ hash });

  const donate = () => {
    reset();
    try {
      sendTransaction({ to: DONATE_TO, value: parseEther(amount || '0') });
    } catch {
      /* invalid amount ignored */
    }
  };

  return (
    <div className="overflow-hidden rounded-2xl border border-ink-line bg-gradient-to-br from-ink-card to-ink-soft p-7 shadow-card">
      <div className="flex items-center gap-3">
        <span className="grid h-11 w-11 place-items-center rounded-xl bg-sage/10 text-2xl">🎱</span>
        <div>
          <h3 className="font-serif text-xl font-700 text-cream">Enjoyed the game?</h3>
          <p className="text-sm text-zinc-400">
            billiard.eth is free & open. If it brought you joy, tip the builder at{' '}
            <span className="text-sage-bright">{DONATE_ENS}</span>.
          </p>
        </div>
      </div>

      {isSuccess ? (
        <p className="mt-5 rounded-xl border border-sage/30 bg-sage/5 px-4 py-3 text-sm text-sage-bright">
          Thank you! Your {amount} ETH tip is on its way. 💚
        </p>
      ) : (
        <>
          <div className="mt-5 flex flex-wrap items-center gap-2">
            {PRESETS.map((p) => (
              <button
                key={p}
                onClick={() => setAmount(p)}
                className={
                  'rounded-lg border px-3 py-1.5 text-sm transition ' +
                  (amount === p
                    ? 'border-sage bg-sage/10 text-sage-bright'
                    : 'border-ink-line text-zinc-300 hover:border-sage/40')
                }
              >
                {p} ETH
              </button>
            ))}
            <div className="flex items-center gap-1 rounded-lg border border-ink-line bg-[#0e1512] px-3 py-1.5">
              <input
                value={amount}
                onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ''))}
                className="w-16 bg-transparent text-sm outline-none"
                inputMode="decimal"
              />
              <span className="text-sm text-zinc-500">ETH</span>
            </div>
          </div>

          <div className="mt-4">
            {!isConnected ? (
              <ConnectButton.Custom>
                {({ openConnectModal }) => (
                  <Button onClick={openConnectModal}>Connect to donate</Button>
                )}
              </ConnectButton.Custom>
            ) : (
              <Button onClick={donate} disabled={isPending || confirming || !Number(amount)}>
                {isPending || confirming ? (
                  <>
                    <Spinner size={14} /> {confirming ? 'Confirming…' : 'Sign in wallet…'}
                  </>
                ) : (
                  `Donate ${amount || '0'} ETH`
                )}
              </Button>
            )}
          </div>

          {error && (
            <p className="mt-2 text-xs text-red-400">
              {/rejected|denied/i.test(error.message) ? 'Transaction rejected.' : 'Could not send — check balance / network.'}
            </p>
          )}
        </>
      )}
    </div>
  );
}
