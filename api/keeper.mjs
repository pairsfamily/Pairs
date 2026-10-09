/**
 * The burn keeper. Every 5 minutes, for every live coin:
 *   READ   in batches: the Q waiting for the coin's burner (unswept on the curve / pool, in the creator vaults) and what
 *          already sits in the burner's Q account.
 *   BURN   when worth it: ONE transaction of permissionless instructions: sweep the curve's (and pool's) waiting fee
 *          into the creator vaults, collect them into the burner (the coin's pump.fun creator, a PDA of Pairs' burner
 *          program), and the program's `burn`, which burns everything the burner holds. Nobody signs but the keeper,
 *          which only pays the transaction fee and (once per coin) the burner's token-account rent.
 *
 * Nothing here holds or could move a coin's fees: the burner has no private key and the program can only burn. A missed
 * or duplicated pass can only burn later, never less. The amount recorded is the program's own `Burned` event.
 * KEEPER_DRY_RUN=1 simulates everything, records 'dry' rows and moves nothing.
 */
import { PublicKey } from '@solana/web3.js';
import { num, flag } from './env.mjs';
import { all, one, run, now, getKv, setKv } from './db.mjs';
import * as sol from './sol.mjs';
import * as lut from './lut.mjs';
import { usdPrice } from './quotes.mjs';
import { ata, bondingCurveAddress, coinPoolAddress, creatorVaultAddress, ammCreatorVaultAuthority, curveCreatorFee, poolCreatorFees, tokenAccountAmount, collectAndBurnIxs, burnedFromLogs } from '../lib/pump.mjs';

export const DRY = flag('KEEPER_DRY_RUN');
const INTERVAL_MS = num('KEEPER_INTERVAL_SECONDS', 300) * 1000; // every 5 minutes (operator, 9 Oct)
/** A burn is sent once the waiting Q is worth MIN_BURN_USD, or (price unknown, or a small coin) every MAX_WAIT_HOURS. */
const MIN_BURN_USD = num('MIN_BURN_USD', 0.1); // a burn costs the keeper ~$0.01: at most ~10% overhead
const MAX_WAIT_MS = num('MAX_WAIT_HOURS', 24) * 3_600_000;
const KEEPER_LOW = BigInt(Math.round(num('KEEPER_LOW_SOL', 0.02) * 1e9));

const keeper = sol.loadKeeper();
export const enabled = Boolean(keeper);
export const keeperAddress = () => keeper?.publicKey.toBase58() || null;
const log = (...a) => console.log(new Date().toISOString(), '[keeper]', ...a);
export const status = () => ({ ...(getKv('keeper', {}) || {}), enabled, dryRun: DRY, intervalMs: INTERVAL_MS, keeper: keeperAddress(), minBurnUsd: MIN_BURN_USD });
const coinStatus = (mint, patch) => setKv(`ks:${mint}`, { ...(getKv(`ks:${mint}`, {}) || {}), ...patch, at: now() });
export const launchKeeperStatus = (mint) => getKv(`ks:${mint}`, null);

const quoteOf = (row) => JSON.parse(row.quote_json);

/** Batched: for each row, { waiting (to sweep/move/distribute), inWallet (already in the fee wallet), graduated }. */
export async function readPending(rows) {
  const keysPer = 5;
  const list = rows.flatMap((r) => {
    // The coin's creator IS its fee wallet: its two creator vaults (pump.fun, PumpSwap) and its own Q account.
    const q = quoteOf(r), m = new PublicKey(r.mint), fw = new PublicKey(r.fee_wallet), Q = new PublicKey(q.mint), prog = new PublicKey(q.tokenProgram);
    return [bondingCurveAddress(m), coinPoolAddress(m, q), ata(creatorVaultAddress(fw), Q, prog), ata(ammCreatorVaultAuthority(fw), Q, prog), ata(fw, Q, prog)];
  });
  const infos = [];
  for (let i = 0; i < list.length; i += 100) infos.push(...(await sol.conn.getMultipleAccountsInfo(list.slice(i, i + 100), 'confirmed')));
  return rows.map((r, i) => {
    const [curve, pool, v1, v2, fw] = infos.slice(i * keysPer, i * keysPer + keysPer);
    const graduated = Boolean(pool && pool.data.length >= 200);
    const waiting = (curve ? curveCreatorFee(curve.data) : 0n) + (graduated ? poolCreatorFees(pool.data) : 0n) + (v1 ? tokenAccountAmount(v1.data) : 0n) + (v2 ? tokenAccountAmount(v2.data) : 0n);
    return { waiting, inWallet: fw ? tokenAccountAmount(fw.data) : 0n, graduated };
  });
}

const lastBurnAt = (mint) => one("SELECT MAX(created_at) AS t FROM burns WHERE mint = ? AND status IN ('ok', 'dry')", mint)?.t || 0;

/** Whether this much Q is worth a transaction now. */
async function worthIt(row, units, q) {
  if (units <= 0n) return false;
  const price = await usdPrice(q.mint).catch(() => null);
  if (price && (Number(units) / 10 ** q.decimals) * price >= MIN_BURN_USD) return true;
  const since = lastBurnAt(row.mint) || row.live_at || row.created_at;
  return now() - since >= MAX_WAIT_MS;
}

function record(row, q, amount, { sig = null, lvbh = null, status }) {
  run('INSERT INTO burns (mint, quote_mint, amount, decimals, sig, lvbh, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', row.mint, q.mint, String(amount), q.decimals, sig, lvbh, DRY ? 'dry' : status, now());
}

/** One coin: sweep, collect into its burner, burn, in one transaction. Simulated first; the burned amount is the event's. */
async function burnCoin(row, p) {
  const q = quoteOf(row);
  const built = await lut.v0WithTables(keeper.publicKey, [...sol.budget(400_000), ...(await collectAndBurnIxs(sol.conn, { mint: row.mint, payer: keeper.publicKey, quote: q, graduated: p.graduated }))], [keeper]);
  const sim = await sol.simulate(built.tx);
  const expected = burnedFromLogs(sim.logs) ?? p.waiting + p.inWallet;
  if (DRY) { record(row, q, expected, { status: 'dry' }); return `dry run: would burn ${expected} units of ${row.quote_symbol || 'Q'}`; }
  const r = await sol.send(built);
  let amount = expected;
  if (r.result === 'ok') {
    const t = await sol.conn.getTransaction(r.sig, { commitment: 'confirmed', maxSupportedTransactionVersion: 0 }).catch(() => null);
    amount = burnedFromLogs(t?.meta?.logMessages) ?? expected;
  }
  record(row, q, amount, { sig: r.sig, lvbh: built.lastValidBlockHeight, status: r.result === 'ok' ? 'ok' : r.result === 'pending' ? 'pending' : 'failed' });
  log(`${row.symbol}: burn ${r.result} ${amount} units of ${row.quote_symbol || q.mint} (${r.sig})`);
  return r.result === 'ok' ? `burned ${amount} units` : `burn ${r.result}`;
}

/** Pending burns: final once the chain answers; 'failed' only once the blockhash has provably expired. */
async function settlePending() {
  for (const b of all("SELECT * FROM burns WHERE status = 'pending'")) {
    const st = await sol.txStatus(b.sig).catch(() => undefined);
    if (st === 'ok') run("UPDATE burns SET status = 'ok' WHERE id = ?", b.id);
    else if (st === 'failed') run("UPDATE burns SET status = 'failed' WHERE id = ?", b.id);
    else if (st === null && b.lvbh != null && (await sol.conn.getBlockHeight('finalized').catch(() => 0)) > b.lvbh + 150) run("UPDATE burns SET status = 'failed' WHERE id = ?", b.id);
  }
}

let running = null;
export function tick() {
  if (!running) running = runTick().finally(() => { running = null; });
  return running;
}

async function runTick() {
  const startedAt = now();
  await settlePending().catch((e) => log(`settle: ${e.message}`));
  // Only coins launched HERE: an external (official) token's fees never reach a Pairs burner.
  const rows = all("SELECT * FROM launches WHERE status = 'live' AND origin = 'pairs' ORDER BY live_at ASC");
  const errors = [];
  let burned = 0;
  const pending = rows.length ? await readPending(rows) : [];
  for (const [i, row] of rows.entries()) {
    const p = pending[i];
    try {
      if (one("SELECT 1 FROM burns WHERE mint = ? AND status = 'pending'", row.mint)) { coinStatus(row.mint, { note: 'A burn is still confirming.', error: null }); continue; }
      if (!(await worthIt(row, p.waiting + p.inWallet, quoteOf(row)))) { coinStatus(row.mint, { note: null, error: null, waiting: String(p.waiting + p.inWallet) }); continue; }
      if (!keeper) { coinStatus(row.mint, { note: 'Fees are waiting; no keeper wallet on this box to burn them.', waiting: String(p.waiting + p.inWallet) }); continue; }
      const note = await burnCoin(row, p);
      if (/^burned/.test(note)) burned++;
      coinStatus(row.mint, { note, error: null, waiting: '0' });
    } catch (e) {
      errors.push(`${row.symbol}: ${e.message}`);
      coinStatus(row.mint, { error: e.message.slice(0, 300) });
      log(`${row.symbol} ${e.message}`);
    }
  }
  const keeperLamports = keeper ? await sol.lamports(keeper.publicKey).catch(() => null) : null;
  setKv('keeper', { lastRunAt: startedAt, nextRunAt: startedAt + INTERVAL_MS, launches: rows.length, burned, lastError: errors.length ? errors.join(' | ').slice(0, 500) : null, keeperSol: keeperLamports == null ? null : Number(keeperLamports) / 1e9, lowGas: keeperLamports != null && keeperLamports < KEEPER_LOW });
}

export function start() {
  if (!keeper) log('no keeper key on this box: fees are NOT burned');
  else log(`on as ${keeper.publicKey.toBase58()}${DRY ? ' (DRY RUN, sends nothing)' : ''}, every ${INTERVAL_MS / 1000}s, burn at $${MIN_BURN_USD} or every ${MAX_WAIT_MS / 3_600_000} h`);
  const loop = async () => {
    try {
      await tick();
    } catch (e) {
      log(`pass failed: ${e.message}`);
    }
    setTimeout(loop, INTERVAL_MS).unref();
  };
  setTimeout(loop, 10_000).unref();
}
