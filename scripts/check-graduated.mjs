/**
 * Read-only mainnet check of how Pairs shows a GRADUATED paired coin. Finds real pump.fun coins that graduated on a
 * custom pair (their canonical PumpSwap pool's quote is Q, not SOL/USDC), runs Pairs' own market code on them, and
 * compares the USD price with Jupiter's. Then simulates the keeper's pool-side fee sweep on one (sends nothing).
 *   node scripts/check-graduated.mjs [<coin mint>:<Q mint> …]
 */
import '../api/env.mjs';
import { PublicKey } from '@solana/web3.js';
import bs58 from 'bs58';
import * as sol from '../api/sol.mjs';
import * as quotes from '../api/quotes.mjs';
import { chainMarkets } from '../api/market.mjs';
import { poolAddress, decodePool, resolveQuote, readQuoteControl, sweepPoolCreatorFeeIx, transferCreatorFeesToPumpV2Ix, sweepCurveCreatorFeeIx, bondingCurveAddress, decodeBondingCurve } from '../lib/pump.mjs';

const listed = await readQuoteControl(sol.conn);
// coin:Q pairs. Found 9 Oct via pump.fun's coin list (complete, quote not SOL/USDC): baton + ascend on PUMP (listed),
// VAMPSEM on a pump coin (depth 1). Helius refuses getProgramAccounts on PumpSwap (10M+ accounts), so no on-chain scan.
const args = process.argv.slice(2).length ? process.argv.slice(2) : [
  'Hg5Ja55T5wESq4vyFoiVCMeHXtGyVA69X2UHq8hgpump:pumpCmXqMfrsAkQ5r49WcJnRayYRqmXz6ae8H7H9Dfn',
  '8Gsjepn7LtFjDxez92jQtuyaSxC28tvi6ExPwhQHpump:pumpCmXqMfrsAkQ5r49WcJnRayYRqmXz6ae8H7H9Dfn',
  '9XF7h7vy469ufzky9Wt4LpU1TxW8VmVxwu3i6vVfpump:H72pex1VtfY2M7v2Tfk9D9PgvCocRuFN3owCveERSa4s',
];
const found = [];
for (const a of args) {
  const [mint, q] = a.split(':');
  const addr = poolAddress(new PublicKey(mint), 0, new PublicKey(q)), info = await sol.conn.getAccountInfo(addr);
  if (!info) { console.log(`❌ ${mint.slice(0, 8)}: no pool at the derived address ${addr.toBase58()}`); continue; }
  found.push({ mint, q, pool: addr.toBase58(), coinCreator: decodePool(info.data).coin_creator, len: info.data.length });
}
if (!found.length) { console.log('no graduated paired coin found'); process.exit(0); }
const rows = [];
for (const f of found) {
  const q = await resolveQuote(sol.conn, f.q, { listed });
  rows.push({ mint: f.mint, quote_mint: f.q, quote_json: JSON.stringify({ kind: q.kind, mint: q.mint, tokenProgram: q.tokenProgram, decimals: q.decimals }) });
}
const markets = await chainMarkets(rows);
const metas = await quotes.metaMany([...new Set([...rows.map((r) => r.mint), ...rows.map((r) => r.quote_mint)])]);
let bad = 0;
for (const r of rows) {
  const m = markets[r.mint], coin = metas[r.mint], q = metas[r.quote_mint];
  const ours = m?.priceQ != null && q?.usdPrice ? m.priceQ * q.usdPrice : null;
  const jup = coin?.usdPrice ?? null;
  const ratio = ours && jup ? ours / jup : null;
  const ok = m?.phase === 'graduated' && m.pool && ours != null && (ratio == null || (ratio > 0.8 && ratio < 1.25));
  if (!ok) bad++;
  const curve = decodeBondingCurve((await sol.conn.getAccountInfo(bondingCurveAddress(new PublicKey(r.mint))))?.data || Buffer.alloc(0));
  console.log(`${ok ? '✅' : '❌'} ${(coin?.symbol || r.mint.slice(0, 6)).padEnd(10)} on $${(q?.symbol || '?').padEnd(8)} phase ${m?.phase} pool ${m?.pool?.slice(0, 6)} supply ${Math.round(m?.supply ?? 0)} price ${ours?.toPrecision(3)} USD vs Jupiter ${jup?.toPrecision(3)} (×${ratio?.toFixed(3)}) cap $${ours && m?.supply ? Math.round(ours * m.supply) : '–'} curve.complete ${curve.complete}`);
}
// The keeper's pool-side collect on a real graduated paired coin: sweep curve + sweep pool + move to the creator vault.
const f = found[0], qr = JSON.parse(rows[0].quote_json), payer = new PublicKey('fomosZ2wByGHXygzSzDg1J7uFVCiAj9KbZVjr342hnX');
const ixs = [
  await sweepCurveCreatorFeeIx(sol.conn, { mint: f.mint, payer, creator: f.coinCreator, quote: qr }),
  await sweepPoolCreatorFeeIx(sol.conn, { mint: f.mint, payer, creator: f.coinCreator, quote: qr }),
  await transferCreatorFeesToPumpV2Ix(sol.conn, { payer, creator: f.coinCreator, quote: qr }),
];
const b = await sol.v0(payer, [...sol.budget(400_000), ...ixs]);
const sim = await sol.conn.simulateTransaction(b.tx, { sigVerify: false, replaceRecentBlockhash: true });
console.log(sim.value.err ? '❌' : '✅', `keeper pool-side collect simulates on ${f.mint.slice(0, 8)}… (sweep curve, sweep pool, transfer to creator vault)`, sim.value.err ? JSON.stringify(sim.value.err) + ' ' + (sim.value.logs || []).slice(-4).join(' | ') : `CU ${sim.value.unitsConsumed}`);
console.log(bad ? `${bad} display problem(s)` : 'every graduated coin displayed correctly');
process.exit(0);
