'use client';

import { useEffect, useMemo, useState } from 'react';
import { useAccount, useChainId, useSwitchChain, useWriteContract } from 'wagmi';
import { waitForTransactionReceipt } from 'wagmi/actions';
import { formatEther, type Hex } from 'viem';
import { mainnet } from 'wagmi/chains';
import { config } from '@/lib/wallet/config';
import {
  ENS,
  ETH_REGISTRAR_CONTROLLER_ABI,
  ETH_REGISTRY_DURATION,
} from '@/lib/ens/contracts';
import {
  buildRegistration,
  isAvailable,
  makeCommitment,
  minCommitmentAge,
  randomSecret,
  rentPrice,
  withBuffer,
} from '@/lib/ens/register';
import { Button } from './ui/Button';
import { Badge } from './ui/Badge';
import { Spinner } from './ui/Spinner';

type Step = 'idle' | 'committing' | 'waiting' | 'registering' | 'done';

const SECRET_KEY = 'billiard.ensRegister.secret';
const LABEL_KEY = 'billiard.ensRegister.label';

/**
 * Optional ENS registration via the current struct-based ETHRegistrarController.
 * Two-transaction commit/reveal. ABIs/addresses are PINNED in lib/ens.
 *
 * Edge cases handled: wrong chain (prompt switch), name taken between steps,
 * lost secret (restart), commitment expiry, tx rejection.
 */
export function EnsRegister({
  onDone,
  bare = false,
}: {
  onDone?: (name: string) => void;
  bare?: boolean;
}) {
  const { address } = useAccount();
  const chainId = useChainId();
  const { switchChain } = useSwitchChain();
  const { writeContractAsync } = useWriteContract();

  const [label, setLabel] = useState('');
  const [available, setAvailable] = useState<boolean | null>(null);
  const [price, setPrice] = useState<bigint | null>(null);
  const [checking, setChecking] = useState(false);
  const [step, setStep] = useState<Step>('idle');
  const [error, setError] = useState<string | null>(null);
  const [countdown, setCountdown] = useState(0);
  const [secret, setSecret] = useState<Hex | null>(null);

  const onMainnet = chainId === mainnet.id;
  const name = useMemo(() => (label ? `${label}.eth` : ''), [label]);

  // Resume an in-flight registration (persisted secret + label) after refresh.
  useEffect(() => {
    const s = localStorage.getItem(SECRET_KEY) as Hex | null;
    const l = localStorage.getItem(LABEL_KEY);
    if (s && l) {
      setSecret(s);
      setLabel(l);
    }
  }, []);

  // Debounced availability + price check.
  useEffect(() => {
    if (label.length < 3) {
      setAvailable(null);
      setPrice(null);
      return;
    }
    let cancelled = false;
    setChecking(true);
    const t = setTimeout(async () => {
      try {
        const [avail, rp] = await Promise.all([
          isAvailable(label),
          rentPrice(label, ETH_REGISTRY_DURATION),
        ]);
        if (cancelled) return;
        setAvailable(avail);
        setPrice(rp.total);
      } catch {
        if (!cancelled) {
          setAvailable(null);
          setPrice(null);
        }
      } finally {
        if (!cancelled) setChecking(false);
      }
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [label]);

  async function start() {
    setError(null);
    if (!address) return setError('Connect a wallet first.');
    if (!onMainnet) return switchChain?.({ chainId: mainnet.id });
    if (!available) return setError('That name is not available.');
    if (price === null) return setError('Could not fetch price. Try again.');

    try {
      // 1. Secret (persist so the reveal uses the SAME value).
      const sec = secret ?? randomSecret();
      setSecret(sec);
      localStorage.setItem(SECRET_KEY, sec);
      localStorage.setItem(LABEL_KEY, label);

      const reg = buildRegistration({ label, owner: address, secret: sec });
      const commitment = await makeCommitment(reg);

      // 2. commit (tx 1)
      setStep('committing');
      const commitHash = await writeContractAsync({
        address: ENS.ethRegistrarController,
        abi: ETH_REGISTRAR_CONTROLLER_ABI,
        functionName: 'commit',
        args: [commitment],
      });
      await waitForTransactionReceipt(config, { hash: commitHash });

      // 3. wait minCommitmentAge
      setStep('waiting');
      const wait = await minCommitmentAge();
      for (let s = wait; s > 0; s--) {
        setCountdown(s);
        await new Promise((r) => setTimeout(r, 1000));
      }
      setCountdown(0);

      // Re-check availability — name could have been taken in the window.
      if (!(await isAvailable(label))) {
        setStep('idle');
        setError('Name was taken during the wait. Pick another.');
        return;
      }

      // 4. register (tx 2) — value = rentPrice + small buffer for drift.
      setStep('registering');
      const fresh = await rentPrice(label, ETH_REGISTRY_DURATION);
      const value = withBuffer(fresh.total, 5n);
      const regHash = await writeContractAsync({
        address: ENS.ethRegistrarController,
        abi: ETH_REGISTRAR_CONTROLLER_ABI,
        functionName: 'register',
        args: [reg],
        value,
      });
      await waitForTransactionReceipt(config, { hash: regHash });

      // 5. done — clear persisted secret.
      localStorage.removeItem(SECRET_KEY);
      localStorage.removeItem(LABEL_KEY);
      setStep('done');
      onDone?.(name);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(/rejected|denied/i.test(msg) ? 'Transaction rejected.' : msg);
      setStep('idle');
    }
  }

  const busy = step !== 'idle' && step !== 'done';

  const inner = (
    <>
      <h3 className="font-display text-lg font-700 text-zinc-100">Register an ENS name</h3>
      <p className="mt-1 text-sm text-zinc-400">
        Optional. A real second-level <span className="text-brass-light">.eth</span> name via the
        official ENS registrar — two transactions (commit → reveal), you pay gas + the name fee.
      </p>

      {/* Label input */}
      <div className="mt-4 flex items-center gap-2 rounded-lg border border-ink-line bg-[#0e1213] px-3 py-2">
        <input
          value={label}
          disabled={busy}
          onChange={(e) =>
            setLabel(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))
          }
          placeholder="your-name"
          className="flex-1 bg-transparent font-mono text-sm outline-none placeholder:text-zinc-600"
        />
        <span className="font-mono text-sm text-zinc-500">.eth</span>
        {checking ? (
          <Badge tone="loading">
            <Spinner size={11} /> checking
          </Badge>
        ) : available === true ? (
          <Badge tone="available">available</Badge>
        ) : available === false ? (
          <Badge tone="taken">taken</Badge>
        ) : null}
      </div>

      {price !== null && available && (
        <p className="mt-2 text-sm text-zinc-400">
          Price (1 year): <span className="text-zinc-100">{formatEther(price)} ETH</span>{' '}
          <span className="text-zinc-600">+ gas</span>
        </p>
      )}

      {/* Stepper */}
      <div className="mt-4 flex items-center gap-2 text-xs">
        <StepDot active={step === 'committing'} done={['waiting', 'registering', 'done'].includes(step)} label="Commit" />
        <span className="text-zinc-700">→</span>
        <StepDot
          active={step === 'waiting'}
          done={['registering', 'done'].includes(step)}
          label={step === 'waiting' && countdown ? `Wait ${countdown}s` : 'Wait'}
        />
        <span className="text-zinc-700">→</span>
        <StepDot active={step === 'registering'} done={step === 'done'} label="Register" />
      </div>

      {!onMainnet && (
        <p className="mt-3 text-sm text-amber-400">
          Switch to Ethereum mainnet to register.{' '}
          <button className="underline" onClick={() => switchChain?.({ chainId: mainnet.id })}>
            Switch
          </button>
        </p>
      )}

      {error && <p className="mt-3 text-sm text-red-400">{error}</p>}

      <div className="mt-4">
        {step === 'done' ? (
          <Badge tone="available">Registered {name} ✓</Badge>
        ) : (
          <Button onClick={start} disabled={busy || !available || !address}>
            {busy ? (
              <>
                <Spinner size={14} /> {label_busy(step)}
              </>
            ) : (
              `Register ${name || 'name'}`
            )}
          </Button>
        )}
      </div>
    </>
  );

  if (bare) return inner;
  return <div className="rounded-2xl border border-ink-line bg-ink-card/60 p-5">{inner}</div>;
}

function label_busy(step: Step): string {
  if (step === 'committing') return 'Committing…';
  if (step === 'waiting') return 'Waiting…';
  if (step === 'registering') return 'Registering…';
  return 'Working…';
}

function StepDot({ active, done, label }: { active: boolean; done: boolean; label: string }) {
  return (
    <span
      className={
        'rounded-full px-2 py-0.5 ' +
        (done
          ? 'bg-emerald-500/15 text-emerald-400'
          : active
            ? 'bg-brass/20 text-brass-light'
            : 'bg-white/5 text-zinc-500')
      }
    >
      {label}
    </span>
  );
}
