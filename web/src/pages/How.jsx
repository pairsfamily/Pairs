import { useEffect, useState } from 'react';
import { useConfig, copy, feeLabel } from '../lib/data.js';
import { Link } from '../lib/router.js';
import { usd, short } from '../lib/format.js';
import { IExternal } from '../components/Icons.jsx';

/** The docs: a sticky contents list on the left (the section in view is marked), the sections on the right. */
const TOC = [
  ['overview', 'Overview'],
  ['pairs', 'Custom pairs'],
  ['launching', 'Launching'],
  ['fees', 'Fees and burns'],
  ['graduation', 'Graduation'],
  ['trust', 'Trust and security'],
  ['addresses', 'Addresses'],
  ['faq', 'FAQ'],
];

function Addr({ label, value, what }) {
  const cfg = useConfig();
  if (!value) return null;
  return (
    <div className="addr">
      <div><b>{label}</b><p>{what}</p></div>
      <div className="row" style={{ gap: 8 }}>
        <button className="ca" onClick={() => copy(value, 'Address copied')} title="Copy">{short(value, 6)}</button>
        <a className="btn sm" href={`${cfg.explorer}/account/${value}`} target="_blank" rel="noreferrer">Solscan <IExternal /></a>
      </div>
    </div>
  );
}

export default function How() {
  const cfg = useConfig();
  const [active, setActive] = useState('overview');
  useEffect(() => {
    const els = TOC.map(([id]) => document.getElementById(id)).filter(Boolean);
    const io = new IntersectionObserver((entries) => {
      const seen = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
      if (seen[0]) setActive(seen[0].target.id);
    }, { rootMargin: '-90px 0px -65% 0px' });
    els.forEach((e) => io.observe(e));
    return () => io.disconnect();
  }, []);
  const go = (id) => (e) => { e.preventDefault(); document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); history.replaceState(null, '', `#${id}`); };
  const every = `${cfg.keeper.intervalMinutes} minutes`;

  return (
    <div className="page">
      <div className="chead">
        <div className="eyebrow">Docs</div>
        <h1 className="h1" style={{ marginTop: 12 }}>How Pairs works</h1>
        <p className="lede">Pairs lets you launch Pumpfun coins paired with custom tokens where every buy creates buy pressure on the pair and every creator fee is burned.</p>
      </div>

      <div className="docs">
        <aside className="docs-nav">
          <div className="eyebrow" style={{ marginBottom: 10 }}>On this page</div>
          {TOC.map(([id, label]) => <a key={id} href={`#${id}`} className={active === id ? 'on' : ''} onClick={go(id)}>{label}</a>)}
        </aside>

        <article className="docs-body">
          <section id="overview">
            <h2>Overview</h2>
            <p>When a coin runs on Pumpfun, copies usually launch next to it and pull attention, holders and liquidity away from it. Pairs turns those launches into support for the custom pair instead.</p>
            <p>Every coin launched here is a normal Pumpfun coin with one difference: it trades against another token, its <b>pair</b>, instead of SOL. That has two effects:</p>
            <ol>
              <li><b>Every buy is buy pressure on the pair.</b> To buy the new coin, a trader's SOL is first swapped into the pair token, through the pair's own market.</li>
              <li><b>Every creator fee burns the pair.</b> Pumpfun pays the coin's creator fees in the pair token, and on Pairs all of them are burned.</li>
            </ol>
            <div className="callout">Pairs takes no fee. Pumpfun charges its usual protocol fee, as on any coin.</div>
          </section>

          <section id="pairs">
            <h2>Custom pairs</h2>
            <p>Pumpfun calls a coin that trades against a token other than SOL or USDC a <b>custom pair</b>. Pairs only launches custom pairs. You can pair with:</p>
            <ul>
              <li><b>Any Pumpfun coin that trades against SOL or USDC</b>, whether it is still on its bonding curve or has graduated to PumpSwap.</li>
              <li><b>Any token on Pumpfun's custom pair list</b>: tokenized stocks, BONK, PUMP, Fartcoin and others Pumpfun has added.</li>
            </ul>
            <p>You cannot pair with:</p>
            <ul>
              <li>A coin that is itself already paired with a Pumpfun coin (Pumpfun allows one level of pairing).</li>
              <li>A coin that graduated to Raydium, unless Pumpfun has added it to its list.</li>
              <li>Mayhem mode coins, SOL or USDC.</li>
            </ul>
            <div className="callout warn">A coin's pair is set when it is created and can never be changed.</div>
          </section>

          <section id="launching">
            <h2>Launching</h2>
            <p>A launch is <b>one transaction</b>, exactly like a launch on Pumpfun. Your wallet approves it once, and it does two things together:</p>
            <ol>
              <li><b>Creates the coin</b> on Pumpfun, paired with the token you picked, with its creator set to the coin's burner (see <a href="#fees" onClick={go('fees')}>Fees and burns</a>).</li>
              <li><b>Makes your first buy</b>, if you asked for one, from your wallet into your wallet. Because it is in the same transaction as the creation, nobody can buy before you.</li>
            </ol>
            <h3>Options</h3>
            <table className="docs-table">
              <tbody>
                <tr><td>Pair</td><td>Search, paste an address, or pick from the popular list. It is checked against Pumpfun's rules on chain before you sign.</td></tr>
                <tr><td>Creator fee</td><td>{cfg.feeRates.map(feeLabel).join(', ')}. Standard follows Pumpfun's own schedule. A higher rate burns more of the pair per trade and costs traders more. Set at launch.</td></tr>
                <tr><td>First buy</td><td>Optional, in SOL, up to {cfg.maxDevBuySol} SOL: routed SOL to the pair to your coin in one swap, fees charged once. Available when the pair is a Pumpfun coin; coins paired with a Pumpfun list token launch without one. Slippage is fixed by Pairs.</td></tr>
                <tr><td>Name and ticker</td><td>Up to 32 characters, ticker up to 10 letters or numbers. An image is required (PNG, JPG, WebP or GIF, up to 4 MB).</td></tr>
              </tbody>
            </table>
            <h3>Good to know</h3>
            <ul>
              <li>Every coin's address ends in <span className="mono">{cfg.vanity.suffix}</span>.</li>
              <li>The whole transaction, first buy included, is simulated before you are asked to sign. Anything Pumpfun would refuse is refused there, with a reason, and nothing is sent.</li>
              <li>You pay the network fee and Pumpfun's account rent (a few hundredths of a SOL), plus your first buy.</li>
              <li>A wallet can prepare up to {cfg.launchesPerWalletDay} launches a day.</li>
            </ul>
          </section>

          <section id="fees">
            <h2>Fees and burns</h2>
            <p>Pumpfun pays every coin's <b>creator fee</b> to the coin's creator, in the coin's pair token. On Pairs the creator of every coin is its own <b>burner</b>: an address owned by the Pairs burner program, derived from the coin's address. It has no private key.</p>
            <h3>The burner program</h3>
            <p>The program has exactly one instruction, <span className="mono">burn</span>, which burns everything the coin's burner holds. There is no withdraw, no transfer, no admin and no setting. Anyone can call it.</p>
            <h3>The burn cycle</h3>
            <ol>
              <li>Traders buy and sell the coin. Each trade's creator fee waits on the coin's curve (or pool, after graduation).</li>
              <li>Every {every} the Pairs keeper reads every coin's waiting fees.</li>
              <li>When a coin's fees are worth {usd(cfg.keeper.minBurnUsd)} or more (or once a day for small amounts), one transaction sweeps them, collects them into the burner and burns all of it.</li>
              <li>The burn is listed on the home page and on the coin's page, with the exact amount and a link to the transaction.</li>
            </ol>
            <div className="callout">The keeper only pays the transaction fee. It never holds or touches the fees: every step is a public instruction anyone could send, so burns would continue even if Pairs stopped running.</div>
          </section>

          <section id="graduation">
            <h2>Graduation</h2>
            <p>Like every Pumpfun coin, a Pairs coin trades on a bonding curve until the curve sells out, then moves to its own PumpSwap pool, paired with the same token.</p>
            <ul>
              <li><b>The last buy on the curve has no maximum size.</b> Pumpfun fills the rest at the price the pool will open at. Until the pool is created the coin shows as <i>Graduating</i>, priced at that opening price.</li>
              <li><b>Fees continue after graduation.</b> The pool's creator fees go to the same burner and are burned the same way.</li>
              <li><b>Explore</b> lists graduated coins and coins still on their curve separately.</li>
            </ul>
          </section>

          <section id="trust">
            <h2>Trust and security</h2>
            <table className="docs-table">
              <tbody>
                <tr><td>Who can move a coin's fees?</td><td>Nobody. They are held by an address with no private key, and the only thing the program can do with them is burn.</td></tr>
                <tr><td>Can the creator redirect fees?</td><td>No. The creator is set to the burner in the transaction that creates the coin.</td></tr>
                <tr><td>Can Pairs redirect fees?</td><td>No. Pairs holds no key for any burner.</td></tr>
                <tr><td>Can the program change?</td><td>Its upgrade status is public on Solscan. Pairs will make it immutable, after which nobody can change it.</td></tr>
                <tr><td>Can I check the burns?</td><td>Yes. Every burner, every burn transaction and the program itself are linked from the site.</td></tr>
              </tbody>
            </table>
          </section>

          <section id="addresses">
            <h2>Addresses</h2>
            <div className="addrs">
              <Addr label="Pairs burner program" value={cfg.burnerProgram} what="Owns every coin's burner. One instruction: burn." />
              <Addr label="Pairs keeper" value={cfg.keeper.address} what={`Triggers the burn cycle every ${every} and pays its network fees.`} />
              <Addr label="Pumpfun program" value="6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P" what="Creates the coins and runs their bonding curves." />
              <Addr label="PumpSwap program" value="pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA" what="Runs graduated coins' pools and the multi-hop buys." />
            </div>
          </section>

          <section id="faq" className="faq">
            <h2>FAQ</h2>
            {[
              ['Why burn instead of buying the pair back?', 'The fees already arrive in the pair token, so a buyback would buy what is already there. Burning takes it out of the supply for good, which is what a buyback-and-burn does, without the round trip.'],
              ['Who shows as the creator on Pumpfun?', "The coin's burner address. That is what makes every creator fee burn. Your coin's page on Pairs shows who launched it, and your first buy shows as your wallet's buy."],
              ['Where do my first-buy tokens go?', 'To the wallet you launched from, in the launch transaction itself.'],
              ['Can I change the pair or the fee rate later?', 'No. Both are set when the coin is created.'],
              ['Why does my coin show Graduating?', 'Its curve sold out and its PumpSwap pool is being opened. That usually takes moments; the price shown is the pool\'s opening price.'],
              ['Does Pairs take a cut?', 'No. Every creator fee burns the pair.'],
            ].map(([q, a]) => <details key={q}><summary>{q}</summary><p>{a}</p></details>)}
          </section>

          <div className="row wrap" style={{ marginTop: 36 }}><Link href="/launch" className="btn primary">Launch a token</Link><Link href="/explore" className="btn">Explore</Link></div>
        </article>
      </div>
    </div>
  );
}
