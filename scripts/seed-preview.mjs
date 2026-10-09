/**
 * A LOCAL preview database full of EXAMPLE launches and burns, to see the Pairs board, Explore and the ledgers filled.
 * ⛔ Never run against the live database: it refuses any DB_PATH that is not under /tmp or the scratch dir.
 *   DB_PATH=/tmp/pairs-preview.db node scripts/seed-preview.mjs
 * Then: DB_PATH=/tmp/pairs-preview.db PORT=5410 node api/server.mjs   (no keeper key: nothing is sent)
 */
import { Keypair } from '@solana/web3.js';
import { env } from '../api/env.mjs';
const path = env('DB_PATH', '');
if (!/^\/(tmp|private\/tmp)\//.test(path)) { console.error('⛔ preview databases live under /tmp only'); process.exit(1); }
const { run, now } = await import('../api/db.mjs');

const T22 = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb', SPL = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
// Real runners (logos and prices come from Jupiter), example coins on top of them.
const PAIRS = [
  { mint: 'pumpCmXqMfrsAkQ5r49WcJnRayYRqmXz6ae8H7H9Dfn', symbol: 'PUMP', kind: 'listed', prog: T22, dec: 6, coins: [['Pump Pals', 'PALS', 1_850_000], ['Baton Pass', 'PASS', 920_000], ['Second Wind', 'WIND', 410_000]] },
  { mint: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263', symbol: 'Bonk', kind: 'listed', prog: SPL, dec: 5, coins: [['Bonk Jr', 'BONKJR', 640_000_000], ['Dog Pile', 'PILE', 210_000_000]] },
  { mint: '9BB6NFEcjBCtnNLFko2FqVQBq8HHM13kCyYcdQbgpump', symbol: 'Fartcoin', kind: 'listed', prog: SPL, dec: 6, coins: [['Echo Fart', 'ECHO', 18_400], ['Gas Giant', 'GAS', 6_100]] },
  { mint: 'Goh59QCfoX53RgJa615vzXx4swR3mv51VgvAN6ZCpump', symbol: 'GOIF', kind: 'pool', prog: T22, dec: 6, coins: [['Goif Cup', 'CUP', 52_000]] },
  { mint: 'EEpng77ZPn9FbgbT4xsRjwuxNCcMBYq3HTwEscyTpump', symbol: 'HeeHaw', kind: 'pool', prog: T22, dec: 6, coins: [['Yeehaw', 'YEE', 310_000], ['Saddle Up', 'SADDLE', 95_000]] },
];
const HOUR = 3_600_000;
let i = 0;
for (const p of PAIRS) {
  for (const [name, symbol, total] of p.coins) {
    const mint = Keypair.generate().publicKey.toBase58(), burner = Keypair.generate().publicKey.toBase58();
    const live = now() - (40 + i * 7) * HOUR;
    run(`INSERT INTO launches (mint, launcher, fee_wallet, name, symbol, description, image, metadata_uri, socials_json, quote_mint, quote_json, quote_symbol, creator_fee_bps, dev_buy_currency, dev_buy_amount, status, created_at, live_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, NULL, 'https://example.com', '{}', ?, ?, ?, ?, NULL, '0', 'live', ?, ?, ?)`,
    mint, Keypair.generate().publicKey.toBase58(), burner, name, symbol, `Example coin paired with $${p.symbol} (local preview).`, p.mint,
    JSON.stringify({ kind: p.kind, mint: p.mint, tokenProgram: p.prog, decimals: p.dec }), p.symbol, [0, 30, 100, 200, 300][i % 5], live, live, live);
    // Burns over the coin's life: bigger early, smaller later, summing to `total`.
    const n = 4 + (i % 5);
    for (let k = 0; k < n; k++) {
      const share = (n - k) / ((n * (n + 1)) / 2);
      const units = BigInt(Math.round(total * share * 10 ** p.dec));
      const sig = Buffer.from(Keypair.generate().secretKey).toString('base64').replace(/[^A-Za-z0-9]/g, '').slice(0, 64) + 'Example';
      run('INSERT INTO burns (mint, quote_mint, amount, decimals, sig, status, created_at) VALUES (?, ?, ?, ?, ?, \'ok\', ?)', mint, p.mint, String(units), p.dec, sig, live + (k + 1) * 4 * HOUR);
    }
    i++;
  }
}
console.log(`preview seeded: ${i} example coins on ${PAIRS.length} real pairs → ${path}`);
process.exit(0);
