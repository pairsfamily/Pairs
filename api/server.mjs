// Pairs: HTTP API, burn keeper and the built site, in one Node process.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { env, num, PROD, ROOT } from './env.mjs';
import { ApiError } from './errors.mjs';
import * as sol from './sol.mjs';
import * as auth from './auth.mjs';
import * as launch from './launch.mjs';
import * as market from './market.mjs';
import * as keeper from './keeper.mjs';
import * as quotes from './quotes.mjs';
import * as images from './images.mjs';
import * as vanity from './vanity.mjs';
import * as health from './health.mjs';
import * as lut from './lut.mjs';
import { getKv } from './db.mjs';
import { BURNER_PROGRAM } from '../lib/pump.mjs';

const PORT = num('PORT', 5410);
const DIST = path.join(ROOT, 'web', 'dist');
const COOKIE = 'pairs_session';
const MAX_BODY = 7 * 1024 * 1024;

/* ───────────── rate limits (per IP, in memory) ───────────── */

const buckets = new Map();
function limit(ip, key, perWindow, windowMs) {
  const k = `${key}:${ip}`;
  const b = buckets.get(k);
  const t = Date.now();
  if (!b || t - b.start > windowMs) {
    buckets.set(k, { start: t, n: 1 });
    return;
  }
  if (++b.n > perWindow) throw new ApiError('Too many requests, slow down a little', 429);
}
setInterval(() => { const t = Date.now(); for (const [k, b] of buckets) if (t - b.start > 3_600_000) buckets.delete(k); }, 600_000).unref();

/* ───────────── plumbing ───────────── */

function send(res, status, body, headers = {}) {
  const json = typeof body !== 'string' && !Buffer.isBuffer(body);
  res.writeHead(status, { 'content-type': json ? 'application/json; charset=utf-8' : headers['content-type'] || 'text/plain; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', ...headers });
  res.end(json ? JSON.stringify(body, (_k, v) => (typeof v === 'bigint' ? String(v) : v)) : body);
}
async function readBody(req, max = MAX_BODY) {
  const parts = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > max) throw new ApiError(`Request body is over ${Math.round(max / 1024 / 1024)} MB`, 413);
    parts.push(c);
  }
  const raw = Buffer.concat(parts);
  if (!raw.length) return {};
  let v;
  try {
    v = JSON.parse(raw.toString('utf8'));
  } catch {
    throw new ApiError('Body must be JSON');
  }
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new ApiError('Body must be a JSON object');
  return v;
}
function cookies(req) {
  const out = {};
  for (const part of (req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i <= 0) continue;
    try {
      out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
    } catch {}
  }
  return out;
}
const sessionCookie = (value, maxAge) => `${COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${PROD ? '; Secure' : ''}`;
const sessionOf = (req) => auth.sessionWallet(cookies(req)[COOKIE]);
const cookie = (name, value, maxAge) => `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${PROD ? '; Secure' : ''}`;
// The private preview of the site's own token: a browser that opened /api/preview/<token> (kv previewToken) also sees
// rows with status 'preview'. Nobody else does. The token is random, made by scripts/pairs.mjs preview on.
const PREVIEW_COOKIE = 'pairs_preview';
const previewOf = (req) => { const t = getKv('previewToken', null); const c = cookies(req)[PREVIEW_COOKIE]; return Boolean(t && c && c.length === t.length && c === t); };
const redirect = (res, to) => { res.writeHead(302, { location: to, 'cache-control': 'no-store' }); res.end(); };

/* ───────────── routes ───────────── */

const routes = [];
const route = (method, pattern, fn) => routes.push({ method, re: new RegExp(`^${pattern.replace(/:(\w+)/g, '(?<$1>[^/]+)')}$`), fn });
const mintOf = (p) => sol.requireMint(p.mint).toBase58();

route('GET', '/api/config', async ({ req }) => ({
  brand: 'pairs.family', explorer: sol.EXPLORER,
  feeRates: launch.FEE_RATES, maxDevBuySol: launch.MAX_DEV_BUY_SOL,
  keeper: { enabled: keeper.enabled, dryRun: keeper.DRY, intervalMinutes: keeper.status().intervalMs / 60_000, minBurnUsd: keeper.status().minBurnUsd, address: keeper.keeperAddress() },
  burnerProgram: BURNER_PROGRAM.toBase58(), launchesPerWalletDay: launch.LAUNCHES_PER_WALLET_DAY,
  vanity: { suffix: vanity.SUFFIX, required: vanity.REQUIRED, ready: vanity.freshCount() },
  launchReady: Boolean(await lut.launchTable().catch(() => null)) && (!vanity.REQUIRED || vanity.freshCount() > 0),
  launchOpen: launch.launchOpen(),
  // the site's own token { mint, symbol }: the live one, or (preview cookie only) the preview's
  token: getKv('token', null) || (previewOf(req) ? getKv('previewTokenInfo', null) : null),
}));
route('GET', '/api/health', async () => { const r = await health.report(); return { ...r, problems: r.problems.map(({ level, text }) => ({ level, text })) }; });
route('GET', '/api/stats', async () => market.stats());
route('GET', '/api/burns/recent', async ({ query }) => market.recentBurns(query.get('limit') || 12, query.get('offset') || 0));
route('GET', '/api/pairs', async ({ ip }) => { limit(ip, 'pairs', 60, 60_000); return market.pairs(); });
route('GET', '/api/coins', async ({ req, query, ip }) => { limit(ip, 'list', 120, 60_000); return market.list({ sort: query.get('sort') || 'new', q: query.get('q') || '', pair: query.get('pair') || '', limit: query.get('limit'), preview: previewOf(req) }); });
route('GET', '/api/coins/:mint', async ({ req, params }) => market.get(mintOf(params), { preview: previewOf(req) }));
route('GET', '/api/preview/:token', async ({ params, res, ip }) => {
  limit(ip, 'preview', 20, 600_000);
  const t = getKv('previewToken', null);
  if (!t || String(params.token) !== t) throw new ApiError('This preview link is not valid', 404);
  res.setHeader('set-cookie', cookie(PREVIEW_COOKIE, t, 7 * 86_400));
  redirect(res, '/');
});

/* the pair picker */
route('GET', '/api/quotes/popular', async ({ ip }) => { limit(ip, 'quotes', 60, 60_000); return quotes.popular(); });
route('GET', '/api/quotes/search', async ({ query, ip }) => { limit(ip, 'qsearch', 60, 60_000); return quotes.search(query.get('q')); });
route('GET', '/api/quotes/:mint', async ({ params, ip }) => { limit(ip, 'qresolve', 60, 60_000); const q = await quotes.resolve(params.mint); return { ok: q.ok, reason: q.reason || null, kind: q.kind || null, mint: q.mint, decimals: q.decimals ?? null, meta: q.meta || null, payInSol: q.ok && q.kind !== 'listed' }; });

route('GET', '/api/mine', async ({ req }) => {
  const w = sessionOf(req);
  if (!w) throw new ApiError('Sign in first', 401);
  return market.mine(w);
});
route('GET', '/api/nonce', async ({ ip }) => { limit(ip, 'nonce', 30, 60_000); return auth.newNonce(); });
route('GET', '/api/session', async ({ req }) => ({ wallet: sessionOf(req) }));
route('POST', '/api/session', async ({ body, ip, res }) => {
  limit(ip, 'signin', 20, 60_000);
  const s = auth.signIn(body);
  res.setHeader('set-cookie', sessionCookie(s.sid, s.maxAge));
  return { wallet: s.wallet };
});
route('DELETE', '/api/session', async ({ req, res }) => {
  auth.signOut(cookies(req)[COOKIE]);
  res.setHeader('set-cookie', sessionCookie('', 0));
  return { ok: true };
});

route('POST', '/api/launch/prepare', async ({ req, body, ip }) => { limit(ip, 'prepare', 10, 3_600_000); return launch.prepare(body, sessionOf(req)); });
route('POST', '/api/launch/submit', async ({ req, body }) => launch.submit(body, sessionOf(req)));
route('POST', '/api/launch/relock', async ({ req, body }) => launch.relock(String(body.mint || ''), sessionOf(req)));

/* ───────────── static site ───────────── */

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon', '.json': 'application/json', '.webp': 'image/webp', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8', '.md': 'text/markdown; charset=utf-8', '.xml': 'application/xml' };
function serveStatic(res, url) {
  const rel = path.normalize(decodeURIComponent(url.pathname)).replace(/^([/\\])+/, '');
  const file = path.join(DIST, rel);
  if (file.startsWith(DIST + path.sep) && fs.existsSync(file) && fs.statSync(file).isFile()) {
    const hashed = rel.startsWith('assets/');
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream', 'cache-control': hashed ? 'public, max-age=31536000, immutable' : 'no-cache' });
    fs.createReadStream(file).on('error', () => res.destroy()).pipe(res);
    return;
  }
  // A missing hashed asset must 404, never fall back to index.html (a stale tab would render blank).
  if (rel.startsWith('assets/') || TYPES[path.extname(rel).toLowerCase()]) return send(res, 404, 'Not found');
  const index = path.join(DIST, 'index.html');
  if (!fs.existsSync(index)) return send(res, 404, 'Site not built. Run npm run build, or use npm run dev.');
  res.writeHead(200, { 'content-type': TYPES['.html'], 'cache-control': 'no-cache' });
  fs.createReadStream(index).on('error', () => res.destroy()).pipe(res);
}

/* ───────────── server ───────────── */

const server = http.createServer(async (req, res) => {
  let url;
  try {
    url = new URL(req.url, 'http://x');
  } catch {
    return send(res, 400, 'Bad request');
  }
  // Behind Caddy the LAST X-Forwarded-For entry is the one Caddy appended (the real client).
  const fwd = env('TRUST_PROXY') === '1' ? String(req.headers['x-forwarded-for'] || '').split(',').map((x) => x.trim()).filter(Boolean) : [];
  const ip = fwd.at(-1) || String(req.socket.remoteAddress || '');
  try {
    if (url.pathname.startsWith('/api/logos/')) {
      if (!images.serveLogo(res, path.basename(url.pathname))) send(res, 404, { error: 'Not found' });
      return;
    }
    if (url.pathname.startsWith('/api/')) {
      if (req.method === 'POST') limit(ip, 'post', 60, 60_000);
      for (const r of routes) {
        const m = r.method === req.method && url.pathname.match(r.re);
        if (!m) continue;
        const body = req.method === 'POST' ? await readBody(req) : null;
        const out = await r.fn({ req, res, params: m.groups || {}, query: url.searchParams, body, ip });
        if (res.writableEnded) return; // a redirect wrote the response itself
        return send(res, 200, out);
      }
      return send(res, 404, { error: 'No such endpoint' });
    }
    return serveStatic(res, url);
  } catch (e) {
    if (e instanceof URIError) return send(res, 400, 'Bad request');
    if (!e.expose) console.error(req.method, url.pathname, e);
    return send(res, e.status || 500, { error: e.expose ? e.message : 'Something went wrong on pairs.family. Try again in a minute.', stage: e.stage || undefined });
  }
});

keeper.start();
vanity.start();
health.start();
setInterval(() => { try { const n = images.gc(market.allImages()); if (n) console.log(`removed ${n} orphaned logo(s)`); } catch (e) { console.error('logo gc', e.message); } }, 6 * 3_600_000).unref();
setInterval(() => launch.reconcile().then((n) => n && console.log(`reconciled ${n} launch(es) found routed on chain`)).catch((e) => console.error('reconcile', e.message)), 60_000).unref();
server.listen(PORT, '127.0.0.1', () => console.log(`pairs on http://127.0.0.1:${PORT} (rpc ${sol.RPC_URL.replace(/api-key=[^&]+/, 'api-key=***')})`));
