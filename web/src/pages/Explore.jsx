import { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api.js';
import { usePoll } from '../lib/data.js';
import { Link, navigate } from '../lib/router.js';
import { CoinCard } from '../components/Chrome.jsx';
import { ISearch } from '../components/Icons.jsx';

const SORTS = {
  graduated: [['new', 'Newest'], ['cap', 'Market cap'], ['burned', 'Most burned']],
  curve: [['new', 'Newest'], ['progress', 'Near graduation'], ['cap', 'Market cap'], ['burned', 'Most burned']],
};
const by = {
  new: (a, b) => new Date(b.liveAt) - new Date(a.liveAt),
  cap: (a, b) => (b.market?.capUsd ?? -1) - (a.market?.capUsd ?? -1),
  burned: (a, b) => (b.burned.usd ?? 0) - (a.burned.usd ?? 0),
  progress: (a, b) => (b.market?.progress ?? 0) - (a.market?.progress ?? 0),
};

/** One titled section: name + count, a line under it, its own sort buttons, the cards. */
function Section({ title, blurb, rows, kind, empty, loading }) {
  const [sort, setSort] = useState('new');
  const shown = useMemo(() => [...rows].sort(by[sort]), [rows, sort]);
  return (
    <section className="sect">
      <div className="sect-head">
        <div>
          <div className="row" style={{ gap: 12 }}><h2 className="sect-title">{title}</h2>{!loading && <span className="count-pill">{rows.length}</span>}</div>
          <p className="muted" style={{ margin: '6px 0 0', fontSize: 16 }}>{blurb}</p>
        </div>
        <div className="tabs">{SORTS[kind].map(([k, l]) => <button key={k} className={sort === k ? 'on' : ''} onClick={() => setSort(k)}>{l}</button>)}</div>
      </div>
      {loading ? <div className="empty"><span className="spinner" style={{ display: 'inline-block' }} /></div>
        : shown.length === 0 ? <div className="card empty">{empty}</div>
        : <div className="grid coins">{shown.map((c) => <CoinCard key={c.mint} c={c} />)}</div>}
    </section>
  );
}

export default function Explore() {
  const [q, setQ] = useState('');
  // ?pair=<mint>: only the coins on that pair (links from a coin page and the pairs board).
  const pairParam = () => new URLSearchParams(location.search).get('pair') || '';
  const [pair, setPair] = useState(pairParam);
  useEffect(() => { const h = () => setPair(pairParam()); addEventListener('popstate', h); return () => removeEventListener('popstate', h); }, []);
  const [coins, err] = usePoll(() => api.coins({ sort: 'new', q, pair }), 30_000, [q, pair]);
  const all = coins?.coins || [];
  // ⛔ A coin appears in exactly ONE section. A completed curve waiting for its pool counts as graduated.
  const graduated = all.filter((c) => c.market && c.market.phase !== 'curve');
  const onCurve = all.filter((c) => !c.market || c.market.phase === 'curve');
  const loading = !coins && !err;
  return (
    <div className="page">
      <div className="chead">
        <div className="eyebrow">Explore</div>
        <h1 className="h1" style={{ marginTop: 12 }}>Every token launched here</h1>
        <p className="lede">Every token is paired with a custom pair, and every creator fee it earns burns that custom pair.</p>
        <div className="row" style={{ justifyContent: 'center', marginTop: 22, gap: 10, flexWrap: 'wrap' }}>
          <label className="row" style={{ gap: 6, background: 'var(--panel)', border: '1px solid var(--edge-lit)', borderRadius: 999, padding: '9px 16px' }}>
            <ISearch size={15} /><input aria-label="Search coins" placeholder="Name, ticker or pair" value={q} onChange={(e) => setQ(e.target.value)} style={{ border: 0, outline: 0, background: 'transparent', width: 200 }} />
          </label>
          {pair && all[0] && <button className="badge green" style={{ border: 0, cursor: 'pointer' }} onClick={() => navigate('/explore')}>Only coins on ${all[0].pair.symbol} ✕</button>}
        </div>
      </div>
      {err && !coins && <div className="notice bad">Could not load coins: {err.message}</div>}
      <Section title="Graduated" blurb="Tokens that graduated." rows={graduated} kind="graduated" loading={loading} empty={q || pair ? 'No graduated token matches that.' : 'No token has graduated yet.'} />
      <Section title="On the curve" blurb="Tokens still climbing toward graduation." rows={onCurve} kind="curve" loading={loading}
        empty={q || pair ? 'No token on the curve matches that.' : <>Nothing has been launched yet. <div style={{ marginTop: 14 }}><Link href="/launch" className="btn primary">Launch a token</Link></div></>} />
    </div>
  );
}
