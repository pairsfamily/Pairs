/**
 * The money path on a local validator with mainnet pump.fun cloned (e2e/validator.sh, port 8993), lib level only:
 * for each kind of pair (Q on its curve, Q on PumpSwap, Q on pump.fun's list):
 *   lookup tables → ONE-transaction launch like pump.fun's (paired create_v2 with the fee wallet as creator + the
 *   launcher's first buy, SOL → Q → coin or Q → coin) → creator + pair + fee rate read back → buyers trade through the
 *   route → creator fees accrue IN Q → collect + burn → Q's supply drops by exactly the burned amount.
 * node e2e/chain.mjs
 */
import fs from 'node:fs';
import { AddressLookupTableProgram, ComputeBudgetProgram, Connection, Keypair, LAMPORTS_PER_SOL, PublicKey, TransactionMessage, VersionedTransaction } from '@solana/web3.js';
import * as pump from '../lib/pump.mjs';
import { PAIRS } from './pairs.mjs';

const conn = new Connection(process.env.LOCAL_RPC || 'http://127.0.0.1:8993', 'confirmed');
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: Boolean(ok), detail }); console.log(`${ok ? '✅' : '❌'} ${name}${detail ? `  ${detail}` : ''}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fund = async (pk, n) => { const sig = await conn.requestAirdrop(pk, n * LAMPORTS_PER_SOL); await conn.confirmTransaction(sig, 'confirmed'); };
const tokenBal = async (k) => { const a = await conn.getAccountInfo(k, 'confirmed'); return a ? pump.tokenAccountAmount(a.data) : 0n; };
const supplyOf = async (mint) => BigInt((await conn.getTokenSupply(new PublicKey(mint), 'confirmed')).value.amount);

async function sendIxs(payer, ixs, signers, luts = [], units = 600_000) {
  const { blockhash } = await conn.getLatestBlockhash('confirmed');
  const msg = new TransactionMessage({ payerKey: payer.publicKey, recentBlockhash: blockhash, instructions: [ComputeBudgetProgram.setComputeUnitLimit({ units }), ...ixs] }).compileToV0Message(luts);
  const tx = new VersionedTransaction(msg);
  tx.sign([payer, ...signers]);
  const bytes = tx.serialize().length;
  const sig = await conn.sendTransaction(tx, { skipPreflight: true });
  const st = await conn.confirmTransaction(sig, 'confirmed');
  if (st.value.err) {
    const t = await conn.getTransaction(sig, { commitment: 'confirmed', maxSupportedTransactionVersion: 0 });
    throw new Error(`${JSON.stringify(st.value.err)} ${(t?.meta?.logMessages || []).slice(-6).join(' | ')}`);
  }
  return { sig, bytes };
}

async function makeLut(authority, addresses) {
  const slot = await conn.getSlot('finalized');
  const [create, lutAddr] = AddressLookupTableProgram.createLookupTable({ authority: authority.publicKey, payer: authority.publicKey, recentSlot: slot });
  await sendIxs(authority, [create], []);
  for (let i = 0; i < addresses.length; i += 25) {
    await sendIxs(authority, [AddressLookupTableProgram.extendLookupTable({ lookupTable: lutAddr, authority: authority.publicKey, payer: authority.publicKey, addresses: addresses.slice(i, i + 25) })], []);
  }
  await sleep(1200); // entries activate from the next slot
  return (await conn.getAddressLookupTable(lutAddr)).value;
}

const launcher = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(new URL('./fixtures/launcher.json', import.meta.url)))));
const keeper = Keypair.generate();
const buyers = [Keypair.generate(), Keypair.generate()];
await fund(launcher.publicKey, 50); await fund(keeper.publicKey, 5); for (const b of buyers) await fund(b.publicKey, 50);

const global = await pump.loadGlobal(conn);
const entries = await pump.readQuoteControlEntries(conn);
const listed = entries.map((e) => e.mint);
const quotes = {};
for (const [k, addr] of Object.entries(PAIRS)) quotes[k] = await pump.resolveQuote(conn, addr, { listed });
check('the three pairs resolve', Object.values(quotes).every((q) => q.ok), Object.entries(quotes).map(([k, q]) => `${k}:${q.kind || q.reason}`).join(' '));

const staticKeys = await pump.launchStaticAccounts(conn, quotes.curve, quotes.listed);
const staticLut = await makeLut(keeper, staticKeys);
const poolLut = await makeLut(keeper, await pump.quoteAccounts(conn, quotes.pool, staticKeys));
check('lookup tables', staticLut && poolLut, `static ${staticLut.state.addresses.length}, pool pair ${poolLut.state.addresses.length}`);

const cases = [
  { label: 'curve pair, first buy in SOL', q: quotes.curve, currency: 'sol', amount: 1_000_000_000n, bps: 300, luts: [staticLut] },
  { label: 'PumpSwap pair, first buy in SOL', q: quotes.pool, currency: 'sol', amount: 500_000_000n, bps: 0, luts: [staticLut, poolLut] },
  { label: 'listed pair (PUMP), first buy in PUMP', q: quotes.listed, currency: 'quote', amount: 50_000n * 10n ** 6n, bps: 100, luts: [staticLut] },
];

for (const c of cases) {
  console.log(`\n── ${c.label}`);
  const mint = Keypair.generate();
  const M = mint.publicKey, Q = new PublicKey(c.q.mint), qProg = new PublicKey(c.q.tokenProgram), feeWallet = { publicKey: pump.burnerAddress(M) };
  try {
    // 1+2. ONE transaction: the coin (creator = fee wallet) and the launcher's first buy, quoted before it exists.
    const reserves = await pump.quoteReserves(conn, c.q);
    const est = pump.quoteFirstBuy({ global, q: c.q, entries, reserves, currency: c.currency, amountIn: c.amount });
    const minOut = (est * 90n) / 100n;
    const solBefore = BigInt(await conn.getBalance(launcher.publicKey));
    const ixs = await pump.launchIxs(conn, { mint: M, user: launcher.publicKey, name: 'P'.repeat(32), symbol: 'PAIRTEST', uri: 'https://ipfs.io/ipfs/bafkreigh2akiscaildcqabsyg3dfr6ah6fkpkvwlfmjtx5gbd4pffoh5xm', quote: c.q, creatorFeeBps: c.bps, firstBuy: { global, currency: c.currency, amountIn: c.amount, minOut } });
    const { bytes } = await sendIxs(launcher, ixs, [mint], c.luts, 900_000);
    check('launch + first buy land in ONE transaction', bytes <= 1232, `${bytes} B`);
    const curve = pump.decodeBondingCurve((await conn.getAccountInfo(pump.bondingCurveAddress(M))).data);
    check('paired with Q', curve.quote_mint.toBase58() === c.q.mint);
    check('the coin\'s pump.fun creator is its burner PDA (no private key; every creator fee goes there)', (await pump.coinCreator(conn, M, c.q)) === feeWallet.publicKey.toBase58());
    check('creator fee rate stored', Number(curve.creator_fee_bps) === c.bps, `${curve.creator_fee_bps} bps, depth ${curve.depth}`);
    check('opening reserves match pump.fun\'s formula', BigInt(curve.initial_virtual_quote_reserves.toString()) === pump.initialQuoteReserves(global, c.q, entries, reserves), `${curve.initial_virtual_quote_reserves}`);
    const got = await tokenBal(pump.ata(launcher.publicKey, M, pump.TOKEN_2022));
    check('the first buy, in the same transaction, delivered at least the quoted minimum', got >= minOut, `${got} tokens, estimate ${est}, min ${minOut}`);
    if (c.currency === 'sol') check('first buy spent about the amount asked (wSOL unwrapped back)', solBefore - BigInt(await conn.getBalance(launcher.publicKey)) < c.amount + 30_000_000n);

    // 3. buyers trade through the route; fees accrue in Q
    if (c.q.kind !== 'listed') {
      for (const b of buyers) await sendIxs(b, await pump.firstBuyIxs(conn, global, { mint: M, user: b.publicKey, q: c.q, currency: 'sol', amountIn: 2_000_000_000n, minOut: 1n }), [], c.luts);
    } else {
      // A second launcher-side buy in PUMP stands in for traders (buyers would need PUMP).
      await sendIxs(launcher, await pump.firstBuyIxs(conn, global, { mint: M, user: launcher.publicKey, q: c.q, currency: 'quote', amountIn: 200_000n * 10n ** 6n, minOut: 1n }), [], c.luts);
    }
    const pending = await pump.pendingQuoteFees(conn, { mint: M, quote: c.q, creator: feeWallet.publicKey });
    check('creator fees accrue in Q (kept on the curve until swept)', pending.total > 0n, `${pending.curveUnswept} Q units waiting on the curve`);

    // 4. collect + burn: permissionless, nobody signs but the payer (here a stranger, not the keeper)
    const fwAta = pump.ata(feeWallet.publicKey, Q, qProg);
    const stranger = Keypair.generate(); await fund(stranger.publicKey, 1);
    const supply0 = await supplyOf(Q);
    const { sig } = await sendIxs(stranger, await pump.collectAndBurnIxs(conn, { mint: M, payer: stranger.publicKey, quote: c.q, graduated: pending.graduated }), [], c.luts);
    const supply1 = await supplyOf(Q);
    const t = await conn.getTransaction(sig, { commitment: 'confirmed', maxSupportedTransactionVersion: 0 });
    const evt = pump.burnedFromLogs(t.meta.logMessages);
    check('anyone can trigger it: Q burned, supply dropped by exactly the event amount = the waiting fees', supply0 - supply1 === evt && evt === pending.total && evt > 0n, `${evt} units burned, tx ${sig.slice(0, 12)}…`);
    check('burner account left empty, vault drained', (await tokenBal(fwAta)) === 0n && (await pump.pendingQuoteFees(conn, { mint: M, quote: c.q, creator: feeWallet.publicKey })).total === 0n);
    check('the burner holds no SOL', (await conn.getBalance(feeWallet.publicKey)) === 0);

    // 5. nothing but a burn can move a burner's tokens
    if (c.q.kind !== 'listed') {
      await sendIxs(c.q.kind === 'listed' ? launcher : buyers[0], await pump.firstBuyIxs(conn, global, { mint: M, user: buyers[0].publicKey, q: c.q, currency: 'sol', amountIn: 1_000_000_000n, minOut: 1n }), [], c.luts);
      const { createAssociatedTokenAccountIdempotentInstruction } = await import('@solana/spl-token');
      await sendIxs(keeper, [createAssociatedTokenAccountIdempotentInstruction(keeper.publicKey, fwAta, feeWallet.publicKey, Q, qProg), await pump.sweepCurveCreatorFeeIx(conn, { mint: M, payer: keeper.publicKey, creator: feeWallet.publicKey, quote: c.q }), await pump.collectCreatorFeeV2Ix(conn, { creator: feeWallet.publicKey, quote: c.q })], [], c.luts);
      const held = await tokenBal(fwAta);
      const { createTransferCheckedInstruction } = await import('@solana/spl-token');
      const thief = Keypair.generate(); await fund(thief.publicKey, 1);
      const steal = await sendIxs(thief, [createTransferCheckedInstruction(fwAta, Q, pump.ata(thief.publicKey, Q, qProg), thief.publicKey, held, c.q.decimals, [], qProg)], []).then(() => 'moved', (e) => e.message);
      check('a transfer out of the burner (signed by anyone else) is refused', held > 0n && steal !== 'moved' && (await tokenBal(fwAta)) === held, String(steal).slice(0, 60));
      const other = Keypair.generate().publicKey;
      const wrong = pump.burnerBurnIx({ mint: other, quote: c.q });
      wrong.keys[1].pubkey = feeWallet.publicKey; wrong.keys[3].pubkey = fwAta; // another coin's seeds against this burner
      const mis = await sendIxs(thief, [wrong], []).then(() => 'burned', (e) => e.message);
      check('a burn that pairs one coin with another coin\'s burner is refused (PDA seeds checked)', mis !== 'burned' && (await tokenBal(fwAta)) === held, String(mis).slice(0, 60));
      await sendIxs(thief, [pump.burnerBurnIx({ mint: M, quote: c.q })], []);
      check('then the real burn takes it all to zero', (await tokenBal(fwAta)) === 0n);
    }
  } catch (e) {
    check(c.label, false, e.message.slice(0, 600));
  }
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
fs.writeFileSync(new URL('./last-chain-run.json', import.meta.url), JSON.stringify({ at: new Date().toISOString(), results }, null, 1));
process.exit(failed.length ? 1 : 0);
