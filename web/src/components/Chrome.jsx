import { useEffect, useState } from 'react';
import { Link } from '../lib/router.js';
import { useWallet } from '../lib/wallet.jsx';
import { useConfig, copy, useToastHost, KIND } from '../lib/data.js';
import { short, usd, amount, tick, ago } from '../lib/format.js';
import { IWallet, IClose, IHome, IRocket, ICoins, IDoc, IX, IGithub } from './Icons.jsx';

/** The logo: two pills (the operator's mark, brand/logo-source.png). 64 px file, shown at any size up to that. */
export function Mark({ size = 26 }) {
  return <img src="/mark-64.png" width={size} height={size} alt="" draggable="false" style={{ width: size, height: size }} />;
}
/** The brand, everywhere: the logo and the word "Pairs" (operator, 9 Oct). */
export function Brand({ name = true }) {
  return <Link href="/" className="brand" aria-label="Pairs home"><span className="brand-disc"><Mark size={28} /></span>{name && <span>Pairs</span>}</Link>;
}

/** The hero emblem: the logo on a white app-icon tile, a soft green glow behind it, floating slowly. */
export function Emblem() {
  return (
    <div className="emblem-wrap" aria-hidden="true">
      <div className="emblem-glow" />
      <div className="emblem-tile"><img src="/logo.png" width="512" height="512" alt="" draggable="false" /></div>
    </div>
  );
}

/** IPFS gateways that serve pump.fun CIDs, in order (ipfs.io and dweb.link refuse many; pump's own Pinata refuses some). */
const GATEWAYS = ['https://pump.mypinata.cloud/ipfs', 'https://gateway.pinata.cloud/ipfs', 'https://ipfs.filebase.io/ipfs'];
/** The URLs to try for a logo: an IPFS logo on every gateway in turn, anything else as is. */
export function logoCandidates(src) {
  if (!src) return [];
  const m = String(src).match(/\/ipfs\/([A-Za-z0-9][A-Za-z0-9._\-/]*)/);
  if (!m) return [src];
  const cid = m[1].replace(/[?#].*$/, '');
  return [...new Set([src, ...GATEWAYS.map((g) => `${g}/${cid}`)])];
}

/** A token's logo, trying each gateway that may serve it, or its first letters on a plain disc when none does. */
export function TokenIcon({ src, label = '', size = 28, fill = false }) {
  const candidates = logoCandidates(src);
  const [i, setI] = useState(0);
  useEffect(() => setI(0), [src]);
  // `fill`: a square card image (fills its box, no rounding); otherwise a round icon of `size` px.
  const box = fill ? { width: '100%', height: '100%', borderRadius: 0 } : { width: size, height: size };
  // ⛔ `label` can arrive null (a pair whose symbol is unknown): a null.slice here blanked the whole site on 9 Oct.
  if (i >= candidates.length) return <span className="token-ico ph" style={{ ...box, fontSize: fill ? 40 : Math.max(9, size / 3) }}>{String(label || '?').slice(0, 3).toUpperCase()}</span>;
  return <img className="token-ico" src={candidates[i]} alt="" loading="lazy" onError={() => setI((x) => x + 1)} style={box} />;
}

/** A coin over its pair: the coin's logo top left, the pair's bottom right. */
export function PairMark({ coin, pair, size = 52 }) {
  const a = Math.round(size * 0.74), b = Math.round(size * 0.52);
  return (
    <span className="pairmark" style={{ width: size, height: size }}>
      <span className="a" style={{ width: a, height: a, overflow: 'hidden' }}><TokenIcon src={coin?.image} label={coin?.symbol} size={a - 4} /></span>
      <span className="b" style={{ width: b, height: b, overflow: 'hidden' }}><TokenIcon src={pair?.icon} label={pair?.symbol} size={b - 4} /></span>
    </span>
  );
}

export function Paired({ pair }) {
  return <span className="paired"><TokenIcon src={pair?.icon} label={pair?.symbol} size={18} />{tick(pair?.symbol)}</span>;
}

/** A launch: its image on top (square), then ticker, name, market cap, what it burned, and its pair. */
export function CoinCard({ c }) {
  const m = c.market;
  return (
    <Link href={`/c/${c.mint}`} className="card tcard">
      <div className="tcard-img">
        <TokenIcon src={c.image} label={c.symbol} fill />
        {c.official && <span className="official-badge">Official</span>}
        {(c.pair?.icon || c.pair?.symbol) && <span className="pair-badge"><TokenIcon src={c.pair?.icon} label={c.pair?.symbol} size={38} /></span>}
      </div>
      <div className="tcard-body">
        <div className="tick">${c.symbol}</div>
        <div className="name">{c.name}</div>
        <div className="cap">{usd(m?.capUsd)}<small>{m?.graduated && !c.official ? 'mcap · PumpSwap' : m?.migrating ? 'mcap · graduating' : 'market cap'}</small></div>
        <div className="burned">{c.burned.amount > 0 ? `${amount(c.burned.amount)} ${tick(c.pair.symbol)} burned` : ''}</div>
        <div className="tfoot">
          <div className="eyebrow">{c.official ? 'Custom Pair' : 'Paired with'}</div>
          <div className="pair">{c.official && !c.pair?.symbol ? 'pairs.family' : <><TokenIcon src={c.pair?.icon} label={c.pair?.symbol} size={18} />{tick(c.pair.symbol)}</>}</div>
        </div>
      </div>
    </Link>
  );
}

/**
 * The burn ledger (Pons Charity's donations list, for burns): a title with the count, a line under it, the total in a
 * card on the right, then one row per burn with the pair's logo, who burned it and when, the amount, and View tx.
 * `rows`: [{ sig, url, at, amount, usd, status, pair: { symbol, icon }, mint, symbol }].
 */
export function BurnLedger({ title = 'Burns', subtitle, count, total, totalLabel, rows, more, onMore, showCoin = true, empty }) {
  return (
    <section>
      <div className="ledger-head">
        <div>
          <div className="row" style={{ gap: 12, justifyContent: 'center' }}><h2 className="h2" style={{ fontSize: 'clamp(28px, 3.4vw, 40px)' }}>{title}</h2>{count != null && <span className="count-pill">{count.toLocaleString('en-US')}</span>}</div>
          {subtitle && <p className="muted" style={{ margin: '8px 0 0', fontSize: 17 }}>{subtitle}</p>}
        </div>
        {total != null && <div className="card total-card"><div className="v">{total}</div><div className="muted small">{totalLabel}</div></div>}
      </div>
      {!rows ? <div className="empty"><span className="spinner" style={{ display: 'inline-block' }} /></div>
        : rows.length === 0 ? <div className="card empty">{empty || 'No burns yet.'}</div> : (
          <div className="card ledger">
            {rows.map((b) => (
              <div className="ledger-row" key={b.sig}>
                <TokenIcon src={b.pair?.icon} label={b.pair?.symbol} size={56} />
                <div>
                  <div className="who">{showCoin ? <><Link href={`/c/${b.mint}`}>${b.symbol}</Link> burned {tick(b.pair?.symbol)}</> : <>Burned {tick(b.pair?.symbol)}</>} · {ago(b.at)}{b.status === 'pending' && <span className="badge" style={{ marginLeft: 8 }}>confirming</span>}</div>
                  <div className="amt">{amount(b.amount)}<small>{b.pair?.symbol}</small>{b.usd != null && <span className="usd">{usd(b.usd)}</span>}</div>
                </div>
                {b.url && <a className="btn" href={b.url} target="_blank" rel="noreferrer">View tx</a>}
              </div>
            ))}
          </div>
        )}
      {more && <div className="load-more"><button className="btn" onClick={onMore}>Load more +</button></div>}
    </section>
  );
}

export function WalletButton({ big = false }) {
  const w = useWallet();
  const [open, setOpen] = useState(false);
  const cls = `btn ${big ? 'lg' : 'sm'}`;
  if (w.signedIn) {
    return (
      <span className="wallet-wrap">
        <button className={`${cls} mono`} onClick={() => setOpen((o) => !o)}><span className="dot good" />{short(w.session)}</button>
        {open && (
          <div className="menu" onMouseLeave={() => setOpen(false)}>
            <button onClick={() => { copy(w.session, 'Address copied'); setOpen(false); }}>Copy address</button>
            <Link href="/mine" onClick={() => setOpen(false)}>My launches</Link>
            <button onClick={() => { w.disconnect(); setOpen(false); }}>Sign out</button>
          </div>
        )}
      </span>
    );
  }
  return (
    <button className={`${cls} ${big ? 'primary' : ''}`} disabled={w.busy} onClick={() => w.signIn().catch(() => {})}>
      <IWallet size={15} /><span>{w.busy ? 'Check your wallet' : w.address ? 'Sign in' : 'Connect wallet'}</span>
    </button>
  );
}

const NAV = [
  { to: '/launch', label: 'Launch', icon: <IRocket size={18} />, match: (p) => p === '/launch' || p === '/mine' },
  { to: '/explore', label: 'Explore', icon: <IHome size={18} />, match: (p) => p === '/explore' || p.startsWith('/c/') },
  { to: '/pairs', label: 'Pairs', icon: <ICoins size={18} />, match: (p) => p === '/pairs' },
  { to: '/docs', label: 'Docs', icon: <IDoc size={18} />, match: (p) => p === '/docs' || p === '/how' },
];

export function Shell({ path, children }) {
  return (
    <>
      <header className="top">
        <div className="top-in">
          <Brand name={false} />
          <nav className="nav">{NAV.map((n) => <Link key={n.to} href={n.to} className={n.match(path) ? 'on' : ''}>{n.label}</Link>)}</nav>
          <div className="top-right"><WalletButton /></div>
        </div>
      </header>
      <main>{children}</main>
      <Footer />
      <nav className="mobile-nav">{NAV.map((n) => <Link key={n.to} href={n.to} className={n.match(path) ? 'on' : ''}>{n.icon}{n.short || n.label}</Link>)}</nav>
    </>
  );
}

export function Footer() {
  const cfg = useConfig();
  return (
    <footer className="foot">
      <div className="foot-in">
        <div>
          <Brand />
          <p>© 2026 Pairs</p>
        </div>
        <div className="foot-col">
          <span className="eyebrow">Site</span>
          <Link href="/launch">Launch</Link>
          <Link href="/explore">Explore</Link>
          <Link href="/pairs">Pairs</Link>
          <Link href="/docs">Docs</Link>
        </div>
        <div className="foot-col">
          <span className="eyebrow">On chain</span>
          <a href="https://solscan.io/account/6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P" target="_blank" rel="noreferrer">Pumpfun program</a>
          <a href="https://solscan.io/account/pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA" target="_blank" rel="noreferrer">PumpSwap program</a>
          <a href="/api/health" target="_blank" rel="noreferrer">Status</a>
        </div>
        <div className="foot-col">
          <span className="eyebrow">Socials</span>
          <a className="social" href="https://x.com/pairsfamily" target="_blank" rel="noreferrer"><IX size={17} />pairsfamily</a>
          <a className="social" href="https://github.com/pairsfamily/Pairs" target="_blank" rel="noreferrer"><IGithub size={19} />pairsfamily</a>
        </div>
      </div>
      <div className="foot-note">Built on pump.fun custom pairs.</div>
    </footer>
  );
}

export function WalletPicker() {
  const w = useWallet();
  useEffect(() => {
    if (!w.picker) return;
    const esc = (e) => e.key === 'Escape' && w.closePicker();
    addEventListener('keydown', esc);
    return () => removeEventListener('keydown', esc);
  }, [w.picker, w.closePicker]);
  if (!w.picker) return null;
  return (
    <div className="overlay" onClick={w.closePicker}>
      <div className="dialog" role="dialog" aria-modal="true" aria-label="Connect a wallet" onClick={(e) => e.stopPropagation()}>
        <div className="dialog-head"><h3>Connect a wallet</h3><button className="icon-btn" aria-label="Close" onClick={w.closePicker}><IClose /></button></div>
        <p className="muted small">Signing in proves you own the wallet. Nothing moves until you approve a transaction.</p>
        {w.providers.length === 0 ? <p className="muted">No Solana wallet found in this browser. Install Phantom, Solflare or Backpack, then reload.</p> : (
          <div className="wallet-list">
            {w.providers.map((p) => <button key={p.name} className="wallet-row" disabled={w.busy} onClick={() => w.connectWith(p).catch(() => {})}><img src={p.icon} alt="" width={28} height={28} /> {p.name}</button>)}
          </div>
        )}
        {w.error && <div className="notice bad" style={{ marginTop: 12 }}>{w.error}</div>}
      </div>
    </div>
  );
}

export function Toast() {
  const msg = useToastHost();
  return msg ? <div className="toast">{msg}</div> : null;
}

export const kindLabel = (k) => KIND[k] || '';
