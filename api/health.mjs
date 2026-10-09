/**
 * What is wrong right now. `report()` backs GET /api/health (public, nothing sensitive); problems are logged every
 * 5 minutes (once an hour per problem). Optional alerts: ALERT_WEBHOOK (Discord/Slack) or ALERT_TELEGRAM_BOT_TOKEN +
 * ALERT_TELEGRAM_CHAT_ID; with neither set it only logs.
 */
import { env } from './env.mjs';
import { one } from './db.mjs';
import * as sol from './sol.mjs';
import * as keeper from './keeper.mjs';
import * as vanity from './vanity.mjs';
import * as launch from './launch.mjs';
import * as lut from './lut.mjs';

const slotShared = sol.shared(() => sol.conn.getSlot(), 60_000);

export async function report() {
  const k = keeper.status();
  const problems = [];
  let slot = null;
  try {
    slot = await slotShared(); // /api/health is public: a cached slot, so polling it costs no credits
  } catch (e) {
    problems.push({ key: 'rpc', level: 'critical', text: `the Solana RPC is not answering: ${e.message}` });
  }
  if (!k.enabled) problems.push({ key: 'keeper-off', level: 'warning', text: 'no keeper wallet: fees are not burned' });
  if (k.lowGas) problems.push({ key: 'keeper-gas', level: 'warning', text: `keeper wallet low on SOL (${k.keeperSol}); top up ${keeper.keeperAddress()}` });
  if (k.lastRunAt && Date.now() - k.lastRunAt > Math.max(3 * k.intervalMs, 15 * 60_000)) problems.push({ key: 'keeper-stalled', level: 'critical', text: `the keeper has not run since ${new Date(k.lastRunAt).toISOString()}` });
  if (k.lastError) problems.push({ key: 'keeper-error', level: 'warning', text: `keeper: ${k.lastError}` });
  const stuck = one("SELECT COUNT(*) AS n FROM burns WHERE status = 'pending' AND created_at < ?", Date.now() - 30 * 60_000).n;
  if (stuck) problems.push({ key: 'burns-pending', level: 'warning', text: `${stuck} burn transaction${stuck === 1 ? '' : 's'} unconfirmed for over 30 minutes` });
  if (!(await lut.launchTable().catch(() => null))) problems.push({ key: 'launch-lut', level: 'critical', text: 'no launch lookup table: every launch is refused until `node scripts/make-lut.mjs` has run on the box' });
  const ready = vanity.freshCount();
  if (vanity.REQUIRED && launch.launchOpen() && ready === 0) problems.push({ key: 'vanity-empty', level: 'critical', text: `the ${vanity.SUFFIX} address pool is empty: every launch is refused until the grinder pushes more` });
  else if (vanity.REQUIRED && launch.launchOpen() && ready < 3) problems.push({ key: 'vanity-low', level: 'warning', text: `only ${ready} ${vanity.SUFFIX} address${ready === 1 ? '' : 'es'} ready` });
  return {
    ok: !problems.some((p) => p.level === 'critical'),
    at: new Date().toISOString(),
    rpcSlot: slot,
    vanity: { suffix: vanity.SUFFIX, ready },
    tables: { launch: lut.launchLutAddress(), pairTables: lut.pairLuts().length, pairsInTables: lut.pairLuts().reduce((a, t) => a + t.quotes.length, 0) },
    keeper: { enabled: k.enabled, dryRun: k.dryRun, lastRunAt: k.lastRunAt ? new Date(k.lastRunAt).toISOString() : null, launches: k.launches ?? null, keeperSol: k.keeperSol ?? null },
    rpc: sol.rpcUsage(),
    problems,
  };
}

async function notify(text) {
  console.log(`[alert] ${text}`);
  const posts = [];
  if (env('ALERT_WEBHOOK')) posts.push(fetch(env('ALERT_WEBHOOK'), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ content: text, text }), signal: AbortSignal.timeout(10_000) }));
  if (env('ALERT_TELEGRAM_BOT_TOKEN') && env('ALERT_TELEGRAM_CHAT_ID')) posts.push(fetch(`https://api.telegram.org/bot${env('ALERT_TELEGRAM_BOT_TOKEN')}/sendMessage`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ chat_id: env('ALERT_TELEGRAM_CHAT_ID'), text, disable_web_page_preview: true }), signal: AbortSignal.timeout(10_000) }));
  for (const r of await Promise.allSettled(posts)) if (r.status === 'rejected') console.error(`[alert] send failed: ${r.reason?.message}`);
}

const lastSent = new Map();
async function checkNow() {
  try {
    const { problems } = await report();
    const t = Date.now();
    const active = new Set(problems.map((p) => p.key));
    for (const p of problems) {
      if (t - (lastSent.get(p.key) ?? 0) < 3_600_000) continue;
      lastSent.set(p.key, t);
      await notify(`${p.level === 'critical' ? '🔴' : '🟡'} pairs: ${p.text}`);
    }
    for (const key of [...lastSent.keys()]) if (!active.has(key)) { lastSent.delete(key); await notify(`🟢 pairs: recovered (${key})`); }
  } catch (e) {
    console.error(`[alert] check failed: ${e.message}`);
  }
}

export function start() {
  setTimeout(checkNow, 60_000).unref();
  setInterval(checkNow, 5 * 60_000).unref();
}
