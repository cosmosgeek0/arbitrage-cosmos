import { useEffect, useMemo, useState } from 'react';
import { NEWS_TABS, type NewsRow } from '../components/Header';
import { Pill } from '../components/px';
import { IconExternal, IconNewspaper, IconRefresh, IconSearch } from '../components/Icons';
import { timeAgo } from '../format';
import './Markets.css';

// Full-page Binance announcements browser. Same real feed as the quick view,
// with more room: search filter, category counts, fetch freshness, refresh.
const TAB_HINTS: Record<number, string> = {
  48: 'New spot & futures listings — the announcements that move pairs first.',
  49: 'General Binance platform news.',
  93: 'Campaigns, trading competitions, promos.',
  50: 'New fiat rails and currency support.',
  161: 'Removals of pairs and tokens — exit risk for open positions.',
  157: 'Wallet/system maintenance windows — expect feed gaps.',
  51: 'Spot & futures API changes — can break bots and clients.',
  128: 'Airdrop distributions and HODLer programs.',
};

export function News() {
  const [tab, setTab] = useState<number>(48);
  const [items, setItems] = useState<NewsRow[] | null>(null);
  const [fetchedAt, setFetchedAt] = useState<number | null>(null);
  const [failed, setFailed] = useState(false);
  const [q, setQ] = useState('');
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let alive = true;
    setItems(null);
    setFailed(false);
    fetch(`/api/news?catalog=${tab}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('bad'))))
      .then((d: { items: NewsRow[]; fetchedAt?: number }) => {
        if (!alive) return;
        setItems(d.items ?? []);
        setFetchedAt(d.fetchedAt ?? null);
      })
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [tab, nonce]);

  const ql = q.trim().toLowerCase();
  const filtered = useMemo(
    () => (items ?? []).filter((it) => !ql || it.title.toLowerCase().includes(ql)),
    [items, ql]
  );

  return (
    <div className="container page mkx news-page nwx-page">
      <header className="bwx-hero bsx-hero">
        <div className="bwx-hero-top">
          <div className="bwx-hero-title">
            <div className="bwx-title-row">
              <h1>News</h1>
              <Pill tone={failed ? 'bad' : 'ok'}>{failed ? 'Feed Unreachable' : fetchedAt ? `Live · Fetched ${timeAgo(fetchedAt)}` : 'Fetching…'}</Pill>
            </div>
            <p>Official Binance Announcements · Refreshed Every 5 Minutes · Never Invented, Never Summarized</p>
          </div>
          <span className="tdx-head-right">
            <button className="mkx-pill" onClick={() => setNonce((n) => n + 1)} title="Refresh"><IconRefresh size={13} /> Refresh</button>
            <a className="mkx-pill" href="https://www.binance.com/en/support/announcement" target="_blank" rel="noreferrer noopener">
              Binance <IconExternal size={12} />
            </a>
          </span>
        </div>
      </header>

      <div className="news-page-bar nwx-bar">
        <div className="news-tabs">
          {NEWS_TABS.map((t) => (
            <button key={t.id} className={`news-tab ${tab === t.id ? 'on' : ''}`} onClick={() => setTab(t.id)}>{t.label}</button>
          ))}
        </div>
        <div className="news-filter">
          <IconSearch size={14} />
          <input value={q} placeholder="Filter headlines" onChange={(e) => setQ(e.target.value)} aria-label="Filter headlines" />
        </div>
      </div>
      <p className="news-hint">{TAB_HINTS[tab]}</p>

      <div className="news-page-list">
        {items === null && !failed && <div className="ov-empty">Loading…</div>}
        {failed && <div className="ov-empty">Feed unavailable — Binance could not be reached. Check Data health.</div>}
        {items !== null && !failed && filtered.length === 0 && (
          <div className="ov-empty">{ql ? `Nothing matches “${q}”.` : 'No announcements in this category.'}</div>
        )}
        {filtered.map((it) => (
          <a key={it.id} className="news-item lg" href={it.url} target="_blank" rel="noreferrer noopener">
            <span className="news-item-ic"><IconNewspaper size={15} /></span>
            <span className="news-item-body">
              <span className="news-item-title">{it.title}</span>
              <span className="news-item-sub">{NEWS_TABS.find((t) => t.id === tab)?.label}</span>
            </span>
            <span className="news-item-meta">{it.date && <span className="news-item-date">{it.date}</span>}<IconExternal size={14} /></span>
          </a>
        ))}
      </div>
      <p className="news-source-note">Source: Binance's announcement catalog. If the feed is unreachable this page says so — it never invents items.</p>
    </div>
  );
}
