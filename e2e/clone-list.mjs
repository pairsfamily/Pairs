/**
 * Every mainnet account Pairs' instructions touch, so a local validator can clone exactly those. Builds the real
 * instructions (paired create_v2, fee sharing v2, first buys in SOL and in Q, collect + burn) with throwaway keys
 * against the three test pairs, keeps the accounts that EXIST on mainnet, and prints validator flags.
 * Also writes e2e/fixtures/: a test launcher key and a Token-2022 account giving it 50,000,000 of the listed Q (a real
 * holder's account, owner and amount rewritten), so "pay in Q" can be tested on a listed token.
 *   node e2e/clone-list.mjs > e2e/clones.txt
 */
import { Keypair, PublicKey } from '@solana/web3.js';
import fs from 'node:fs';
import * as sol from '../api/sol.mjs';
import * as pump from '../lib/pump.mjs';
import { PAIRS } from './pairs.mjs';

const dir = new URL('./fixtures/', import.meta.url);
fs.mkdirSync(dir, { recursive: true });
const launcherFile = new URL('launcher.json', dir);
if (!fs.existsSync(launcherFile)) fs.writeFileSync(launcherFile, JSON.stringify([...Keypair.generate().secretKey]));
const L = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(launcherFile))));

const global = await pump.loadGlobal(sol.conn);
const entries = await pump.readQuoteControlEntries(sol.conn);
const keys = new Set();
const add = (ixs) => ixs.forEach((ix) => [ix.programId, ...ix.keys.map((k) => k.pubkey)].forEach((k) => keys.add(k.toBase58())));
for (const [label, addr] of Object.entries(PAIRS)) {
  const q = await pump.resolveQuote(sol.conn, addr, { listed: entries.map((e) => e.mint) });
  if (!q.ok) throw new Error(`${label} ${addr}: ${q.reason}`);
  const mint = Keypair.generate().publicKey, user = Keypair.generate().publicKey;
  const fb = (currency) => ({ global, currency, amountIn: 1n, minOut: 1n });
  add([
    ...(await pump.launchIxs(sol.conn, { mint, user, name: 'x', symbol: 'X', uri: 'https://x', quote: q, creatorFeeBps: 100, firstBuy: fb('quote') })),
    ...(q.kind === 'listed' ? [] : await pump.launchIxs(sol.conn, { mint, user, name: 'x', symbol: 'X', uri: 'https://x', quote: q, creatorFeeBps: 100, firstBuy: fb('sol') })),
    ...(await pump.collectAndBurnIxs(sol.conn, { mint, payer: user, quote: q, graduated: false })),
    await pump.migrateV2Ix(sol.conn, global, { mint, user, quote: q }),
  ]);
}
// Every buyback wallet's accounts (the route may pick any) and pump.fun's fee recipients.
for (const k of global.buyback_fee_recipients) keys.add(k.toBase58());

const BUILTIN = new Set([pump.BURNER_PROGRAM.toBase58(), '11111111111111111111111111111111', 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb', 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL', 'SysvarRent111111111111111111111111111111111', 'ComputeBudget111111111111111111111111111111', 'So11111111111111111111111111111111111111112']);
const list = [...keys];
const out = [];
for (let i = 0; i < list.length; i += 90) {
  const batch = list.slice(i, i + 90);
  const infos = await sol.conn.getMultipleAccountsInfo(batch.map((k) => new PublicKey(k)));
  batch.forEach((k, j) => {
    const a = infos[j];
    if (!a || BUILTIN.has(k)) return;
    if (a.executable) out.push(`--clone-upgradeable-program ${k}`);
    else if (!a.owner.equals(new PublicKey('BPFLoaderUpgradeab1e11111111111111111111111'))) out.push(`--clone ${k}`);
  });
}

// The launcher's listed-Q account: a real holder's Token-2022 account, owner → launcher, amount → 1,000,000 Q.
const listed = await pump.resolveQuote(sol.conn, PAIRS.listed, { listed: entries.map((e) => e.mint) });
const Q = new PublicKey(listed.mint), prog = new PublicKey(listed.tokenProgram);
const holders = await sol.conn.getTokenLargestAccounts(Q);
let src = null;
for (const h of holders.value) {
  const a = await sol.conn.getAccountInfo(h.address);
  if (a && a.owner.equals(prog)) { src = a; break; }
}
const data = Buffer.from(src.data);
L.publicKey.toBuffer().copy(data, 32);
data.writeBigUInt64LE(50_000_000n * 10n ** BigInt(listed.decimals), 64); // enough to buy out a curve (e2e/graduation.mjs)
const qAta = pump.ata(L.publicKey, Q, prog);
fs.writeFileSync(new URL('launcher-q.json', dir), JSON.stringify({ pubkey: qAta.toBase58(), account: { lamports: src.lamports, data: [data.toString('base64'), 'base64'], owner: prog.toBase58(), executable: false, rentEpoch: 0, space: data.length } }));
out.push(`--account ${qAta.toBase58()} fixtures/launcher-q.json`);
console.log(out.join('\n'));
process.exit(0);
