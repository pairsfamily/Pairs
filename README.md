# Pairs

**[pairs.family](https://pairs.family)**: a launchpad for pump.fun **custom pairs**. Every coin launched here trades
against another token (its *pair*) instead of SOL, so every buy is buy pressure on the pair, and **100% of the coin's
creator fees, paid by pump.fun in the pair token, are burned**. Every coin's address ends in `pair`.

## How it works

1. **Launch: one transaction, like pump.fun's own.** `create_v2` paired with the chosen token, with the coin's
   **creator set to its burner**, plus the launcher's optional first buy (PumpSwap `multi_hop_swap`, SOL → pair → coin).
   Nothing can land between the creation and the first buy. Fits Solana's 1,232 bytes through address lookup tables.
2. **Fees go to the burner.** Each coin's burner is a PDA (`["burner", coin_mint]`) of the **Pairs burner program**
   ([`program/`](program/programs/pairs_burner/src/lib.rs)). It has no private key. The program has exactly one
   instruction, `burn`, which burns everything the burner holds. No withdraw, no transfer, no admin. Anyone can call it.
3. **Every 5 minutes** a keeper sweeps each coin's waiting creator fees (bonding curve, and PumpSwap pool after
   graduation), collects them into the burner and calls `burn`, in one transaction of permissionless instructions.
   The burned amount is read from the program's `Burned` event and listed on the site with the transaction.

Burner program: `5TbC4U6rqpHqgdS4ngkmzkRPwP53bdeMoJrwhuAnVdS8` (Solana mainnet).

## Repository

| Path | What |
|---|---|
| `program/` | The burner program (Anchor 0.31.1). |
| `lib/pump.mjs` | pump.fun / PumpSwap instruction builders, from pump.fun's published IDLs (`lib/*.idl.json`). |
| `api/` | The server: pair picker, launch (prepare, simulate, relay), burn keeper, market reads. |
| `web/` | The site (React + Vite). |
| `e2e/` | End-to-end tests on a local validator with mainnet pump.fun cloned. |
| `scripts/` | Lookup tables, mainnet simulations (nothing sent), operator commands. |
| `tools/grind/` | Grinds `…pair` mint keypairs. |

## Run

```
npm install
npm test                      # unit tests
npm run dev                   # site :5411, API :5410
npm run build && npm start    # one process on :5410
```

Env: `SOLANA_RPC` (a keyed RPC), `PAIRS_MASTER_KEY` (64 hex), `KEEPER_KEY_FILE` (pays network fees only). Optional:
`KEEPER_DRY_RUN=1`, `KEEPER_INTERVAL_SECONDS` (300), `MIN_BURN_USD` (0.1), `VANITY_REQUIRED`, `MAX_DEV_BUY_SOL`.

End to end: `CLONE_RPC_URL=<keyed rpc> node e2e/clone-list.mjs > e2e/clones.txt`, then `bash e2e/validator.sh`
(after `anchor build` in `program/`), then `node e2e/chain.mjs`, `node e2e/api.mjs`, `node e2e/graduation.mjs`.
