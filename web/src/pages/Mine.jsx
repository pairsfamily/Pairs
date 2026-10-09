import { api } from '../lib/api.js';
import { usePoll } from '../lib/data.js';
import { useWallet } from '../lib/wallet.jsx';
import { Link } from '../lib/router.js';
import { CoinCard, WalletButton } from '../components/Chrome.jsx';

export default function Mine() {
  const w = useWallet();
  const [d, err] = usePoll(() => (w.signedIn ? api.mine() : Promise.resolve(null)), 0, [w.signedIn]);
  return (
    <div className="page">
      <div className="chead">
        <div className="eyebrow">Your coins</div>
        <h1 className="h1" style={{ marginTop: 12 }}>My launches</h1>
        <p className="lede">Every coin launched from your wallet, with what it has burned.</p>
        <div className="hero-cta" style={{ marginTop: 22 }}>{w.signedIn ? <Link href="/launch" className="btn primary">Launch a token</Link> : <WalletButton big />}</div>
      </div>
      {err && <div className="notice bad">{err.message}</div>}
      {d && d.coins.length === 0 && <div className="card empty">No launches from this wallet yet.</div>}
      {d && d.coins.length > 0 && <div className="grid coins">{d.coins.map((c) => <CoinCard key={c.mint} c={c} />)}</div>}
    </div>
  );
}
