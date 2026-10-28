// One SQLite file (node:sqlite, no native build). Every write is a single statement unless marked.
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, env } from './env.mjs';

export const DB_PATH = env('DB_PATH', path.join(ROOT, 'data', 'pairs.db'));
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
export const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;');

db.exec(`
CREATE TABLE IF NOT EXISTS nonces (
  nonce TEXT PRIMARY KEY,
  issued_at TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  used_at INTEGER
);
CREATE TABLE IF NOT EXISTS sessions (
  id_hash TEXT PRIMARY KEY,
  wallet TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
-- One launch = one coin = one fee wallet. The coin is paired with token Q; every unit of its creator fees (paid by
-- pump.fun in Q) goes to the fee wallet and is burned.
CREATE TABLE IF NOT EXISTS launches (
  mint TEXT PRIMARY KEY,
  launcher TEXT NOT NULL,          -- the pump.fun creator (signed the launch)
  fee_wallet TEXT NOT NULL UNIQUE, -- 100% shareholder of the creator fees; Pairs holds its key, it only ever burns
  name TEXT NOT NULL,
  symbol TEXT NOT NULL,
  description TEXT,
  image TEXT,                      -- our own copy: /api/logos/<hash>.<ext>
  metadata_uri TEXT NOT NULL,
  socials_json TEXT NOT NULL DEFAULT '{}',
  quote_mint TEXT NOT NULL,        -- Q, the pair
  quote_json TEXT NOT NULL,        -- the resolved quote at launch: kind, token program, decimals, curve/pool accounts
  quote_symbol TEXT,
  creator_fee_bps INTEGER NOT NULL,-- 0 = pump.fun's standard schedule
  dev_buy_currency TEXT,           -- sol | quote | NULL (none)
  dev_buy_amount TEXT NOT NULL DEFAULT '0', -- lamports or Q units
  status TEXT NOT NULL,            -- prepared | created | live | failed | rejected
  sig TEXT,
  buy_sig TEXT,
  tx_hash TEXT,                    -- sha256 of the prepared launch message: submit relays only that transaction
  buy_tx_hash TEXT,                -- same for the first buy
  error TEXT,
  hidden INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  live_at INTEGER,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS launches_launcher ON launches(launcher);
CREATE INDEX IF NOT EXISTS launches_status ON launches(status, live_at);
CREATE INDEX IF NOT EXISTS launches_quote ON launches(quote_mint, status);
-- The fee wallet keys, encrypted under PAIRS_MASTER_KEY.
CREATE TABLE IF NOT EXISTS fee_wallets (
  pubkey TEXT PRIMARY KEY,
  mint TEXT NOT NULL,
  secret_enc TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'fee',
  created_at INTEGER NOT NULL,
  UNIQUE (mint, role)
);
-- Every collect-and-burn pass that moved Q: one row, the burned amount in Q's smallest units.
CREATE TABLE IF NOT EXISTS burns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  mint TEXT NOT NULL,              -- the Pairs coin whose fees these were
  quote_mint TEXT NOT NULL,        -- Q, the token burned
  amount TEXT NOT NULL,
  decimals INTEGER NOT NULL,
  sig TEXT,
  lvbh INTEGER,                    -- the blockhash's last valid height: a 'pending' row is settled only past it
  status TEXT NOT NULL,            -- ok | pending | failed | dry
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS burns_mint ON burns(mint, created_at);
CREATE INDEX IF NOT EXISTS burns_quote ON burns(quote_mint, status);
CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT NOT NULL);
`);

// Columns added after the first deploy. An 'external' launch is the site's own token, launched on another platform and
// listed here (official 1): never part of the keeper's burns. status 'preview' = visible only to the preview cookie.
const addColumn = (table, col, type) => { if (!db.prepare(`SELECT 1 FROM pragma_table_info('${table}') WHERE name = ?`).get(col)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${type}`); };
addColumn('launches', 'origin', "TEXT NOT NULL DEFAULT 'pairs'");
addColumn('launches', 'official', 'INTEGER NOT NULL DEFAULT 0');

export const now = () => Date.now();
export const one = (sql, ...params) => db.prepare(sql).get(...params);
export const all = (sql, ...params) => db.prepare(sql).all(...params);
export const run = (sql, ...params) => db.prepare(sql).run(...params);
/** Runs fn inside one transaction (all or nothing). */
export function tx(fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const out = fn();
    db.exec('COMMIT');
    return out;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

export function getKv(k, fallback = null) {
  const row = one('SELECT v FROM kv WHERE k = ?', k);
  if (!row) return fallback;
  try {
    return JSON.parse(row.v);
  } catch {
    return fallback;
  }
}
export function setKv(k, v) {
  run('INSERT INTO kv (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v', k, JSON.stringify(v));
}

export const HOUR = 3_600_000;

setInterval(() => {
  run('DELETE FROM nonces WHERE created_at < ?', now() - 60 * 60_000);
  run('DELETE FROM sessions WHERE expires_at < ?', now());
  // A launch prepared but never sent keeps its fee wallet; it is simply never shown.
  run("UPDATE launches SET status = 'failed', updated_at = ? WHERE status = 'prepared' AND created_at < ?", now(), now() - 30 * 60_000);
}, 60_000).unref();
