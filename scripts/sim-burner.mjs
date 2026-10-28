// Mainnet simulation (nothing sent) that the DEPLOYED burner program runs: creates a fresh coin burner's Q account and
// calls burn on it (a zero balance is a valid no-op). Proves the program loads and its account checks pass on mainnet.
// node scripts/sim-burner.mjs [<Q mint>]
import { ComputeBudgetProgram, Connection, Keypair, PublicKey, TransactionMessage, VersionedTransaction } from '@solana/web3.js';
import { createAssociatedTokenAccountIdempotentInstruction } from '@solana/spl-token';
import * as pump from '../lib/pump.mjs';
const conn = new Connection(process.env.SOLANA_RPC, 'confirmed');
const payer = new PublicKey(process.env.SIM_PAYER || 'fomosZ2wByGHXygzSzDg1J7uFVCiAj9KbZVjr342hnX');
const q = await pump.resolveQuote(conn, process.argv[2] || 'pumpCmXqMfrsAkQ5r49WcJnRayYRqmXz6ae8H7H9Dfn', { listed: await pump.readQuoteControl(conn) });
const coin = Keypair.generate().publicKey, burner = pump.burnerAddress(coin), Q = new PublicKey(q.mint), prog = new PublicKey(q.tokenProgram);
const ixs = [ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 }), createAssociatedTokenAccountIdempotentInstruction(payer, pump.ata(burner, Q, prog), burner, Q, prog), pump.burnerBurnIx({ mint: coin, quote: q })];
const { blockhash } = await conn.getLatestBlockhash();
const tx = new VersionedTransaction(new TransactionMessage({ payerKey: payer, recentBlockhash: blockhash, instructions: ixs }).compileToV0Message());
const sim = await conn.simulateTransaction(tx, { sigVerify: false, replaceRecentBlockhash: true });
console.log(sim.value.err ? '❌' : '✅', `burner program ${pump.BURNER_PROGRAM.toBase58()} burn on mainnet (empty burner, no-op)`, sim.value.err ? JSON.stringify(sim.value.err) : `CU ${sim.value.unitsConsumed}`);
console.log((sim.value.logs || []).filter((l) => l.includes(pump.BURNER_PROGRAM.toBase58()) || /Instruction: Burn/.test(l)).join('\n'));
process.exit(sim.value.err ? 1 : 0);
