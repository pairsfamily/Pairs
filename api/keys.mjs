/**
 * The fee wallets: one fresh keypair per launch, its secret AES-256-GCM encrypted under PAIRS_MASTER_KEY.
 * ⛔ Back up the master key and the database TOGETHER: losing either loses every fee wallet's funds in
 *    flight (what is on chain in the creator vault is safe: pump.fun pays it to the wallet's address).
 * In development without a key, one is made at data/dev-master.key.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Keypair } from '@solana/web3.js';
import { env, PROD } from './env.mjs';
import { DB_PATH, now, one, run } from './db.mjs';

function masterKey() {
  let hex = env('PAIRS_MASTER_KEY', '');
  if (!hex) {
    if (PROD) throw new Error('PAIRS_MASTER_KEY is required in production (64 hex chars)');
    const file = path.join(path.dirname(DB_PATH), 'dev-master.key');
    if (!fs.existsSync(file)) fs.writeFileSync(file, crypto.randomBytes(32).toString('hex'), { mode: 0o600 });
    hex = fs.readFileSync(file, 'utf8').trim();
  }
  if (!/^[0-9a-f]{64}$/i.test(hex)) throw new Error('PAIRS_MASTER_KEY must be 64 hex characters');
  return Buffer.from(hex, 'hex');
}
const KEY = masterKey();

export function encrypt(bytes) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', KEY, iv);
  const enc = Buffer.concat([c.update(bytes), c.final()]);
  return `${iv.toString('base64')}.${c.getAuthTag().toString('base64')}.${enc.toString('base64')}`;
}
export function decrypt(s) {
  const [iv, tag, enc] = String(s).split('.').map((x) => Buffer.from(x, 'base64'));
  const d = crypto.createDecipheriv('aes-256-gcm', KEY, iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(enc), d.final()]);
}

/** Makes and stores a wallet of `mint` for `role` ('fee' | 'mm' | 'stake'). One per role per launch. */
export function createWallet(mint, role = 'fee') {
  if (one('SELECT 1 FROM fee_wallets WHERE mint = ? AND role = ?', mint, role)) throw new Error(`${role} wallet for ${mint} already exists`);
  const kp = Keypair.generate();
  run('INSERT INTO fee_wallets (pubkey, mint, secret_enc, role, created_at) VALUES (?, ?, ?, ?, ?)', kp.publicKey.toBase58(), mint, encrypt(Buffer.from(kp.secretKey)), role, now());
  return kp.publicKey.toBase58();
}
export const createFeeWallet = (mint) => createWallet(mint, 'fee');

/** The keypair of `mint`'s `role` wallet, for the keeper. Null if none. */
export function walletKeypair(mint, role = 'fee') {
  const row = one('SELECT secret_enc FROM fee_wallets WHERE mint = ? AND role = ?', mint, role);
  return row ? Keypair.fromSecretKey(Uint8Array.from(decrypt(row.secret_enc))) : null;
}
export const feeWalletKeypair = (mint) => walletKeypair(mint, 'fee');
/** The address of `mint`'s `role` wallet, made on first use (the mm and stake wallets exist only when their model is used). */
export function walletAddress(mint, role) {
  const row = one('SELECT pubkey FROM fee_wallets WHERE mint = ? AND role = ?', mint, role);
  return row ? row.pubkey : createWallet(mint, role);
}
