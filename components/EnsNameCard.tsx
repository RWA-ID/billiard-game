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
 * Always-visible ENS identity card: register a `.eth` name, then set its avatar
 * + text records and make it your primary name. Registration and profile edits
 * are independent on-chain steps — a failed edit never affects ownership.
 */
export function EnsNameCard() {
  const { isConnected } = useAccount();
  const { identity } = useIdentity();
  const [registeredName, setRegisteredName] = useState<string | null>(null);

  // The name to manage: one just registered here, else the current primary.
  const manageName = registeredName ?? identity?.ensName ?? null;

  return (
    <div className="rounded-2xl border border-ink-line bg-ink-card/60 p-5 shadow-card">
      {!isConnected ? (
        <div className="text-center">
          <h3 className="font-display text-lg font-700 text-zinc-100">Get your ENS identity</h3>
          <p className="mx-auto mt-1 max-w-md text-sm text-zinc-400">
            Connect a wallet to register a <span className="text-brass-light">.eth</span> name, set
            an avatar and bio, and make it your primary name across billiard.eth.
          </p>
          <div className="mt-4 inline-block">
            <ConnectWallet />
          </div>
        </div>
      ) : (
        <div className="space-y-5">
          <EnsRegister bare onDone={(n) => setRegisteredName(n)} />

          <div className="border-t border-ink-line/60" />

          {manageName ? (
            <EnsProfileEditor name={manageName} isPrimary={identity?.ensName === manageName} />
          ) : (
            <p className="text-sm text-zinc-500">
              Once you own a name, set your avatar, bio, and primary name here.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// ── Profile editor ──────────────────────────────────────────────────────────
function EnsProfileEditor({ name, isPrimary }: { name: string; isPrimary: boolean }) {
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
    setPrimarySet(isPrimary);
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
  }, [name, isPrimary]);

  const setField = (key: string, value: string) =>
    setRecords((r) => ({ ...r, [key]: value }));

  async function saveProfile() {
    setError(null);
    setMsg(null);
    if (!address) return;
    if (!onMainnet) return switchChain?.({ chainId: mainnet.id });

    setSaving(true);
    try {
      // Make sure the name has a resolver we can write to.
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
    <div>
      <div className="flex items-center justify-between">
        <h3 className="font-display text-lg font-700 text-zinc-100">Set up {name}</h3>
        {primarySet ? (
          <Badge tone="available">primary</Badge>
        ) : (
          <Badge tone="neutral">not primary</Badge>
        )}
      </div>
      <p className="mt-1 text-sm text-zinc-400">
        Add an avatar and records, and set this as your primary name. Each is a single on-chain
        transaction.
      </p>

      {loading ? (
        <div className="mt-4 flex items-center gap-2 text-sm text-zinc-500">
          <Spinner size={14} /> Loading current records…
        </div>
      ) : (
        <>
          <div className="mt-4 flex items-center gap-3">
            <Avatar address={address ?? name} avatar={avatarPreview} size={48} />
            <span className="text-xs text-zinc-500">Avatar preview</span>
          </div>

          <div className="mt-4 grid gap-3">
            {PROFILE_FIELDS.map((f) => (
              <label key={f.key} className="block">
                <span className="mb-1 block text-xs uppercase tracking-wide text-zinc-500">
                  {f.label}
                </span>
                {f.key === 'description' ? (
                  <textarea
                    value={records[f.key] ?? ''}
                    onChange={(e) => setField(f.key, e.target.value)}
                    placeholder={f.placeholder}
                    rows={2}
                    className="w-full resize-none rounded-lg border border-ink-line bg-[#0e1213] px-3 py-2 text-sm outline-none placeholder:text-zinc-600 focus:border-sage/40"
                  />
                ) : (
                  <input
                    value={records[f.key] ?? ''}
                    onChange={(e) => setField(f.key, e.target.value)}
                    placeholder={f.placeholder}
                    className="w-full rounded-lg border border-ink-line bg-[#0e1213] px-3 py-2 text-sm outline-none placeholder:text-zinc-600 focus:border-sage/40"
                  />
                )}
              </label>
            ))}
          </div>

          {!onMainnet && (
            <p className="mt-3 text-sm text-amber-400">
              Switch to Ethereum mainnet to edit records.{' '}
              <button className="underline" onClick={() => switchChain?.({ chainId: mainnet.id })}>
                Switch
              </button>
            </p>
          )}

          {msg && <p className="mt-3 text-sm text-sage-bright">{msg}</p>}
          {error && <p className="mt-3 text-sm text-red-400">{error}</p>}

          <div className="mt-4 flex flex-wrap gap-2">
            <Button onClick={saveProfile} disabled={saving || primaryBusy}>
              {saving ? (
                <>
                  <Spinner size={14} /> Saving…
                </>
              ) : (
                'Save profile'
              )}
            </Button>
            <Button variant="secondary" onClick={setPrimary} disabled={primaryBusy || saving || primarySet}>
              {primaryBusy ? (
                <>
                  <Spinner size={14} /> Setting…
                </>
              ) : primarySet ? (
                'Primary set ✓'
              ) : (
                'Set as primary'
              )}
            </Button>
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
