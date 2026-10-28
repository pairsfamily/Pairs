import { api } from '../lib/api.js';
import { usePoll, KIND } from '../lib/data.js';
import { Link } from '../lib/router.js';
import { usd, amount } from '../lib/format.js';
import { TokenIcon } from '../components/Chrome.jsx';
import { IFlame } from '../components/Icons.jsx';

export default function Pairs() {
  const [d, err] = usePoll(() => api.pairs(), 60_000);
  return (
    <div className="page">
      <div className="chead">
        <div className="eyebrow">Custom Pairs</div>
        <h1 className="h1" style={{ marginTop: 12 }}>Pairs being burned</h1>
        <p className="lede">Every token a pairs.family coin is paired with, how many coins support it and how many tokens are burned.</p>
        <div className="hero-cta" style={{ marginTop: 22 }}><Link href="/launch" className="btn primary">Pair a new coin</Link></div>
      </div>
      {err && !d && <div className="notice bad">{err.message}</div>}
      {d && d.pairs.length === 0 && <div className="card empty">No pairs yet.</div>}
      {d && d.pairs.length > 0 && (
        <div className="card table-wrap">
          <table className="table">
            <thead><tr><th>Pair</th><th className="r">Coins</th><th className="r">Burned</th><th className="r">Value burned</th><th className="r">Market cap</th></tr></thead>
            <tbody>
              {d.pairs.map((p) => (
                <tr key={p.mint}>
                  <td><Link href={`/explore?pair=${p.mint}`} className="row" style={{ gap: 10 }}><TokenIcon src={p.icon} label={p.symbol} size={32} /><span><b>${p.symbol}</b><div className="small muted">{KIND[p.kind]}</div></span></Link></td>
                  <td className="r">{p.coins}</td>
                  <td className="r"><IFlame size={13} /> {amount(p.burned)}</td>
                  <td className="r">{usd(p.burnedUsd)}</td>
                  <td className="r muted">{usd(p.mcap)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
