// Mainnet simulation of the one-transaction launch (create_v2 with the fee wallet as creator + dev buy) against the LIVE
// lookup tables. Nothing is sent: sigVerify off, throwaway mint and fee wallet, a funded payer we do not hold.
// node scripts/sim-launch.mjs <launch LUT> [<pair LUT> …]
import { ComputeBudgetProgram, Connection, Keypair, PublicKey, TransactionMessage, VersionedTransaction } from '@solana/web3.js';
import * as pump from '../lib/pump.mjs';
const conn = new Connection(process.env.SOLANA_RPC, 'confirmed');
const payer = new PublicKey(process.env.SIM_PAYER || 'fomosZ2wByGHXygzSzDg1J7uFVCiAj9KbZVjr342hnX');
const luts = [];
for (const a of process.argv.slice(2)) luts.push((await conn.getAddressLookupTable(new PublicKey(a))).value);
const global = await pump.loadGlobal(conn), entries = await pump.readQuoteControlEntries(conn), listed = entries.map((e) => e.mint);
const pairs = { curve: process.env.SIM_CURVE_Q, pool: 'Goh59QCfoX53RgJa615vzXx4swR3mv51VgvAN6ZCpump', listed: 'pumpCmXqMfrsAkQ5r49WcJnRayYRqmXz6ae8H7H9Dfn' };
for (const [kind, addr] of Object.entries(pairs)) {
  if (!addr) continue;
  const q = await pump.resolveQuote(conn, addr, { listed });
  if (!q.ok) { console.log('⛔', kind, q.reason); continue; }
  const currency = q.kind === 'listed' ? null : 'sol';
  const mint = Keypair.generate(), fw = Keypair.generate().publicKey;
  let firstBuy = null;
  if (currency) {
    const est = pump.quoteFirstBuy({ global, q, entries, reserves: await pump.quoteReserves(conn, q), currency, amountIn: 100_000_000n });
    firstBuy = { global, currency, amountIn: 100_000_000n, minOut: (est * 90n) / 100n };
  }
  const ixs = [ComputeBudgetProgram.setComputeUnitLimit({ units: 900_000 }), ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 200_000 }),
    ...(await pump.launchIxs(conn, { mint: mint.publicKey, user: payer, name: 'P'.repeat(32), symbol: 'ABCDEFGHIJ', uri: 'https://ipfs.io/ipfs/bafkreigh2akiscaildcqabsyg3dfr6ah6fkpkvwlfmjtx5gbd4pffoh5xm', quote: q, creatorFeeBps: 300, feeWallet: fw, firstBuy }))];
  const { blockhash } = await conn.getLatestBlockhash();
  const tx = new VersionedTransaction(new TransactionMessage({ payerKey: payer, recentBlockhash: blockhash, instructions: ixs }).compileToV0Message(luts));
  let bytes; try { bytes = tx.serialize().length; } catch { bytes = 0; }
  if (!bytes || bytes > 1232) { console.log('…', kind.padEnd(7), 'needs its pair table (the server makes it on the first launch against this pair)'); continue; }
  const sim = await conn.simulateTransaction(tx, { sigVerify: false, replaceRecentBlockhash: true });
  console.log(sim.value.err ? '❌' : '✅', kind.padEnd(7), currency ? 'with a 0.1 SOL dev buy' : 'no dev buy (payer holds no PUMP)', `${bytes} B`, `CU ${sim.value.unitsConsumed}`, sim.value.err ? JSON.stringify(sim.value.err) + ' ' + (sim.value.logs || []).slice(-4).join(' | ') : '');
}
process.exit(0);
