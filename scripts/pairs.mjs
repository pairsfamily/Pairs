/**
 * Operator commands. On the box: cd /root/pairs && NODE_ENV=production DB_PATH=data/pairs.db node scripts/pairs.mjs <cmd>
 *   status                    launching open?, tables, address pool, coins, burns, official token, preview
 *   open | close              launching on or off (kv launchOpen)
 *   hide <MINT> | unhide <MINT>   take a coin off the lists (its fees still burn)
 *   preview on [STAND_IN]     the site's own token ($PAIRS) as a PRIVATE preview: prints a link; only a browser that
 *                             opened it sees the listing. Market borrowed from STAND_IN (default: a real PUMP-paired coin).
 *   preview off               removes the preview listing and its link
 *   golive <CA> [SYMBOL] [NAME]   the site's own token goes LIVE: listed as the official token (launched elsewhere: never
 *                             burned by the keeper), CA in the home pill, preview removed, LAUNCHING OPENED. One step.
 *   token off                 unlists the official token from the home pill (the listing stays; use hide to drop it)
 */
import '../api/env.mjs';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { Keypair } from '@solana/web3.js';
import { getKv, setKv, one, run, now } from '../api/db.mjs';
import * as vanity from '../api/vanity.mjs';
import { storeImage, squareLogo } from '../api/images.mjs';

const [cmd, a, b, c] = process.argv.slice(2);
const isMint = (s) => /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s || '');
const OFFICIAL = { name: 'Pairs', symbol: 'PAIRS', logo: new URL('../brand/token-logo.png', import.meta.url) };
const STAND_IN = 'EEpng77ZPn9FbgbT4xsRjwuxNCcMBYq3HTwEscyTpump'; // a real SOL-paired pump coin (market only, for the preview)
const SOL = 'So11111111111111111111111111111111111111112'; // the official token is paired with SOL (operator, 9 Oct)

async function logo() {
  const path = storeImage(readFileSync(OFFICIAL.logo));
  await squareLogo(path.split('/').pop()); // a short-lived script waits for its square
  return path;
}
function insertExternal({ mint, status, name, symbol, image, marketMint }) {
  run(`INSERT INTO launches (mint, launcher, fee_wallet, name, symbol, description, image, metadata_uri, socials_json, quote_mint, quote_json, quote_symbol, creator_fee_bps, status, origin, official, created_at, live_at, updated_at)
       VALUES (?, 'external', ?, ?, ?, ?, ?, '', '{}', '', ?, NULL, 0, ?, 'external', 1, ?, ?, ?)`,
  mint, `external:${mint}`, name, symbol, 'Official pairs.family token.', image, JSON.stringify({ kind: 'external', marketMint, pairMint: SOL }), status, now(), now(), now());
}
const previewOff = () => {
  const n = run("DELETE FROM launches WHERE status = 'preview'").changes;
  setKv('previewToken', null); setKv('previewTokenInfo', null);
  return n;
};

if (cmd === 'open' || cmd === 'close') { setKv('launchOpen', cmd === 'open'); console.log(`launching ${cmd === 'open' ? 'OPEN' : 'closed'}`); }
else if (cmd === 'hide' || cmd === 'unhide') {
  if (!isMint(a)) throw new Error('usage: hide|unhide <MINT>');
  const r = run('UPDATE launches SET hidden = ? WHERE mint = ?', cmd === 'hide' ? 1 : 0, a);
  console.log(r.changes ? `${a} ${cmd === 'hide' ? 'hidden' : 'shown'}` : 'no such coin');
} else if (cmd === 'preview' && a === 'on') {
  previewOff();
  const standIn = isMint(b) ? b : STAND_IN;
  const mint = Keypair.generate().publicKey.toBase58(); // a placeholder CA until the real one exists
  insertExternal({ mint, status: 'preview', name: OFFICIAL.name, symbol: OFFICIAL.symbol, image: await logo(), marketMint: standIn });
  const t = randomBytes(18).toString('base64url');
  setKv('previewToken', t); setKv('previewTokenInfo', { mint, symbol: OFFICIAL.symbol });
  console.log(`preview ON: $${OFFICIAL.symbol} (placeholder CA ${mint}), market borrowed from ${standIn}`);
  console.log(`private link: ${process.env.PUBLIC_URL || 'https://pairs.family'}/api/preview/${t}`);
} else if (cmd === 'preview' && a === 'off') { console.log(`preview removed (${previewOff()} row)`); }
else if (cmd === 'golive') {
  if (!isMint(a)) throw new Error('usage: golive <CA> [SYMBOL] [NAME]');
  const symbol = (b || OFFICIAL.symbol).replace(/^\$/, '').toUpperCase(), name = c || OFFICIAL.name;
  if (one('SELECT 1 FROM launches WHERE mint = ?', a)) throw new Error('that CA is already listed');
  previewOff();
  insertExternal({ mint: a, status: 'live', name, symbol, image: await logo(), marketMint: a });
  setKv('token', { mint: a, symbol });
  setKv('launchOpen', true);
  console.log(`LIVE: $${symbol} ${a} listed as the official token, CA in the home pill, preview removed, launching OPEN`);
} else if (cmd === 'token' && a === 'off') { setKv('token', null); console.log('token removed from the home pill'); }
else if (cmd === 'status' || !cmd) {
  console.log({
    launchOpen: Boolean(getKv('launchOpen', false)), launchLut: getKv('launchLut', null), pairTables: (getKv('pairLuts', []) || []).map((t) => `${t.address} (${t.quotes.length} pairs)`),
    pairAddressesReady: vanity.freshCount(), coins: one("SELECT COUNT(*) AS n FROM launches WHERE status = 'live' AND origin = 'pairs'").n,
    burns: one("SELECT COUNT(*) AS n FROM burns WHERE status = 'ok'").n, pendingBurns: one("SELECT COUNT(*) AS n FROM burns WHERE status = 'pending'").n,
    token: getKv('token', null), preview: getKv('previewTokenInfo', null),
  });
} else { console.error('commands: status | open | close | hide|unhide <MINT> | preview on [STAND_IN] | preview off | golive <CA> [SYMBOL] [NAME] | token off'); process.exit(1); }
process.exit(0);
