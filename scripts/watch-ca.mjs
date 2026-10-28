/**
 * Waits for the site's own token to be launched, then takes it live with nobody pressing anything.
 * Every POLL_MS (default 3 s) one RPC read asks for the mint and its pump.fun bonding curve. The moment both exist
 * (a mint can only be made by whoever holds the CA's key, and the curve proves it is a pump.fun coin), it runs
 * `scripts/pairs.mjs golive <CA> <SYMBOL> <NAME>` with the symbol and name read from the coin itself, then checks the
 * site answers with the CA and launching open, and exits 0 (the unit then stays stopped).
 * Run on the server by deploy/watch-ca.sh (systemd unit pairs-ca-watch); by hand: node scripts/watch-ca.mjs <CA>
 */
import '../api/env.mjs';
import { spawnSync } from 'node:child_process';
import { PublicKey } from '@solana/web3.js';
import { getTokenMetadata } from '@solana/spl-token';
import * as sol from '../api/sol.mjs';
import { getKv } from '../api/db.mjs';
import { PUMP, TOKEN_PROGRAM, TOKEN_2022, bondingCurveAddress } from '../lib/pump.mjs';

const CA = process.argv[2] || process.env.WATCH_CA;
if (!sol.isAddress(CA || '')) { console.error('usage: node scripts/watch-ca.mjs <CA>'); process.exit(2); }
const POLL_MS = Number(process.env.POLL_MS || 3000);
const SITE = process.env.SITE_URL || `http://127.0.0.1:${process.env.PORT || 5410}`;
const log = (...a) => console.log(new Date().toISOString(), ...a);

const mint = new PublicKey(CA);
const curve = bondingCurveAddress(mint);

async function launched() {
  const [m, c] = await sol.conn.getMultipleAccountsInfo([mint, curve], 'confirmed');
  if (!m) return false;
  if (!m.owner.equals(TOKEN_PROGRAM) && !m.owner.equals(TOKEN_2022)) { log(`${CA} is held by ${m.owner.toBase58()}, not a token program: waiting`); return false; }
  if (!c) { log('the mint exists, its pump.fun curve not yet'); return false; }
  // Anyone can send SOL to the curve address before the launch: not pump.fun's (yet) means keep waiting, never give up.
  if (!c.owner.equals(PUMP)) { log(`the curve address is held by ${c.owner.toBase58()}, not pump.fun: waiting`); return false; }
  return m.owner;
}

/** Symbol and name as the coin carries them; the defaults (PAIRS, Pairs) when they cannot be read. */
async function identity(program) {
  try {
    const md = await getTokenMetadata(sol.conn, mint, 'confirmed', program);
    const symbol = String(md?.symbol || '').replace(/^\$/, '').trim().toUpperCase();
    const name = String(md?.name || '').trim();
    if (/^[A-Z0-9]{1,10}$/.test(symbol) && name && name.length <= 32) return { symbol, name };
  } catch (e) { log('could not read the coin metadata:', e.message); }
  return { symbol: 'PAIRS', name: 'Pairs' };
}

async function siteShowsIt() {
  const cfg = await fetch(`${SITE}/api/config`, { signal: AbortSignal.timeout(15_000) }).then((r) => r.json());
  return cfg?.token?.mint === CA && cfg.launchOpen === true;
}

const listed = getKv('token', null);
if (listed?.mint === CA) { log(`${CA} is already the site's token: nothing to do`); process.exit(0); }
log(`watching ${CA} every ${POLL_MS / 1000} s (curve ${curve.toBase58()})`);

let polls = 0;
let program = false;
for (;;) {
  try { program = await launched(); } catch (e) { log('read failed, retrying:', e.message); }
  if (program) break;
  if (++polls % 200 === 0) log(`still waiting (${polls} checks)`);
  await sol.sleep(POLL_MS);
}

const t0 = Date.now();
const { symbol, name } = await identity(program);
log(`LAUNCHED on pump.fun: $${symbol} "${name}" ${CA}; going live`);
const r = spawnSync(process.execPath, ['scripts/pairs.mjs', 'golive', CA, symbol, name], { encoding: 'utf8', env: process.env });
const out = `${r.stdout || ''}${r.stderr || ''}`.split('\n').filter((l) => l && !/experimental|trace-warn|bigint/i.test(l)).join('\n');
log(out);
if (r.status !== 0 && !/already listed/.test(out)) { log('⛔ golive failed (exit', r.status, ')'); process.exit(1); }

for (let i = 0; i < 10; i++) {
  if (await siteShowsIt().catch(() => false)) { log(`✅ LIVE: CA in the pill, launching OPEN, ${Date.now() - t0} ms after the coin was seen`); process.exit(0); }
  await sol.sleep(1000);
}
log('⛔ golive ran but the site does not show the CA with launching open');
process.exit(1);
