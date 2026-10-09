import { api } from '../lib/api.js';
import { usePoll, copy, feeLabel, KIND, useConfig } from '../lib/data.js';
import { Link } from '../lib/router.js';
import { usd, amount, ago, short } from '../lib/format.js';
import { PairMark, Paired, TokenIcon, BurnLedger } from '../components/Chrome.jsx';
import { IFlame, IExternal, IX } from '../components/Icons.jsx';

export default function Coin({ mint }) {
  const cfg = useConfig();
  const [c, err] = usePoll(() => api.coin(mint), 30_000, [mint]);
  const firstBuyError = (() => { try { return sessionStorage.getItem(`fb:${mint}`); } catch { return null; } })();
  if (err && !c) return <div className="page narrow"><h1 className="h2">{err.status === 404 ? 'Not on pairs.family' : 'Could not load this coin'}</h1><p className="muted">{err.message}</p><Link href="/" className="btn">All coins</Link></div>;
  if (!c) return <div className="page"><div className="empty"><span className="spinner" style={{ display: 'inline-block' }} /></div></div>;
  const m = c.market, P = c.pair.symbol ? `$${c.pair.symbol}` : 'the pair', ext = c.origin === 'external';
  return (
    <div className="page">
      {firstBuyError && <div className="notice bad" style={{ marginBottom: 16 }}>Your coin is live, but the first buy did not go through: {firstBuyError}. You can buy it on pump.fun.</div>}
      <div className="coin-head">
        <PairMark coin={c} pair={c.pair} size={84} />
        <div style={{ flex: 1, minWidth: 220 }}>
          <h1 className="h2">{c.name}</h1>
          <div className="row wrap" style={{ gap: 8, marginTop: 8 }}>
            <span className="muted">${c.symbol}</span>
            {ext && <span className="badge green">Official token</span>}
            {c.pair.symbol && <Paired pair={c.pair} />}
            {!ext && <span className="badge">{feeLabel(c.creatorFeeBps)} creator fee</span>}
            <button className="ca" onClick={() => copy(c.mint, 'CA copied')} title="Copy the contract address">{short(c.mint, 6)}</button>
          </div>
        </div>
        <div className="row wrap">
          <a className="btn go" href={c.links.pump} target="_blank" rel="noreferrer">{ext && !/pump\.fun/.test(c.links.pump) ? 'Trade' : 'Trade on pump.fun'} <IExternal /></a>
          <a className="btn" href={c.links.dex} target="_blank" rel="noreferrer">Chart <IExternal /></a>
        </div>
      </div>

      <div className="coin-cols">
        <div className="stack">
          <div className="card stats" style={{ gridTemplateColumns: `repeat(${ext ? 2 : 3}, 1fr)` }}>
            <div className="stat"><div className="eyebrow">Market cap</div><div className="v">{usd(m?.capUsd)}</div><div className="s">{m?.capQ != null ? `${amount(m.capQ)} ${P}` : ''}</div></div>
            {!ext && <div className="stat"><div className="eyebrow">Burned</div><div className="v">{c.burned.amount > 0 ? `${amount(c.burned.amount)}` : '0'}</div><div className="s">{P}{c.burned.usd ? ` · ${usd(c.burned.usd)}` : ''}</div></div>}
            <div className="stat"><div className="eyebrow">{m?.phase === 'curve' ? 'Curve' : 'Phase'}</div><div className="v">{m ? (m.graduated ? (ext ? 'Graduated' : 'PumpSwap') : m.migrating ? 'Graduating' : m.progress == null ? 'On curve' : `${Math.round(m.progress * 100)}%`) : '–'}</div><div className="s">{m?.graduated ? '' : m?.migrating ? 'pool opening' : 'to graduation'}</div></div>
          </div>
          {m?.phase === 'curve' && m.progress != null && <div className="bar" style={{ marginTop: 0 }}><i style={{ width: `${Math.max(2, Math.round(m.progress * 100))}%` }} /></div>}

          {!ext && <BurnLedger title="Burns" subtitle={c.waiting > 0 ? `${amount(c.waiting)} ${P} waiting for the next burn · checked every ${cfg.keeper.intervalMinutes} min` : `Every burn of this coin's fees · checked every ${cfg.keeper.intervalMinutes} min`}
            count={c.burned.count} total={c.burned.amount > 0 ? amount(c.burned.amount) : '0'} totalLabel={`${P} burned${c.burned.usd ? ` · ${usd(c.burned.usd)}` : ''}`}
            rows={c.burns.map((b) => ({ ...b, pair: c.pair, mint: c.mint, symbol: c.symbol, usd: c.pair.usdPrice ? b.amount * c.pair.usdPrice : null }))} showCoin={false}
            empty={`No burn yet. Fees build up as people trade and are burned once they are worth ${usd(cfg.keeper.minBurnUsd)}, or once a day.`} />}
          {c.description && <div className="card pad"><div className="eyebrow">About</div><p style={{ marginBottom: 0, whiteSpace: 'pre-wrap' }}>{c.description}</p></div>}
        </div>

        <aside className="stack">
          {!ext && <div className="card pad">
            <div className="eyebrow">The pair</div>
            <div className="row" style={{ marginTop: 10 }}>
              <TokenIcon src={c.pair.icon} label={c.pair.symbol} size={40} />
              <div><b>{P}</b> <span className="muted small">{c.pair.name}</span><div className="small muted">{KIND[c.pair.kind]}{c.pair.usdPrice ? ` · ${usd(c.pair.usdPrice)}` : ''}</div></div>
            </div>
            <p className="small muted" style={{ marginBottom: 0 }}>Every buy of ${c.symbol} swaps into {P} first. Every creator fee is paid in {P} and burned.</p>
            <div className="row wrap" style={{ marginTop: 12 }}><Link href={`/explore?pair=${c.pair.mint}`} className="btn sm" onClick={() => {}}>Coins on {P}</Link><a className="btn sm" href={c.links.pair} target="_blank" rel="noreferrer">{P} on Solscan <IExternal /></a></div>
          </div>}
          <div className="card pad stack small">
            <div className="eyebrow">On chain</div>
            {ext && <div className="row between"><span className="muted">Token</span><a className="mono" href={c.links.token} target="_blank" rel="noreferrer">{short(c.mint, 5)} <IExternal /></a></div>}
            {!ext && <><div className="row between"><span className="muted">Burner</span><a className="mono" href={c.links.feeWallet} target="_blank" rel="noreferrer">{short(c.feeWallet, 5)} <IExternal /></a></div>
            <div className="row between"><span className="muted">pump.fun creator</span><span>the burner (program-owned)</span></div>
            <div className="row between"><span className="muted">Launched by</span><a className="mono" href={`${cfg.explorer}/account/${c.launcher}`} target="_blank" rel="noreferrer">{short(c.launcher, 5)}</a></div>
            {c.signatures.launch && <div className="row between"><span className="muted">Launch</span><a className="mono" href={`${cfg.explorer}/tx/${c.signatures.launch}`} target="_blank" rel="noreferrer">{short(c.signatures.launch, 5)} <IExternal /></a></div>}
            <div className="row between"><span className="muted">Launched</span><span>{ago(c.liveAt)}</span></div></>}
            {c.keeper?.error && <div className="notice bad">{c.keeper.error}</div>}
          </div>
          {(c.socials.twitter || c.socials.telegram || c.socials.website) && (
            <div className="card pad row wrap">
              {c.socials.twitter && <a className="btn sm" href={c.socials.twitter} target="_blank" rel="noreferrer"><IX size={13} /> X</a>}
              {c.socials.telegram && <a className="btn sm" href={c.socials.telegram} target="_blank" rel="noreferrer">Telegram</a>}
              {c.socials.website && <a className="btn sm" href={c.socials.website} target="_blank" rel="noreferrer">Website</a>}
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
