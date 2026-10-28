/**
 * End to end through Pairs' REAL server code on a local validator with mainnet pump.fun cloned (e2e/validator.sh,
 * port 8993), in-process, real transactions on the local chain. The only stub: pump.fun's metadata upload (the one call
 * that would leave the machine). Token names and prices are read from Jupiter (real mainnet metadata).
 *
 *   closed launching refused → tables → prepare for each kind of pair (curve Q with a SOL first buy, PumpSwap Q (makes a
 *   pair table on demand) with a SOL first buy, listed Q with a first buy in Q) → tampered / unsigned submits refused →
 *   submit → route + pair read back → buyers trade → keeper pass burns Q (supply checked on chain) → idle pass burns
 *   nothing → public reads.
 * node e2e/api.mjs
 */
import http from 'node:http';
import fs from 'node:fs';
import { Keypair, LAMPORTS_PER_SOL, PublicKey, VersionedTransaction } from '@solana/web3.js';
import { PAIRS } from './pairs.mjs';
import { createRequire } from 'node:module';
const require_ = createRequire(import.meta.url);

const DB = `/tmp/pairs-e2e-${process.pid}.db`;
const keeperKp = Keypair.generate();
Object.assign(process.env, {
  SOLANA_RPC: process.env.LOCAL_RPC || 'http://127.0.0.1:8993', DB_PATH: DB, VANITY_REQUIRED: '0', VANITY_INCOMING: `/tmp/pairs-e2e-in-${process.pid}`,
  KEEPER_SECRET_KEY: JSON.stringify([...keeperKp.secretKey]), PUMP_IPFS_URL: 'http://127.0.0.1:5417/ipfs', KEEPER_INTERVAL_SECONDS: '3600',
  PRIORITY_MICROLAMPORTS: '1000', LAUNCH_PRIORITY_MICROLAMPORTS: '1000', MIN_BURN_USD: '0', MAX_WAIT_HOURS: '0',
});
const stub = http.createServer((req, res) => { req.resume(); req.on('end', () => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ metadataUri: 'https://ipfs.io/ipfs/bafkreigh2akiscaildcqabsyg3dfr6ah6fkpkvwlfmjtx5gbd4pffoh5xm' })); }); }).listen(5417);

const sol = await import('../api/sol.mjs');
const launch = await import('../api/launch.mjs');
const market = await import('../api/market.mjs');
const keeper = await import('../api/keeper.mjs');
const lut = await import('../api/lut.mjs');
const { one, all, setKv } = await import('../api/db.mjs');
const pump = await import('../lib/pump.mjs');
const { ensureLaunchLut } = await import('../scripts/make-lut.mjs');

const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: Boolean(ok), detail }); console.log(`${ok ? '✅' : '❌'} ${name}${detail ? `  ${detail}` : ''}`); };
const step = async (name, fn) => { try { return await fn(); } catch (e) { check(name, false, e.message.slice(0, 400)); return null; } };
const conn = sol.conn;
const fund = async (pk, n) => { const sig = await conn.requestAirdrop(pk, n * LAMPORTS_PER_SOL); await conn.confirmTransaction(sig, 'confirmed'); };
const signB64 = (b64, kps) => { const tx = VersionedTransaction.deserialize(Buffer.from(b64, 'base64')); tx.sign(kps); return Buffer.from(tx.serialize()).toString('base64'); };
const supplyOf = async (mint) => BigInt((await conn.getTokenSupply(new PublicKey(mint), 'confirmed')).value.amount);

const L = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(new URL('./fixtures/launcher.json', import.meta.url)))));
const buyer = Keypair.generate();
await fund(L.publicKey, 60); await fund(buyer.publicKey, 60); await fund(keeperKp.publicKey, 5);
const png = fs.readFileSync(new URL('../web/public/logo.png', import.meta.url));
const W = L.publicKey.toBase58();
const base = { description: 'end to end', imageData: `data:image/png;base64,${png.toString('base64')}` };

/* ── setup ── */
check('launching is refused while closed', await launch.prepare({ ...base, name: 'x', symbol: 'X', quote: PAIRS.curve }, W).then(() => false, (e) => /currently disabled/.test(e.message)));
setKv('launchOpen', true);
await step('launch lookup table', () => ensureLaunchLut({ log: () => {} }));
check('launch table recorded', Boolean(lut.launchLutAddress()));
check('a pair pump.fun refuses is refused before anything is made', await launch.prepare({ ...base, name: 'x', symbol: 'X', quote: 'So11111111111111111111111111111111111111112' }, W).then(() => false, (e) => /not custom pairs|not allow/i.test(e.message)));
check('a fee rate outside the list is refused', await launch.prepare({ ...base, name: 'x', symbol: 'X', quote: PAIRS.curve, creatorFeeBps: 250 }, W).then(() => false, (e) => /creator fee/i.test(e.message)));
check('a first buy on a listed pair is refused (SOL only, needs a pump coin pair)', await launch.prepare({ ...base, name: 'x', symbol: 'X', quote: PAIRS.listed, devBuy: { currency: 'sol', amount: '1' } }, W).then(() => false, (e) => /needs a pump.fun coin pair/i.test(e.message)));

const cases = [
  { label: 'curve pair', quote: PAIRS.curve, creatorFeeBps: 300, devBuy: { currency: 'sol', amount: '1' } },
  { label: 'PumpSwap pair', quote: PAIRS.pool, creatorFeeBps: 100, devBuy: { currency: 'sol', amount: '0.5' } },
  { label: 'listed pair', quote: PAIRS.listed, creatorFeeBps: 200, devBuy: null },
];
const live = [];
for (const c of cases) {
  console.log(`\n── ${c.label}`);
  const tablesBefore = lut.pairLuts().length;
  const p = await step(`${c.label}: prepare`, () => launch.prepare({ ...base, name: `E2E ${c.label}`.slice(0, 32), symbol: 'PAIRE2E', quote: c.quote, creatorFeeBps: c.creatorFeeBps, devBuy: c.devBuy, slippagePct: 10 }, W));
  if (!p) continue;
  check(`${c.label}: ONE transaction, first buy inside (like pump.fun)`, p.transactions.length === 1 && Buffer.from(p.transactions[0], 'base64').length <= 1232, `${Buffer.from(p.transactions[0], 'base64').length} B`);
  if (lut.pairLuts().length > tablesBefore) console.log(`   (a pair table was made on demand for ${c.label})`);
  check(`${c.label}: an unsigned launch is refused`, await launch.submit({ mint: p.mint, transactions: [p.transactions[0]] }, W).then(() => false, (e) => /not signed/i.test(e.message)));
  const other = Keypair.generate();
  check(`${c.label}: another wallet cannot submit`, await launch.submit({ mint: p.mint, transactions: [signB64(p.transactions[0], [L])] }, other.publicKey.toBase58()).then(() => false, (e) => e.status === 401));
  const tampered = VersionedTransaction.deserialize(Buffer.from(p.transactions[0], 'base64'));
  tampered.message.recentBlockhash = Keypair.generate().publicKey.toBase58();
  check(`${c.label}: a changed transaction is refused`, await launch.submit({ mint: p.mint, transactions: [Buffer.from(tampered.serialize()).toString('base64')] }, W).then(() => false, (e) => /not the transaction/i.test(e.message)));
  const r = await step(`${c.label}: submit`, () => launch.submit({ mint: p.mint, transactions: p.transactions.map((t) => signB64(t, [L])) }, W));
  check(`${c.label}: live${c.devBuy ? ', first buy in the launch transaction' : ''}`, r?.status === 'live' && (c.devBuy ? r.signatures.firstBuy === r.signatures.launch : !r.signatures.firstBuy));
  const row = one('SELECT * FROM launches WHERE mint = ?', p.mint);
  check(`${c.label}: the coin's pump.fun creator is its burner PDA, on chain`, row.fee_wallet === pump.burnerAddress(p.mint).toBase58() && await launch.lockedTo(p.mint, row.fee_wallet, JSON.parse(row.quote_json)));
  const st = await pump.coinState(conn, p.mint);
  check(`${c.label}: paired with the chosen token, fee rate as picked`, st.quoteMint === c.quote && st.creatorFeeBps === c.creatorFeeBps, `${st.creatorFeeBps} bps`);
  if (c.devBuy) check(`${c.label}: the launcher holds the first buy`, BigInt((await conn.getTokenAccountBalance(pump.ata(L.publicKey, new PublicKey(p.mint), pump.TOKEN_2022))).value.amount) >= BigInt(p.firstBuy.minOut));
  live.push({ ...c, mint: p.mint, row });
}

/* ── trading, then the keeper ── */
console.log('\n── trading and burning');
const global = await pump.loadGlobal(conn);
for (const c of live) {
  const q = JSON.parse(c.row.quote_json);
  const ixs = q.kind === 'listed'
    ? await pump.firstBuyIxs(conn, global, { mint: new PublicKey(c.mint), user: L.publicKey, q, currency: 'quote', amountIn: 100_000n * 10n ** 6n, minOut: 1n })
    : await pump.firstBuyIxs(conn, global, { mint: new PublicKey(c.mint), user: buyer.publicKey, q, currency: 'sol', amountIn: 3_000_000_000n, minOut: 1n });
  const payer = q.kind === 'listed' ? L : buyer;
  await step(`${c.label}: a trade`, async () => { const b = await lut.v0WithTables(payer.publicKey, [...sol.budget(400_000), ...ixs], [payer]); const s = await sol.send(b, { skipPreflight: false }); if (s.result !== 'ok') throw new Error(JSON.stringify(s)); });
}
const pendingBefore = await keeper.readPending(all("SELECT * FROM launches WHERE status = 'live'"));
const supplies = {};
for (const c of live) supplies[c.mint] = await supplyOf(JSON.parse(c.row.quote_json).mint);
await step('keeper pass', () => keeper.tick());
for (const [i, c] of live.entries()) {
  const q = JSON.parse(c.row.quote_json);
  const burns = all("SELECT * FROM burns WHERE mint = ? AND status = 'ok'", c.mint);
  const burned = burns.reduce((a, b) => a + BigInt(b.amount), 0n);
  const dropped = supplies[c.mint] - (await supplyOf(q.mint));
  check(`${c.label}: fees burned, Q supply dropped by exactly the recorded burn`, burns.length === 1 && burned > 0n && dropped === burned, `${burned} units (waiting before: ${pendingBefore[i].waiting})`);
}
const [after] = await keeper.readPending([live[0].row]);
check('fee wallet and vaults empty after the pass', after.waiting === 0n && after.inWallet === 0n);
await step('idle keeper pass', () => keeper.tick());
check('an idle pass burns nothing more', all("SELECT * FROM burns WHERE status = 'ok'").length === live.length);

/* ── public reads ── */
console.log('\n── public reads');
const l = await step('list', () => market.list({}));
check('list shows every live coin, priced in its pair', l?.coins.length === live.length && l.coins.every((x) => x.market && x.market.priceQ > 0), l?.coins.map((x) => `${x.pair.symbol}:${x.market?.priceQ?.toExponential(2)}`).join(' '));
const g = await step('coin page', () => market.get(live[0].mint));
// The coin's own image: stored at prepare, served byte for byte (or as its 512 px square) through /api/logos.
{
  const images = await import('../api/images.mjs');
  const name = g?.image?.split('/').pop();
  const served = await new Promise((resolve) => {
    const chunks = []; let head = null;
    const { Writable } = require_('node:stream');
    const w = new Writable({ write(c, _e, cb) { chunks.push(c); cb(); }, final(cb) { resolve({ head, body: Buffer.concat(chunks) }); cb(); } });
    w.writeHead = (code, h) => { head = { code, ...h }; };
    if (!images.serveLogo(w, name)) resolve(null);
  });
  const sq = served?.head?.['content-type'] === 'image/webp';
  check('the coin image is stored and served (original bytes, or its 512 px square)', served && served.head.code === 200 && (sq || served.body.equals(png)), `${g?.image} ${served?.head?.['content-type']} ${served?.body.length} B`);
  check('every live coin has its own image path', l?.coins.every((x) => /^\/api\/logos\/[0-9a-f]{32}\.(png|jpg|gif|webp)$/.test(x.image)));
}
check('coin page has its burns and links', g?.burns.length === 1 && g.burns[0].url && g.links.pump);
const pr = await step('pairs board', () => market.pairs());
check('pairs board counts each pair once with its burn', pr?.pairs.length === live.length && pr.pairs.every((x) => x.coins === 1 && x.burned > 0));
const s = await step('stats', () => market.stats());
check('stats', s?.coins === live.length && s.burns === live.length, JSON.stringify(s));

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
fs.writeFileSync(new URL('./last-api-run.json', import.meta.url), JSON.stringify({ at: new Date().toISOString(), results }, null, 1));
stub.close();
process.exit(failed.length ? 1 : 0);
