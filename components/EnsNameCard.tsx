'use client';

import { useEffect, useState } from 'react';
import { useAccount, useChainId, useSwitchChain, useWriteContract } from 'wagmi';
import { waitForTransactionReceipt } from 'wagmi/actions';
import { mainnet } from 'wagmi/chains';
import { config } from '@/lib/wallet/config';
import { useIdentity } from '@/lib/wallet/useIdentity';
import {
  ENS,
  ENS_REGISTRY_ABI,
  PUBLIC_RESOLVER_ABI,
  REVERSE_REGISTRAR_ABI,
} from '@/lib/ens/contracts';
import {
  PROFILE_FIELDS,
  buildRecordCalls,
  getResolver,
  isZeroResolver,
  nodeOf,
  ownsName,
  readProfile,
  type ProfileRecords,
} from '@/lib/ens/manage';
import { EnsRegister } from './EnsRegister';
import { ConnectWallet } from './ConnectWallet';
import { Avatar } from './Avatar';
import { Button } from './ui/Button';
import { Spinner } from './ui/Spinner';
import { Badge } from './ui/Badge';

/**
 * Compact ENS identity card. Register a `.eth` name, or pick a name you already
 * own to update its avatar/records and primary status. The profile editor only
 * appears after registering a NEW name or explicitly choosing one to update —
 * it's never auto-shown for an existing name.
 */
export function EnsNameCard() {
  const { address, isConnected } = useAccount();
  const { identity } = useIdentity();
  const [selected, setSelected] = useState('');
  const [manageInput, setManageInput] = useState('');
  const [checking, setChecking] = useState(false);
  const [manageError, setManageError] = useState<string | null>(null);

  const onRegistered = (name: string) => {
    setSelected(name); // open the editor for the freshly registered name
  };

  async function manageName(raw: string) {
    setManageError(null);
    if (!address) return;
    const name = normalizeName(raw);
    if (!name) {
      setManageError('Enter a name like yourname.eth');
      return;
    }
    setChecking(true);
    try {
      const owns = await ownsName(name, address);
      if (owns) {
        setSelected(name);
        setManageInput('');
      } else {
        setManageError(
          `Your connected wallet doesn't manage ${name} (wrapped names are managed on the ENS app).`,
        );
      }
    } catch {
      setManageError('Could not verify ownership — try again.');
    } finally {
      setChecking(false);
    }
  }

  return (
    <div className="rounded-2xl border border-ink-line bg-ink-card/60 p-4 shadow-card">
      {!isConnected ? (
        <div className="flex flex-col items-center gap-3 py-1 text-center sm:flex-row sm:justify-between sm:text-left">
          <p className="text-sm text-zinc-400">
            <span className="font-600 text-zinc-200">Get an ENS name</span> — connect your wallet to
            register one and stand out on the leaderboard.
          </p>
          <ConnectWallet />
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-zinc-400">
            <span className="font-600 text-zinc-200">Don&apos;t have an ENS?</span> Register one
            below for better discoverability.
          </p>

          <EnsRegister bare compact onDone={onRegistered} />

          <div className="border-t border-ink-line/60 pt-3">
            <label className="mb-1.5 block text-xs uppercase tracking-wide text-zinc-500">
              Already have a name? Manage one you own
            </label>
            <div className="flex items-center gap-2">
              <div className="flex flex-1 items-center rounded-lg border border-ink-line bg-[#0e1213] px-3 py-2">
                <input
                  value={manageInput}
                  onChange={(e) => setManageInput(e.target.value.toLowerCase().replace(/\s/g, ''))}
                  onKeyDown={(e) => e.key === 'Enter' && manageName(manageInput)}
                  placeholder="yourname.eth"
                  className="w-full bg-transparent font-mono text-sm outline-none placeholder:text-zinc-600"
                />
              </div>
              <Button onClick={() => manageName(manageInput)} disabled={checking || !manageInput}>
                {checking ? (
                  <>
                    <Spinner size={13} /> Checking…
                  </>
                ) : (
                  'Manage'
                )}
              </Button>
            </div>
            {identity?.ensName && identity.ensName !== selected && (
              <button
                onClick={() => setSelected(identity.ensName!)}
                className="mt-1.5 text-xs text-sage-bright hover:underline"
              >
                Manage your primary name ({identity.ensName})
              </button>
            )}
            {manageError && <p className="mt-1.5 text-xs text-red-400">{manageError}</p>}
          </div>

          {selected && (
            <EnsProfileEditor
              key={selected}
              name={selected}
              isPrimary={identity?.ensName === selected}
              onClose={() => setSelected('')}
            />
          )}
        </div>
      )}
    </div>
  );
}

/** Normalize user input to a `<label>.eth` 2LD, or '' if invalid. */
function normalizeName(raw: string): string {
  let n = raw.trim().toLowerCase();
  if (!n) return '';
  if (!n.endsWith('.eth')) n = `${n}.eth`;
  const label = n.slice(0, -4);
  if (!label || !/^[a-z0-9-]+$/.test(label)) return '';
  return n;
}

// ── Profile editor (only rendered when a name is selected) ──────────────────
function EnsProfileEditor({
  name,
  isPrimary,
  onClose,
}: {
  name: string;
  isPrimary: boolean;
  onClose: () => void;
}) {
  const { address } = useAccount();
  const chainId = useChainId();
  const { switchChain } = useSwitchChain();
  const { writeContractAsync } = useWriteContract();

  const [records, setRecords] = useState<ProfileRecords>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [primaryBusy, setPrimaryBusy] = useState(false);
  const [primarySet, setPrimarySet] = useState(isPrimary);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const onMainnet = chainId === mainnet.id;

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    readProfile(name)
      .then((r) => {
        if (!cancelled) setRecords(r);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [name]);

  const setField = (key: string, value: string) => setRecords((r) => ({ ...r, [key]: value }));

  async function saveProfile() {
    setError(null);
    setMsg(null);
    if (!address) return;
    if (!onMainnet) return switchChain?.({ chainId: mainnet.id });

    setSaving(true);
    try {
      let resolver = await getResolver(name);
      if (isZeroResolver(resolver)) {
        const h = await writeContractAsync({
          address: ENS.registry,
          abi: ENS_REGISTRY_ABI,
          functionName: 'setResolver',
          args: [nodeOf(name), ENS.publicResolver],
        });
        await waitForTransactionReceipt(config, { hash: h });
        resolver = ENS.publicResolver;
      }
      const calls = buildRecordCalls(name, address, records, { setAddr: true });
      if (!calls) {
        setMsg('Nothing to save — add an avatar or bio first.');
        setSaving(false);
        return;
      }
      const hash = await writeContractAsync({
        address: resolver,
        abi: PUBLIC_RESOLVER_ABI,
        functionName: 'multicall',
        args: [calls],
      });
      await waitForTransactionReceipt(config, { hash });
      setMsg('Profile saved on-chain ✓');
    } catch (e) {
      setError(prettyErr(e));
    } finally {
      setSaving(false);
    }
  }

  async function setPrimary() {
    setError(null);
    setMsg(null);
    if (!address) return;
    if (!onMainnet) return switchChain?.({ chainId: mainnet.id });

    setPrimaryBusy(true);
    try {
      const hash = await writeContractAsync({
        address: ENS.reverseRegistrar,
        abi: REVERSE_REGISTRAR_ABI,
        functionName: 'setName',
        args: [name],
      });
      await waitForTransactionReceipt(config, { hash });
      setPrimarySet(true);
      setMsg(`${name} is now your primary name ✓`);
    } catch (e) {
      setError(prettyErr(e));
    } finally {
      setPrimaryBusy(false);
    }
  }

  const avatarPreview = toHttp(records.avatar);

  return (
    <div className="rounded-xl border border-ink-line/70 bg-[#0e1213]/40 p-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <Avatar address={address ?? name} avatar={avatarPreview} size={36} />
          <div>
            <p className="font-display text-sm font-700 text-zinc-100">{name}</p>
            <span className="text-[11px] text-zinc-500">
              {primarySet ? 'your primary name' : 'not your primary name'}
            </span>
          </div>
        </div>
        <button
          onClick={onClose}
          className="text-xs text-zinc-500 hover:text-zinc-300"
          aria-label="Close editor"
        >
          ✕
        </button>
      </div>

      {loading ? (
        <div className="mt-3 flex items-center gap-2 text-sm text-zinc-500">
          <Spinner size={13} /> Loading records…
        </div>
      ) : (
        <>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {PROFILE_FIELDS.map((f) => (
              <label key={f.key} className={f.key === 'description' ? 'sm:col-span-2' : ''}>
                <span className="mb-1 block text-[11px] uppercase tracking-wide text-zinc-500">
                  {f.label}
                </span>
                <input
                  value={records[f.key] ?? ''}
                  onChange={(e) => setField(f.key, e.target.value)}
                  placeholder={f.placeholder}
                  className="w-full rounded-lg border border-ink-line bg-[#0e1213] px-2.5 py-1.5 text-sm outline-none placeholder:text-zinc-600 focus:border-sage/40"
                />
              </label>
            ))}
          </div>

          {!onMainnet && (
            <p className="mt-2 text-xs text-amber-400">
              Switch to Ethereum mainnet to edit.{' '}
              <button className="underline" onClick={() => switchChain?.({ chainId: mainnet.id })}>
                Switch
              </button>
            </p>
          )}
          {msg && <p className="mt-2 text-xs text-sage-bright">{msg}</p>}
          {error && <p className="mt-2 text-xs text-red-400">{error}</p>}

          <div className="mt-3 flex flex-wrap gap-2">
            <Button onClick={saveProfile} disabled={saving || primaryBusy}>
              {saving ? (
                <>
                  <Spinner size={13} /> Saving…
                </>
              ) : (
                'Save profile'
              )}
            </Button>
            {primarySet ? (
              <Badge tone="available">primary ✓</Badge>
            ) : (
              <Button variant="secondary" onClick={setPrimary} disabled={primaryBusy || saving}>
                {primaryBusy ? (
                  <>
                    <Spinner size={13} /> Setting…
                  </>
                ) : (
                  'Set as primary'
                )}
              </Button>
            )}
          </div>
        </>
      )}
    </div>
  );
}

/** Resolve ipfs:// to a gateway URL for the avatar preview (http(s) pass-through). */
function toHttp(v?: string): string | null {
  if (!v) return null;
  if (v.startsWith('ipfs://')) return `https://ipfs.io/ipfs/${v.slice('ipfs://'.length)}`;
  if (v.startsWith('http://') || v.startsWith('https://')) return v;
  return null; // eip155/NFT avatars aren't previewed here
}

function prettyErr(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e);
  if (/rejected|denied/i.test(m)) return 'Transaction rejected.';
  if (/insufficient funds/i.test(m)) return 'Insufficient funds for gas.';
  return m.length > 140 ? m.slice(0, 140) + '…' : m;
}
