import { useState } from 'react';
import { api } from '../lib/api.js';
import { usePoll, copy, useConfig } from '../lib/data.js';
import { Link } from '../lib/router.js';
import { usd } from '../lib/format.js';
import { CoinCard, Emblem, BurnLedger } from '../components/Chrome.jsx';

const STEPS = [
  ['01', 'Choose a pair', 'Pair your coin with any Pumpfun coin on its bonding curve or PumpSwap or choose from Pumpfun’s custom pair list. Your pair is locked in at launch and can never be changed.'],
  ['02', 'Launch', 'One transaction creates your coin on Pumpfun with its burner set as the creator, and optionally makes your first buy. Just like a regular Pumpfun launch, nobody can buy before you.'],
  ['03', 'Buy pressure', 'Every buy goes through the pair first, creating buy pressure on the custom pair instead of draining its liquidity.'],
  ['04', 'Automated burns', 'Pumpfun pays creator fees in the pair token to an address controlled by the Pairs burner program, which can only burn them. Every 5 minutes, accumulated fees are burned on chain, with every burn publicly listed below.', 'burn'],
];

function Ledger({ stats }) {
  const [pages, setPages] = useState(1);
  const [d] = usePoll(() => api.recentBurns(8 * pages), 60_000, [pages]);
  return (
    <BurnLedger subtitle="Every burn our launchpad has made, on chain." count={stats?.burns ?? null} total={stats ? usd(stats.burnedUsd, { compact: false }) : null} totalLabel="burned, at today's prices"
      rows={d?.burns} more={d?.more} onMore={() => setPages((p) => p + 1)} empty="No burns yet." />
  );
}

export default function Home() {
  const cfg = useConfig();
  const [stats] = usePoll(() => api.stats(), 60_000);
  const [coins] = usePoll(() => api.coins({ sort: 'new' }), 30_000);
  const recent = coins?.coins?.slice(0, 6) || [];
  return (
    <>
      <div className="page" style={{ paddingBottom: 0 }}>
        <section className="hero">
          <Emblem />
          <h1 className="mega">Pairs</h1>
          <p className="lede">Launch custom pair Pumpfun tokens where every buy routes through it and creator rewards burns it.</p>
          <div className="hero-cta">
            <Link href="/launch" className="btn primary lg">Launch a token</Link>
            <Link href="/docs" className="btn lg">How it works</Link>
          </div>
          <div className="hero-ca">
            {cfg.token?.mint
              ? <button className="ca" onClick={() => copy(cfg.token.mint, 'CA copied')} title="Copy the contract address"><b>CA:</b>{cfg.token.mint}</button>
              : <span className="ca placeholder"><b>CA:</b>Coming soon</span>}
          </div>
        </section>
        <div className="strip">
          <div><span className="eyebrow">Burned</span><div className="v">{usd(stats?.burnedUsd, { compact: false })}</div></div>
          <div><span className="eyebrow">Pair launches</span><div className="v">{stats?.coins ?? '–'}</div></div>
          <div><span className="eyebrow">Fees to the burn</span><div className="v">100<small>%</small></div></div>
        </div>
      </div>

      <section className="band" style={{ marginTop: 64 }}>
        <div className="band-in">
          <div className="sec-title"><div className="ruled">How it works</div><h2 className="h2">Custom pairs on Pumpfun</h2></div>
          <div className="steps-list">
            {STEPS.map(([n, t, d, cls]) => <div key={n} className={`step-row ${cls || ''}`}><span className="n">{n}</span><h3>{t}</h3><p>{d}</p></div>)}
          </div>
        </div>
      </section>

      <div className="page">
        <section>
          <div className="sec-title"><h2 className="h2">Recent launches</h2></div>
          {coins && recent.length === 0 && <div className="card empty">No launches yet. <div style={{ marginTop: 14 }}><Link href="/launch" className="btn primary">Launch a token</Link></div></div>}
          {recent.length > 0 && <div className="grid coins">{recent.map((c) => <CoinCard key={c.mint} c={c} />)}</div>}
          {coins?.total > 0 && <div className="see-all"><Link href="/explore" className="btn">See all {coins.total} launches</Link></div>}
        </section>
        <div className="sec"><Ledger stats={stats} /></div>
      </div>
    </>
  );
}
