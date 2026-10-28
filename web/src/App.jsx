import { Component, useEffect, useState } from 'react';
import { WalletProvider } from './lib/wallet.jsx';
import { ConfigCtx, FALLBACK_CONFIG } from './lib/data.js';
import { usePath } from './lib/router.js';
import { api } from './lib/api.js';
import { Shell, WalletPicker, Toast } from './components/Chrome.jsx';
import Home from './pages/Home.jsx';
import Launch from './pages/Launch.jsx';
import Explore from './pages/Explore.jsx';
import Coin from './pages/Coin.jsx';
import Pairs from './pages/Pairs.jsx';
import Mine from './pages/Mine.jsx';
import How from './pages/How.jsx';

const B58 = '[1-9A-HJ-NP-Za-km-z]{32,44}';

/** One page failing must never blank the site: the header, footer and other pages keep working. */
class PageBoundary extends Component {
  constructor(p) { super(p); this.state = { error: null }; }
  static getDerivedStateFromError(error) { return { error }; }
  componentDidUpdate(prev) { if (prev.path !== this.props.path && this.state.error) this.setState({ error: null }); }
  render() {
    if (!this.state.error) return this.props.children;
    return <div className="page narrow"><h1 className="h2">Something went wrong on this page</h1><p className="muted">Reload to try again.</p><button className="btn" onClick={() => location.reload()}>Reload</button></div>;
  }
}
function Page({ path }) {
  if (path === '/') return <Home />;
  if (path === '/launch') return <Launch />;
  if (path === '/explore') return <Explore />;
  if (path === '/pairs') return <Pairs />;
  if (path === '/mine') return <Mine />;
  if (path === '/docs') return <How />;
  if (path === '/how') { history.replaceState(null, '', `/docs${location.hash}`); return <How />; } // the old address
  const m = path.match(new RegExp(`^/c/(${B58})$`));
  if (m) return <Coin mint={m[1]} />;
  return <div className="page narrow"><h1 className="h2">Not found</h1><p className="muted">There is nothing at {path}.</p></div>;
}

export default function App() {
  const path = usePath();
  const [cfg, setCfg] = useState(FALLBACK_CONFIG);
  // Re-read every 20 s: when the token goes live (CA in the pill, launching opened) every open page follows within 20 s,
  // no reload needed.
  useEffect(() => {
    const pull = () => api.config().then((c) => setCfg({ ...FALLBACK_CONFIG, ...c })).catch(() => {});
    pull();
    const t = setInterval(pull, 20_000);
    return () => clearInterval(t);
  }, []);
  return (
    <ConfigCtx.Provider value={cfg}>
      <WalletProvider>
        <Shell path={path}><PageBoundary path={path}><Page path={path} /></PageBoundary></Shell>
        <WalletPicker />
        <Toast />
      </WalletProvider>
    </ConfigCtx.Provider>
  );
}
