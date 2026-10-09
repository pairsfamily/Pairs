import { createContext, useContext, useEffect, useState } from 'react';

export const FALLBACK_CONFIG = { brand: 'pairs.family', explorer: 'https://solscan.io', feeRates: [0, 30, 100, 200, 300], maxDevBuySol: 10, keeper: { enabled: false, dryRun: false, intervalMinutes: 5, minBurnUsd: 0.1, address: null }, burnerProgram: '5TbC4U6rqpHqgdS4ngkmzkRPwP53bdeMoJrwhuAnVdS8', launchesPerWalletDay: 10, vanity: { suffix: 'pair', ready: null, required: true }, launchReady: null, launchOpen: null, token: null };
export const ConfigCtx = createContext(FALLBACK_CONFIG);
export const useConfig = () => useContext(ConfigCtx);

/** Polls a loader while mounted. Keeps the last good value through a failed poll. */
export function usePoll(loader, ms, deps = []) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let alive = true;
    const pull = () => loader().then((d) => { if (alive) { setData(d); setError(null); } }).catch((e) => alive && setError(e));
    pull();
    const t = ms ? setInterval(pull, ms) : null;
    return () => { alive = false; if (t) clearInterval(t); };
  }, [...deps, tick]);
  return [data, error, () => setTick((x) => x + 1)];
}

let toastFn = null;
export const toast = (msg) => toastFn?.(msg);
export function useToastHost() {
  const [msg, setMsg] = useState(null);
  useEffect(() => {
    toastFn = (m) => { setMsg(m); setTimeout(() => setMsg(null), 1800); };
    return () => { toastFn = null; };
  }, []);
  return msg;
}
export async function copy(text, label = 'Copied') {
  try {
    await navigator.clipboard.writeText(text);
    toast(label);
  } catch {
    toast('Copy failed');
  }
}

/** How a pair trades, in words. */
export const KIND = { curve: 'On its curve', pool: 'On PumpSwap', listed: 'pump.fun list' };
export const feeLabel = (bps) => (bps === 0 ? 'Standard' : `${bps / 100}%`);
