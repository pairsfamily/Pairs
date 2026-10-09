async function req(path, opts = {}) {
  const r = await fetch(path, { credentials: 'same-origin', cache: 'no-store', ...opts });
  const text = await r.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {}
  if (!r.ok) throw Object.assign(new Error(body?.error || `Request failed (${r.status})`), { status: r.status, stage: body?.stage ?? null });
  return body;
}
const post = (path, data, method = 'POST') => req(path, { method, headers: { 'content-type': 'application/json' }, body: data === undefined ? undefined : JSON.stringify(data) });

export const api = {
  config: () => req('/api/config'),
  stats: () => req('/api/stats'),
  recentBurns: (limit = 12, offset = 0) => req(`/api/burns/recent?limit=${limit}&offset=${offset}`),
  pairs: () => req('/api/pairs'),
  coins: ({ sort = 'new', q = '', pair = '' } = {}) => req(`/api/coins?sort=${sort}${q ? `&q=${encodeURIComponent(q)}` : ''}${pair ? `&pair=${pair}` : ''}`),
  coin: (mint) => req(`/api/coins/${mint}`),
  popularQuotes: () => req('/api/quotes/popular'),
  searchQuotes: (q) => req(`/api/quotes/search?q=${encodeURIComponent(q)}`),
  resolveQuote: (mint) => req(`/api/quotes/${mint}`),
  mine: () => req('/api/mine'),
  nonce: () => req('/api/nonce'),
  session: () => req('/api/session'),
  signIn: (data) => post('/api/session', data),
  signOut: () => req('/api/session', { method: 'DELETE' }),
  prepare: (form) => post('/api/launch/prepare', form),
  submit: (mint, transactions) => post('/api/launch/submit', { mint, transactions }),
  relock: (mint) => post('/api/launch/relock', { mint }),
};
