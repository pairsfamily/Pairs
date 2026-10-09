import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api.js';
import { useConfig, feeLabel, KIND } from '../lib/data.js';
import { navigate, Link } from '../lib/router.js';
import { useWallet } from '../lib/wallet.jsx';
import { usd, short } from '../lib/format.js';
import { TokenIcon, PairMark, WalletButton } from '../components/Chrome.jsx';
import { ISearch, IFlame, IRocket, ICheck, IClose } from '../components/Icons.jsx';

const B58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
/** How a pair trades, as the launch page words it. */
const LAUNCH_KIND = { ...KIND, listed: 'Pumpfun list' };

/** Search, paste or pick the pair. Calls onPick(resolved quote) once the chain says it is allowed. */
function PairPicker({ value, onPick }) {
  const [text, setText] = useState('');
  const [tab, setTab] = useState('pump');
  const [shelf, setShelf] = useState(null);
  const [results, setResults] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  useEffect(() => { api.popularQuotes().then(setShelf).catch(() => setShelf({ pumpCoins: [], listed: [] })); }, []);

  const resolve = async (mint) => {
    setBusy(true); setError(null);
    try {
      const q = await api.resolveQuote(mint);
      if (!q.ok) { setError(q.reason || 'pump.fun does not allow this token as a pair'); onPick(null); }
      else { onPick(q); setText(''); setResults(null); }
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  useEffect(() => {
    const s = text.trim();
    setError(null);
    if (!s) { setResults(null); return; }
    if (B58.test(s)) { resolve(s); return; }
    const t = setTimeout(() => api.searchQuotes(s).then((r) => setResults(r.results)).catch((e) => setError(e.message)), 300);
    return () => clearTimeout(t);
  }, [text]);

  if (value) {
    return (
      <div className="picker-sel">
        <TokenIcon src={value.meta?.icon} label={value.meta?.symbol} size={40} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="row" style={{ gap: 8 }}><b>${value.meta?.symbol || short(value.mint)}</b><span className="badge green">{LAUNCH_KIND[value.kind]}</span></div>
          <div className="small muted">{value.meta?.name} · {short(value.mint, 5)}{value.meta?.mcap ? ` · ${usd(value.meta.mcap)} cap` : ''}</div>
        </div>
        <button type="button" className="icon-btn" aria-label="Change the pair" onClick={() => onPick(null)}><IClose /></button>
      </div>
    );
  }
  const list = tab === 'pump' ? shelf?.pumpCoins : shelf?.listed;
  return (
    <div className="stack">
      <label className="row input" style={{ gap: 8, padding: '8px 12px' }}>
        <ISearch size={16} />
        <input aria-label="Search for a pair" placeholder="Paste a token address, or search: baton, BONK, Fartcoin" value={text} onChange={(e) => setText(e.target.value)} style={{ border: 0, outline: 0, flex: 1, background: 'transparent' }} />
        {busy && <span className="spinner" />}
      </label>
      {error && <div className="notice bad">{error}</div>}
      {results && (
        <div className="results">
          {results.length === 0 && <div className="pad small muted">No pump.fun coin or listed token matches. Paste its address instead.</div>}
          {results.map((r) => (
            <button type="button" key={r.mint} onClick={() => resolve(r.mint)}>
              <TokenIcon src={r.icon} label={r.symbol} size={28} />
              <div style={{ flex: 1, minWidth: 0 }}><b>${r.symbol}</b> <span className="muted small">{r.name}</span><div className="small muted mono">{short(r.mint, 5)}</div></div>
              <span className="small muted">{r.mcap ? usd(r.mcap) : ''}</span>
            </button>
          ))}
        </div>
      )}
      {!results && (
        <>
          <div className="picker-tabs">
            <div className="tabs"><button type="button" className={tab === 'pump' ? 'on' : ''} onClick={() => setTab('pump')}>Popular pump coins</button><button type="button" className={tab === 'listed' ? 'on' : ''} onClick={() => setTab('listed')}>Pumpfun list</button></div>
          </div>
          {!shelf && <div className="empty"><span className="spinner" style={{ display: 'inline-block' }} /></div>}
          {list && (
            <div className="shelf">
              {list.map((t) => (
                <button type="button" className="chip" key={t.mint} onClick={() => resolve(t.mint)} title={t.name}>
                  <TokenIcon src={t.icon} label={t.symbol} size={26} />
                  <span className="t"><b>${t.symbol}</b><span>{t.mcap ? usd(t.mcap) : LAUNCH_KIND[t.kind]}</span></span>
                </button>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

const STAGES = [['prepare', 'Building the launch'], ['sign', 'Approve in your wallet'], ['send', 'Launching on pump.fun'], ['done', 'Live']];

export default function Launch() {
  const cfg = useConfig();
  const w = useWallet();
  const fileRef = useRef(null);
  const [f, setF] = useState({ name: '', symbol: '', description: '', website: '', twitter: '' });
  const [image, setImage] = useState(null);
  const [dragging, setDragging] = useState(false);
  const [gate, setGate] = useState(false);
  const [pair, setPair] = useState(null);
  const [fee, setFee] = useState(0);
  const [buyAmt, setBuyAmt] = useState('');
  const [stage, setStage] = useState(null);
  const [error, setError] = useState(null);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: k === 'symbol' ? e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10) : e.target.value }));
  const pairSym = pair?.meta?.symbol ? `$${pair.meta.symbol}` : 'the pair';

  const pickImage = (file) => {
    if (!file) return;
    if (file.size > 4 * 1024 * 1024) { setError('The image is over 4 MB'); return; }
    const r = new FileReader();
    r.onload = () => setImage(r.result);
    r.readAsDataURL(file);
  };

  const ready = f.name.trim() && f.symbol && image && pair;
  const go = async (e) => {
    e.preventDefault();
    if (cfg.launchOpen === false) { setGate(true); return; }
    setError(null);
    try {
      if (!w.signedIn) await w.signIn();
      setStage('prepare');
      const p = await api.prepare({ ...f, imageData: image, quote: pair.mint, creatorFeeBps: fee, devBuy: buyAmt && (!pair || pair.payInSol) ? { currency: 'sol', amount: buyAmt } : null });
      setStage('sign');
      const signed = await w.signTransactions(p.transactions);
      setStage('send');
      const r = await api.submit(p.mint, signed);
      setStage('done');
      if (r.firstBuyError) sessionStorage.setItem(`fb:${p.mint}`, r.firstBuyError);
      navigate(`/c/${p.mint}`);
    } catch (err) {
      setStage(null);
      setError(err.code === 4001 || /reject|cancel/i.test(err.message) ? 'Cancelled in the wallet. Nothing was sent.' : err.message);
    }
  };

  const closed = cfg.launchOpen === false;
  return (
    <div className="page">
      <div className="chead">
        <div className="eyebrow">New coin</div>
        <h1 className="h1" style={{ marginTop: 12 }}>Launch on a pair</h1>
        <div className="hero-cta" style={{ marginTop: 20 }}><Link href="/mine" className="btn sm">My launches</Link></div>
      </div>
      <form className="launch-grid" onSubmit={go}>
        <div className="stack">
          <div className="card pad center-card">
            <div className="label">Choose a custom pair</div>
            <p className="hint">Every buy of your coin goes through this token, and every creator fee burns it.</p>
            <PairPicker value={pair} onPick={setPair} />
          </div>

          <div className="card pad">
            <div className="label">2. Your coin</div>
            <div className="two" style={{ marginTop: 10 }}>
              <label className="field"><span className="label">Token name</span><input className="input" maxLength={32} value={f.name} onChange={set('name')} placeholder="Pair Coin" /></label>
              <label className="field" style={{ marginTop: 0 }}><span className="label">Symbol</span><input className="input mono" value={f.symbol} onChange={set('symbol')} placeholder="PAIR" /></label>
            </div>
            <div className="field" style={{ marginTop: 18 }}>
              <span className="label">Token image</span>
              <div className="image-row">
                <div className="image-preview">{image ? <img src={image} alt="" /> : <img src="/logo.png" alt="" className="placeholder" />}</div>
                <button type="button" className={`dropzone ${dragging ? 'over' : ''}`} onClick={() => fileRef.current?.click()}
                  onDragOver={(e) => { e.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)}
                  onDrop={(e) => { e.preventDefault(); setDragging(false); pickImage(e.dataTransfer.files?.[0]); }}>
                  <b>{image ? 'Drop another image, or click to change' : 'Drop an image, or click to choose'}</b>
                  <span>PNG, JPEG, GIF or WebP, up to 4 MB</span>
                </button>
              </div>
              <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden onChange={(e) => pickImage(e.target.files?.[0])} />
            </div>
            <label className="field" style={{ marginTop: 18 }}><span className="label">Description <span className="muted small">optional</span></span><textarea className="textarea" maxLength={500} value={f.description} onChange={set('description')} placeholder="Paired with pairs, every fee burns it." /></label>
            <div className="two" style={{ marginTop: 18 }}>
              <label className="field"><span className="label">X <span className="muted small">optional</span></span><input className="input" value={f.twitter} onChange={set('twitter')} placeholder="https://x.com/…" /></label>
              <label className="field" style={{ marginTop: 0 }}><span className="label">Website <span className="muted small">optional</span></span><input className="input" value={f.website} onChange={set('website')} placeholder="https://" /></label>
            </div>
          </div>

          <div className="card pad center-card">
            <div className="label">3. Creator fee</div>
            <p className="hint">The additional fee traders pay on top of Pumpfun's standard fee.</p>
            <div className="seg">{cfg.feeRates.map((b) => <button type="button" key={b} className={fee === b ? 'on' : ''} onClick={() => setFee(b)}>{feeLabel(b)}</button>)}</div>
          </div>

          <div className="card pad center-card">
            <div className="label">4. First buy <span className="muted small">optional</span></div>
            {pair && !pair.payInSol ? (
              <p className="hint">A first buy needs a pump.fun coin pair, so coins paired with a Pumpfun list token launch without one.</p>
            ) : (
              <>
                <div className="sol-field">
                  <span className="sol-tag"><svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M5.4 16.6a.8.8 0 0 1 .56-.23h15.7c.36 0 .54.43.29.69l-3.1 3.1a.8.8 0 0 1-.57.24H2.6a.4.4 0 0 1-.29-.69zm0-12.62A.8.8 0 0 1 5.96 3.75h15.7c.36 0 .54.43.29.69l-3.1 3.1a.8.8 0 0 1-.57.23H2.6a.4.4 0 0 1-.29-.69zm13.2 6.27a.8.8 0 0 0-.57-.23H2.33c-.36 0-.54.43-.29.69l3.1 3.1c.15.15.35.23.57.23h15.7c.36 0 .54-.43.29-.69z" /></svg>SOL</span>
                  <input inputMode="decimal" aria-label="First buy in SOL" value={buyAmt} onChange={(e) => setBuyAmt(e.target.value.replace(/[^0-9.]/g, ''))} placeholder="0.0" />
                </div>
                <div className="quick-amts">{['0.1', '0.5', '1', '2'].map((v) => <button type="button" key={v} className={buyAmt === v ? 'on' : ''} onClick={() => setBuyAmt(buyAmt === v ? '' : v)}>{v} SOL</button>)}</div>
                {pair && buyAmt && <p className="hint">Routed SOL → {pairSym} → your coin in one swap, fees charged once.</p>}
              </>
            )}
          </div>
        </div>

        <aside className="sticky stack">
          <div className="card pad">
            <div className="row" style={{ gap: 14 }}>
              <PairMark coin={{ image, symbol: f.symbol || '?' }} pair={{ icon: pair?.meta?.icon, symbol: pair?.meta?.symbol || '?' }} size={64} />
              <div style={{ minWidth: 0 }}>
                <div className="h3" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.name || 'Your coin'}</div>
                <div className="muted small">${f.symbol || 'TICKER'} / {pair?.meta?.symbol ? `$${pair.meta.symbol}` : 'pick a pair'}</div>
              </div>
            </div>
            <hr className="sep" />
            <div className="stack small">
              <div className="row between"><span className="muted">Address ends in</span><span className="mono">…{cfg.vanity.suffix}</span></div>
              <div className="row between"><span className="muted">Creator fee</span><span>{feeLabel(fee)}</span></div>
              <div className="row between"><span className="muted">Fees go to</span><span>the burner program</span></div>
              <div className="row between"><span className="muted">First buy</span><span>{buyAmt && (!pair || pair.payInSol) ? `${buyAmt} SOL` : 'none'}</span></div>
            </div>
            <div className="notice burn small" style={{ marginTop: 16 }}><IFlame size={13} /> Your coin's Pumpfun creator is its own burner address, controlled by an on-chain program that can only burn. It has no private key, so neither you nor Pairs can redirect the fees or move them anywhere else.</div>
            {error && <div className="notice bad" style={{ marginTop: 12 }}>{error}</div>}
            {stage && (
              <div className="steps">
                {STAGES.map(([k, l], i) => {
                  const at = STAGES.findIndex(([x]) => x === stage);
                  return <div key={k} className={i < at ? 'done' : i === at ? 'on' : ''}>{i < at ? <ICheck size={14} /> : i === at ? <span className="spinner" /> : <span className="dot" />}{l}</div>;
                })}
              </div>
            )}
            <div style={{ marginTop: 16 }}>
              {closed ? (
                <button type="button" className="btn go lg block" onClick={() => setGate(true)}><IRocket size={17} />Launch</button>
              ) : !w.signedIn ? <WalletButton big /> : (
                <button type="submit" className="btn go lg block" disabled={!ready || Boolean(stage)}><IRocket size={17} />Launch</button>
              )}
            </div>
          </div>
        </aside>
      </form>
      {gate && (
        <div className="overlay" onClick={() => setGate(false)}>
          <div className="dialog gate" role="dialog" aria-modal="true" aria-label="Launching is disabled" onClick={(e) => e.stopPropagation()}>
            <div className="dialog-head"><h3>Launching is currently disabled.</h3><button className="icon-btn" aria-label="Close" onClick={() => setGate(false)}><IClose /></button></div>
            <button className="btn primary block" style={{ marginTop: 14 }} onClick={() => setGate(false)}>Close</button>
          </div>
        </div>
      )}
    </div>
  );
}
