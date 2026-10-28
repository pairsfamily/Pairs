/**
 * The pool of mint keypairs whose address ends in `pair` (VANITY_SUFFIX): every Pairs CA ends in `pair`. With VANITY_REQUIRED=1 every launch takes one;
 * an empty pool refuses the launch rather than minting a plain address.
 *
 * A 4-character suffix takes ~11.3M tries on average (58^4): about 85 seconds per key on a 6-core Mac with
 * tools/grind (~144k keys/s, `pair` measured 9 Oct 2026). Keys are ground on the Mac (`deploy/keep-vanity.sh`, a launchd
 * agent) and dropped into the box's incoming folder; the server imports them every minute. Secrets are stored encrypted under PAIRS_MASTER_KEY, like the fee wallets.
 *
 * ⛔⛔ A key is ISSUED ONCE. Once a mint address has left this server (in a launch transaction the launcher may
 * never sign), anyone who saw it can pre-create the coin's accounts and make pump.fun's create fail for that
 * address forever. An issued key is never handed to anyone else, whether or not the launch landed. A retry by
 * the SAME launcher within RESERVATION_MS gets the same key back, so retries cannot drain the pool.
 */
import { Keypair } from '@solana/web3.js';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { env } from './env.mjs';
import { db, DB_PATH, now } from './db.mjs';
import { encrypt, decrypt } from './keys.mjs';

export const SUFFIX = env('VANITY_SUFFIX', 'pair');
export const INCOMING = env('VANITY_INCOMING', path.join(path.dirname(DB_PATH), 'vanity-incoming'));
export const RESERVATION_MS = 15 * 60_000;
/** Every Pairs CA ends in VANITY_SUFFIX (`pair`, operator 9 Oct). An empty pool refuses the launch; VANITY_REQUIRED=0 lets a dev machine launch with plain addresses. */
export const REQUIRED = env('VANITY_REQUIRED', '1') !== '0';

db.exec(`CREATE TABLE IF NOT EXISTS vanity (
  pubkey TEXT PRIMARY KEY,
  secret_enc TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'fresh',   -- fresh | issued | launched
  launcher TEXT,
  issued_at INTEGER,
  created_at INTEGER NOT NULL
)`);

export function addKey(kp) {
  const pk = kp.publicKey.toBase58();
  if (!pk.endsWith(SUFFIX)) throw new Error(`not a ${SUFFIX} key`);
  db.prepare('INSERT OR IGNORE INTO vanity (pubkey, secret_enc, created_at) VALUES (?, ?, ?)').run(pk, encrypt(Buffer.from(kp.secretKey)), now());
}
const kpOf = (row) => Keypair.fromSecretKey(Uint8Array.from(decrypt(row.secret_enc)));

/** A fresh key for `launcher`, marked issued in the same statement. The launcher's own recent key comes back first. */
export function issueKey(launcher) {
  const mine = db.prepare("SELECT secret_enc FROM vanity WHERE state = 'issued' AND launcher = ? AND issued_at > ? ORDER BY issued_at DESC LIMIT 1").get(launcher, now() - RESERVATION_MS);
  if (mine) return kpOf(mine);
  const row = db.prepare(`UPDATE vanity SET state = 'issued', issued_at = ?, launcher = ?
    WHERE pubkey = (SELECT pubkey FROM vanity WHERE state = 'fresh' ORDER BY created_at LIMIT 1) RETURNING secret_enc`).get(now(), launcher);
  return row ? kpOf(row) : null;
}
export const markLaunched = (pubkey) => db.prepare("UPDATE vanity SET state = 'launched' WHERE pubkey = ?").run(pubkey);
export const freshCount = () => db.prepare("SELECT count(*) AS n FROM vanity WHERE state = 'fresh'").get().n;
export const hasReservation = (launcher) => Boolean(db.prepare("SELECT 1 FROM vanity WHERE state = 'issued' AND launcher = ? AND issued_at > ?").get(launcher, now() - RESERVATION_MS));
/** True when the launch can get an address right now (stock, or this launcher's own reserved key). */
export const available = (launcher = null) => freshCount() > 0 || (launcher ? hasReservation(launcher) : false);

/** Imports every keypair file pushed into INCOMING (the grinder's `<address>.json`), then deletes it. */
export function importIncoming() {
  if (!existsSync(INCOMING)) return 0;
  let n = 0;
  for (const f of readdirSync(INCOMING)) {
    if (!f.endsWith(`${SUFFIX}.json`)) continue;
    const p = path.join(INCOMING, f);
    try {
      const kp = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(p, 'utf8'))));
      if (`${kp.publicKey.toBase58()}.json` !== f) throw new Error('name does not match the key');
      addKey(kp);
    } catch {
      continue; // still being written, or not a key: left for the next pass (a bad file never imports)
    }
    rmSync(p);
    n++;
  }
  return n;
}

export function start(log = console) {
  mkdirSync(INCOMING, { recursive: true, mode: 0o700 });
  const tick = () => {
    const n = importIncoming();
    if (n) log.log(`[vanity] +${n} ${SUFFIX} address${n === 1 ? '' : 'es'} → ${freshCount()} ready`);
  };
  tick();
  log.log(`[vanity] ${freshCount()} ${SUFFIX} addresses ready; importing from ${INCOMING} every minute`);
  setInterval(tick, 60_000).unref();
}
