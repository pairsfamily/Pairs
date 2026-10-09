import { ComputeBudgetProgram, Connection, Keypair, PublicKey, TransactionMessage, VersionedTransaction, AddressLookupTableAccount } from '@solana/web3.js';
import * as pump from '../lib/pump.mjs';
const conn = new Connection(process.env.SOLANA_RPC, 'confirmed');
const global = await pump.loadGlobal(conn);
const listed = await pump.readQuoteControl(conn);
const Qs = { curve: '3BXio3YTY7MBaCjLHLR3rL491817x142bnBqQxN3pump', pool: 'Goh59QCfoX53RgJa615vzXx4swR3mv51VgvAN6ZCpump', listed: 'pumpCmXqMfrsAkQ5r49WcJnRayYRqmXz6ae8H7H9Dfn' };
const budget = [ComputeBudgetProgram.setComputeUnitLimit({ units: 900_000 }), ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 200_000 })];
async function build(variant, q, currency) {
  const mint = Keypair.generate().publicKey, user = Keypair.generate().publicKey, fw = Keypair.generate().publicKey;
  const name = 'P'.repeat(32), symbol = 'ABCDEFGHIJ', uri = 'https://ipfs.io/ipfs/bafkreigh2akiscaildcqabsyg3dfr6ah6fkpkvwlfmjtx5gbd4pffoh5xm';
  const create = variant === 'sharing'
    ? await pump.launchIxs(conn, { mint, user, name, symbol, uri, quote: q, creatorFeeBps: 300, feeWallet: fw })
    : [await pump.createV2Ix(conn, { mint, user, name, symbol, uri, creator: fw, quote: q, creatorFeeBps: 300 })];
  const buy = await pump.firstBuyIxs(conn, global, { mint, user, q, currency, amountIn: 10n ** 9n, minOut: 1n });
  return { user, ixs: [...budget, ...create, ...buy] };
}
const keys = (ixs) => new Set(ixs.flatMap((ix) => [ix.programId.toBase58(), ...ix.keys.map((k) => k.pubkey.toBase58())]));
const lut = (addrs) => new AddressLookupTableAccount({ key: Keypair.generate().publicKey, state: { deactivationSlot: 2n ** 64n - 1n, lastExtendedSlot: 0, lastExtendedSlotStartIndex: 0, addresses: [...addrs].map((k) => new PublicKey(k)) } });
for (const variant of ['sharing', 'creator=feeWallet']) for (const [kind, addr] of Object.entries(Qs)) {
  const q = await pump.resolveQuote(conn, addr, { listed });
  const currency = kind === 'listed' ? 'quote' : 'sol';
  const a = await build(variant, q, currency), b = await build(variant, q, currency);
  const shared = [...keys(a.ixs)].filter((k) => keys(b.ixs).has(k)); // static + this Q's accounts: all could be in tables
  const msg = new TransactionMessage({ payerKey: a.user, recentBlockhash: Keypair.generate().publicKey.toBase58(), instructions: a.ixs }).compileToV0Message([lut(shared)]);
  let size; try { size = new VersionedTransaction(msg).serialize().length; } catch { size = '>1232'; }
  console.log(`${variant.padEnd(18)} ${kind.padEnd(7)} buy in ${currency.padEnd(5)} create + dev buy in ONE tx: ${size} B (limit 1232), ${a.ixs.length} ix, ${msg.staticAccountKeys.length} plain keys`);
}
process.exit(0);
