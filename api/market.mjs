/**
 * Public reads. A Pairs coin is priced IN Q (its pair): on its curve from the bonding curve, once graduated from its
 * own PumpSwap pool against Q (the curve then reads all zeroes). USD = price in Q × Q's USD price (Jupiter).
 * Lists read every coin's chain state in a few batched calls, shared 60 s; a value that cannot be read is null, never 0.
 */
import { PublicKey } from '@solana/web3.js';
import { all, one, now, HOUR } from './db.mjs';
import * as sol from './sol.mjs';
import { ApiError } from './errors.mjs';
import * as quotes from './quotes.mjs';
import { launchKeeperStatus } from './keeper.mjs';
import { ata, TOKEN_2022, bondingCurveAddress, decodeBondingCurve, decodePool, coinPoolAddress, poolVirtualQuote, tokenAccountAmount, CURVE_TOKENS_FOR_SALE, COIN_DECIMALS } from '../lib/pump.mjs';

const quoteOf = (row) => JSON.parse(row.quote_json);
const units = (v, d) => Number(v) / 10 ** d;

/** Chain state for many coins: 2 batched reads (+2 for graduated ones). { [mint]: { phase, progress, priceQ, supply, pool } } */
export async function chainMarkets(rows) {
  const chunk = async (ks) => { const out = []; for (let i = 0; i < ks.length; i += 100) out.push(...(await sol.conn.getMultipleAccountsInfo(ks.slice(i, i + 100), 'confirmed'))); return out; };
  const first = await chunk(rows.flatMap((r) => [bondingCurveAddress(new PublicKey(r.mint)), new PublicKey(r.mint)]));
  const out = {}, grads = [];
  rows.forEach((r, i) => {
    const curveInfo = first[2 * i], mintInfo = first[2 * i + 1];
    if (!curveInfo || !mintInfo) { out[r.mint] = null; return; }
    const c = decodeBondingCurve(curveInfo.data), q = quoteOf(r);
    const supply = units(mintInfo.data.readBigUInt64LE(36), COIN_DECIMALS);
    const m = { phase: c.complete ? 'graduated' : 'curve', progress: 1, priceQ: null, supply, pool: null };
    const vt = BigInt(c.virtual_token_reserves.toString()), vq = BigInt(c.virtual_quote_reserves.toString());
    if (!c.complete) {
      if (vt > 0n) m.priceQ = units(vq, q.decimals) / units(vt, COIN_DECIMALS);
      m.progress = Math.max(0, Math.min(1, 1 - Number(BigInt(c.real_token_reserves.toString())) / Number(CURVE_TOKENS_FOR_SALE)));
    } else {
      // ⛔ A completed curve's virtual reserves are STALE: the completing buy goes on past the curve at the future pool's
      // price (synthetic migration, pump-public-docs SYNTHETIC_MIGRATION.md; ×3 to ×137 off on the clone, 9 Oct). Until
      // migrate_v2 runs, the price is the pool's opening one: quote = real_quote_reserves + post_complete_quote_in (no
      // migration fee on a token pair), base = the curve's token balance (read below). After migration the curve reads
      // ALL ZEROES and the pool prices it.
      m.openingQuote = BigInt(c.real_quote_reserves.toString()) + BigInt((c.post_complete_quote_in ?? 0).toString());
      grads.push(r);
    }
    out[r.mint] = m;
  });
  if (grads.length) {
    const poolAddrs = grads.map((r) => coinPoolAddress(r.mint, quoteOf(r)));
    const pools = await chunk(poolAddrs);
    const waiting = grads.filter((r, i) => !(pools[i] && pools[i].data.length >= 200));
    const curveBase = waiting.length ? await chunk(waiting.map((r) => ata(bondingCurveAddress(new PublicKey(r.mint)), new PublicKey(r.mint), TOKEN_2022))) : [];
    const legs = [];
    grads.forEach((r, i) => {
      const p = pools[i];
      if (p && p.data.length >= 200) { const d = decodePool(p.data); legs.push({ r, pool: poolAddrs[i], vq: poolVirtualQuote(p.data), base: d.pool_base_token_account, quote: d.pool_quote_token_account }); }
      else out[r.mint].phase = 'migrating'; // complete, pool not made yet: priced at the pool's opening reserves
    });
    waiting.forEach((r, i) => {
      const m = out[r.mint], b = curveBase[i];
      const base = b ? tokenAccountAmount(b.data) : 0n;
      if (base > 0n && m.openingQuote > 0n) m.priceQ = units(m.openingQuote, quoteOf(r).decimals) / units(base, COIN_DECIMALS);
    });
    const accts = await chunk(legs.flatMap((l) => [l.base, l.quote]));
    legs.forEach((l, i) => {
      const m = out[l.r.mint], b = accts[2 * i], qa = accts[2 * i + 1], d = quoteOf(l.r).decimals;
      m.pool = l.pool.toBase58();
      if (b && qa) { const bb = units(tokenAccountAmount(b.data), COIN_DECIMALS), qq = units(tokenAccountAmount(qa.data) + l.vq, d); if (bb > 0 && qq > 0) m.priceQ = qq / bb; }
    });
  }
  return out;
}

const liveRows = () => all("SELECT * FROM launches WHERE status = 'live' AND hidden = 0 ORDER BY live_at DESC LIMIT 500");
/** Rows a visitor may see: live ones, plus the private preview for a browser holding the preview cookie. */
const visibleRows = (preview) => all(`SELECT * FROM launches WHERE (status = 'live'${preview ? " OR status = 'preview'" : ''}) AND hidden = 0 ORDER BY official DESC, live_at DESC LIMIT 500`);
const listMarkets = sol.shared(async () => chainMarkets(liveRows().filter((r) => r.origin === 'pairs')), 60_000);

/**
 * An EXTERNAL token's market (the site's own token, launched on another platform): DexScreener's busiest pool for it,
 * shared 60 s. `marketMint` is the token's CA (or, in the private preview, a stand-in coin whose market is borrowed).
 * Null when nothing prices it; never 0.
 */
const external = sol.sharedMap(async (marketMint) => {
  const r = await fetch(`https://api.dexscreener.com/tokens/v1/solana/${marketMint}`, { signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new Error(`dexscreener ${r.status}`);
  const pools = (await r.json()) || [];
  const p = pools.sort((a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0))[0];
  if (!p) return null;
  const cap = Number(p.marketCap ?? p.fdv), price = Number(p.priceUsd);
  return { dexId: p.dexId, url: p.url, capUsd: cap > 0 ? cap : null, priceUsd: price > 0 ? price : null, quote: p.quoteToken ? { mint: p.quoteToken.address, symbol: p.quoteToken.symbol } : null };
}, 60_000, 50);
const externalMeta = (row) => JSON.parse(row.quote_json || '{}');

/**
 * An external token that is a pump.fun coin paired with SOL: its market straight from the chain (bonding curve, or its
 * PumpSwap pool once graduated), shared 20 s. Live from the first block, unlike DexScreener, which indexes with a delay.
 */
const SOL_QUOTE = JSON.stringify({ kind: 'sol', mint: 'So11111111111111111111111111111111111111112', tokenProgram: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', decimals: 9 });
const pumpExternal = sol.sharedMap(async (mint) => {
  const m = (await chainMarkets([{ mint, quote_json: SOL_QUOTE }]))[mint];
  if (!m) return null;
  const solUsd = await sol.solUsd();
  const capSol = m.priceQ != null && m.supply != null ? m.priceQ * m.supply : null;
  return { ...m, capUsd: capSol != null && solUsd ? capSol * solUsd : null };
}, 20_000, 50);

/** The card / page shape of an external (official) token. */
async function shapeExternal(row) {
  const x = externalMeta(row);
  const chain = await pumpExternal(x.marketMint || row.mint).catch(() => null);
  const d = await external(x.marketMint || row.mint).catch(() => null);
  // The pair the operator gave (the official token is paired with SOL), else whatever its busiest pool trades against.
  const qMint = x.pairMint || d?.quote?.mint || null;
  const qm = qMint ? await quotes.meta(qMint).catch(() => null) : null;
  const onPump = Boolean(chain) || d?.dexId === 'pumpfun', lm = x.marketMint || row.mint;
  return {
    mint: row.mint, name: row.name, symbol: row.symbol, image: row.image, description: row.description,
    socials: JSON.parse(row.socials_json || '{}'), launcher: null, feeWallet: null, creatorFeeBps: null, official: true, origin: 'external', preview: row.status === 'preview',
    pair: { mint: qMint, kind: null, symbol: qm?.symbol || d?.quote?.symbol || null, name: qMint === 'So11111111111111111111111111111111111111112' ? 'Solana' : qm?.name || null, icon: qm?.icon || null, usdPrice: qm?.usdPrice ?? null, decimals: null },
    createdAt: new Date(row.created_at).toISOString(), liveAt: row.live_at ? new Date(row.live_at).toISOString() : null,
    market: chain ? { phase: chain.phase, graduated: chain.phase === 'graduated', migrating: chain.phase === 'migrating', progress: chain.phase === 'curve' ? chain.progress : null, priceQ: null, capQ: null, capUsd: chain.capUsd ?? d?.capUsd ?? null, pool: chain.pool }
      : d ? { phase: onPump ? 'curve' : 'graduated', graduated: !onPump, migrating: false, progress: null, priceQ: null, capQ: null, capUsd: d.capUsd, pool: null } : null,
    burned: { amount: 0, usd: null, count: 0 },
    // Links follow the market's coin: the CA itself once live; in the preview, the stand-in whose market is borrowed.
    links: { pump: onPump ? `https://pump.fun/coin/${lm}` : d?.url || `https://dexscreener.com/solana/${lm}`, dex: `https://dexscreener.com/solana/${lm}`, token: `${sol.EXPLORER}/token/${lm}`, feeWallet: null, pair: qMint ? `${sol.EXPLORER}/token/${qMint}` : null },
  };
}
const coinMarket = sol.sharedMap(async (mint) => (await chainMarkets([one('SELECT * FROM launches WHERE mint = ?', mint)]))[mint], 30_000);

/**
 * How each pair trades NOW ('curve' | 'pool' | 'listed'): the kind stored at launch goes stale when a pump coin pair
 * graduates later. Only pairs stored as 'curve' can change: their curves are re-read in one batched call, cached 5 min.
 */
const liveKinds = sol.shared(async () => {
  const ms = all("SELECT DISTINCT quote_mint FROM launches WHERE status = 'live' AND origin = 'pairs' AND json_extract(quote_json, '$.kind') = 'curve'").map((r) => r.quote_mint);
  const out = {};
  for (let i = 0; i < ms.length; i += 100) {
    const infos = await sol.conn.getMultipleAccountsInfo(ms.slice(i, i + 100).map((m) => bondingCurveAddress(new PublicKey(m))));
    ms.slice(i, i + 100).forEach((m, j) => { if (infos[j]) out[m] = decodeBondingCurve(infos[j].data).complete ? 'pool' : 'curve'; });
  }
  return out;
}, 300_000);
const kindNow = (kinds, mint, stored) => (stored === 'curve' && kinds?.[mint]) || stored;

/** Q's USD price and look for every pair in `rows`, in one Jupiter call. */
async function pairMeta(rows) {
  const ms = [...new Set(rows.map((r) => r.quote_mint))];
  return ms.length ? quotes.metaMany(ms).catch(() => ({})) : {};
}

/** Q burned for a coin (or for a pair, or everything): confirmed burns, in Q units. Dry runs never count. */
const burnedUnits = (where, ...p) => BigInt(one(`SELECT COALESCE(SUM(CAST(amount AS INTEGER)), 0) AS t FROM burns WHERE status = 'ok' AND ${where}`, ...p)?.t ?? 0);

function shape(row, m, qm, kinds = null) {
  const q = quoteOf(row);
  const qUsd = qm?.usdPrice ?? null;
  const burned = units(burnedUnits('mint = ?', row.mint), q.decimals);
  const capQ = m?.priceQ != null && m?.supply != null ? m.priceQ * m.supply : null;
  return {
    mint: row.mint, name: row.name, symbol: row.symbol, image: row.image, description: row.description,
    socials: JSON.parse(row.socials_json || '{}'), launcher: row.launcher, feeWallet: row.fee_wallet,
    creatorFeeBps: row.creator_fee_bps, official: false, origin: 'pairs', preview: false,
    pair: { mint: q.mint, kind: kindNow(kinds, q.mint, q.kind), symbol: qm?.symbol || row.quote_symbol || null, name: qm?.name || null, icon: qm?.icon || null, usdPrice: qUsd, decimals: q.decimals },
    createdAt: new Date(row.created_at).toISOString(), liveAt: row.live_at ? new Date(row.live_at).toISOString() : null,
    market: m ? { phase: m.phase, graduated: m.phase === 'graduated', migrating: m.phase === 'migrating', progress: m.progress, priceQ: m.priceQ, capQ, capUsd: capQ != null && qUsd ? capQ * qUsd : null, pool: m.pool } : null,
    burned: { amount: burned, usd: qUsd ? burned * qUsd : null, count: one("SELECT COUNT(*) AS n FROM burns WHERE mint = ? AND status = 'ok'", row.mint).n },
    links: { pump: `https://pump.fun/coin/${row.mint}`, dex: `https://dexscreener.com/solana/${row.mint}`, token: `${sol.EXPLORER}/token/${row.mint}`, feeWallet: `${sol.EXPLORER}/account/${row.fee_wallet}`, pair: `${sol.EXPLORER}/token/${q.mint}` },
  };
}

export async function list({ sort = 'new', q = '', pair = '', limit = 100, preview = false } = {}) {
  let rows = visibleRows(preview);
  const s = String(q || '').trim().toLowerCase();
  if (s) rows = rows.filter((r) => r.name.toLowerCase().includes(s) || r.symbol.toLowerCase().includes(s) || r.mint === q.trim() || (r.quote_symbol || '').toLowerCase() === s);
  if (pair) rows = rows.filter((r) => r.quote_mint === pair);
  const own = rows.filter((r) => r.origin === 'pairs');
  const [markets, metas, kinds] = await Promise.all([listMarkets().catch(() => ({})), pairMeta(own), liveKinds().catch(() => null)]);
  const ext = Object.fromEntries(await Promise.all(rows.filter((r) => r.origin !== 'pairs').map(async (r) => [r.mint, await shapeExternal(r)])));
  let out = rows.map((r) => (r.origin === 'pairs' ? shape(r, markets[r.mint], metas[r.quote_mint], kinds) : ext[r.mint]));
  if (sort === 'cap') out.sort((a, b) => (b.market?.capUsd ?? -1) - (a.market?.capUsd ?? -1));
  if (sort === 'burned') out.sort((a, b) => (b.burned.usd ?? 0) - (a.burned.usd ?? 0));
  if (sort === 'progress') out.sort((a, b) => (b.market?.progress ?? 0) - (a.market?.progress ?? 0));
  if (!s) out.sort((a, b) => Number(b.official) - Number(a.official)); // the site's own token pinned first
  return { coins: out.slice(0, Math.min(Number(limit) || 100, 200)), total: out.length };
}

export async function get(mint, { preview = false } = {}) {
  const row = one(`SELECT * FROM launches WHERE mint = ? AND (status = 'live'${preview ? " OR status = 'preview'" : ''}) AND hidden = 0`, mint);
  if (!row) throw new ApiError('No such coin on pairs.family', 404);
  if (row.origin !== 'pairs') return { ...(await shapeExternal(row)), waiting: null, keeper: null, burns: [], signatures: { launch: null, firstBuy: null } };
  const [m, qm, kinds] = await Promise.all([coinMarket(mint).catch(() => null), quotes.meta(row.quote_mint).catch(() => null), liveKinds().catch(() => null)]);
  const q = quoteOf(row);
  const ks = launchKeeperStatus(mint);
  const burns = all("SELECT amount, decimals, sig, status, created_at FROM burns WHERE mint = ? AND status IN ('ok', 'pending') ORDER BY created_at DESC LIMIT 100", mint)
    .map((b) => ({ amount: units(b.amount, b.decimals), sig: b.sig, status: b.status, at: new Date(b.created_at).toISOString(), url: b.sig ? `${sol.EXPLORER}/tx/${b.sig}` : null }));
  return {
    ...shape(row, m, qm, kinds),
    waiting: ks?.waiting != null ? units(ks.waiting, q.decimals) : null,
    keeper: ks ? { note: ks.note || null, error: ks.error ? 'The last burn attempt failed; it is retried every pass.' : null, at: ks.at ? new Date(ks.at).toISOString() : null } : null,
    burns,
    signatures: { launch: row.sig, firstBuy: row.buy_sig },
  };
}

/** Every pair used on Pairs, with how many coins it carries and how much of it was burned. */
export async function pairs() {
  const rows = all(`SELECT quote_mint, MAX(quote_json) AS qj, MAX(quote_symbol) AS sym, COUNT(*) AS coins FROM launches WHERE status = 'live' AND hidden = 0 AND origin = 'pairs' GROUP BY quote_mint`);
  const [metas, kinds] = await Promise.all([quotes.metaMany(rows.map((r) => r.quote_mint)).catch(() => ({})), liveKinds().catch(() => null)]);
  const out = rows.map((r) => {
    const q = JSON.parse(r.qj), qm = metas[r.quote_mint];
    const burned = units(burnedUnits('quote_mint = ?', r.quote_mint), q.decimals);
    return { mint: r.quote_mint, symbol: qm?.symbol || r.sym, name: qm?.name || null, icon: qm?.icon || null, kind: kindNow(kinds, r.quote_mint, q.kind), coins: r.coins, burned, burnedUsd: qm?.usdPrice ? burned * qm.usdPrice : null, usdPrice: qm?.usdPrice ?? null, mcap: qm?.mcap ?? null };
  });
  return { pairs: out.sort((a, b) => (b.burnedUsd ?? 0) - (a.burnedUsd ?? 0) || b.coins - a.coins) };
}

/** The burn ledger, newest first, with the pair's look: { burns, more }. `offset` pages ("Load more"). */
export async function recentBurns(limit = 12, offset = 0) {
  const lim = Math.min(Number(limit) || 12, 50), off = Math.max(0, Number(offset) || 0);
  const rows = all(`SELECT b.mint, b.quote_mint, b.amount, b.decimals, b.sig, b.created_at, l.symbol, l.name, l.image, l.quote_symbol FROM burns b JOIN launches l ON l.mint = b.mint
    WHERE b.status = 'ok' AND l.hidden = 0 ORDER BY b.created_at DESC LIMIT ? OFFSET ?`, lim + 1, off);
  const metas = await pairMeta(rows);
  return {
    burns: rows.slice(0, lim).map((b) => {
      const qm = metas[b.quote_mint], amt = units(b.amount, b.decimals);
      return { mint: b.mint, symbol: b.symbol, name: b.name, image: b.image, pair: { mint: b.quote_mint, symbol: qm?.symbol || b.quote_symbol, icon: qm?.icon || null }, amount: amt, usd: qm?.usdPrice ? amt * qm.usdPrice : null, sig: b.sig, url: `${sol.EXPLORER}/tx/${b.sig}`, at: new Date(b.created_at).toISOString() };
    }),
    more: rows.length > lim,
  };
}

export async function stats() {
  const p = await pairs();
  return {
    coins: one("SELECT COUNT(*) AS n FROM launches WHERE status = 'live' AND hidden = 0").n,
    pairs: p.pairs.length,
    burns: one("SELECT COUNT(*) AS n FROM burns WHERE status = 'ok'").n,
    burnedUsd: p.pairs.reduce((a, x) => a + (x.burnedUsd || 0), 0),
    burns24h: one("SELECT COUNT(*) AS n FROM burns WHERE status = 'ok' AND created_at > ?", now() - 24 * HOUR).n,
  };
}

export async function mine(wallet) {
  const rows = all("SELECT * FROM launches WHERE launcher = ? AND status IN ('live', 'created') ORDER BY created_at DESC LIMIT 100", wallet);
  const metas = await pairMeta(rows);
  return { coins: rows.map((r) => ({ ...shape(r, null, metas[r.quote_mint]), status: r.status, error: r.error })) };
}

/** Every logo a coin still uses (the image store's garbage collector keeps these). */
export const allImages = () => all('SELECT image FROM launches WHERE image IS NOT NULL').map((r) => r.image);
