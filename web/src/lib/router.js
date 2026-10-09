import { createElement, useEffect, useState } from 'react';

export function navigate(to) {
  history.pushState({}, '', to);
  dispatchEvent(new PopStateEvent('popstate'));
  if (!to.includes('#')) scrollTo({ top: 0 });
  else setTimeout(() => document.getElementById(to.split('#')[1])?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 120);
}
export function usePath() {
  const [path, setPath] = useState(location.pathname);
  useEffect(() => {
    const handler = () => setPath(location.pathname);
    addEventListener('popstate', handler);
    return () => removeEventListener('popstate', handler);
  }, []);
  return path;
}
/** Same-origin links go through the router; hash links and external links behave natively. */
export function Link({ href, children, ...rest }) {
  const onClick = (e) => {
    if (rest.target === '_blank' || /^https?:/.test(href) || href.startsWith('#') || e.metaKey || e.ctrlKey) return;
    e.preventDefault();
    navigate(href);
  };
  return createElement('a', { href, onClick, ...rest }, children);
}
