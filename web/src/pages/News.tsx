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

const TAB_META: Record<number, { code: string; tone: 'ok' | 'warn' | 'bad' | 'idle'; desk: string }> = {
  48: { code: 'LIST', tone: 'ok', desk: 'Listings' },
  49: { code: 'NEWS', tone: 'idle', desk: 'General' },
  93: { code: 'ACT', tone: 'idle', desk: 'Campaigns' },
  50: { code: 'FIAT', tone: 'ok', desk: 'Fiat Rails' },
  161: { code: 'DEL', tone: 'bad', desk: 'Delisting Risk' },
  157: { code: 'OPS', tone: 'warn', desk: 'Maintenance' },
  51: { code: 'API', tone: 'warn', desk: 'API Watch' },
  128: { code: 'DROP', tone: 'idle', desk: 'Airdrops' },
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
  const activeTab = NEWS_TABS.find((t) => t.id === tab) ?? NEWS_TABS[0];
  const meta = TAB_META[tab] ?? TAB_META[49];
  const total = items?.length ?? 0;
  const matched = filtered.length;
  const lead = filtered[0] ?? null;
  const rest = filtered.slice(1);
  const statusTone = failed ? 'bad' : items === null ? 'idle' : 'ok';
  const statusText = failed ? 'Feed Unreachable' : fetchedAt ? `Live · ${timeAgo(fetchedAt)}` : 'Fetching';
  const syncText = fetchedAt ? timeAgo(fetchedAt) : items === null ? 'Pending' : 'No Sync';

  return (
    <div className="container page nwx-page">
      <header className="nwx-hero">
        <div className="nwx-hero-main">
          <div className="nwx-title">
            <span className="nwx-kicker">Binance Announcement Feed</span>
            <div className="nwx-title-row">
              <h1>News Desk</h1>
              <Pill tone={statusTone}>{statusText}</Pill>
            </div>
            <p>Official Binance announcements for listings, delistings, API changes, maintenance windows, and exchange activity.</p>
          </div>
          <div className="nwx-actions">
            <button className="nwx-action" onClick={() => setNonce((n) => n + 1)} title="Refresh News Feed" aria-label="Refresh News Feed">
              <IconRefresh size={14} />
              Refresh
            </button>
            <a className="nwx-action" href="https://www.binance.com/en/support/announcement" target="_blank" rel="noreferrer noopener">
              Binance
              <IconExternal size={13} />
            </a>
          </div>
        </div>
        <div className="nwx-stat-strip" aria-label="News Feed Status">
          <span><b>{activeTab.label}</b><em>Active Catalog</em></span>
          <span><b className="num">{matched}</b><em>{ql ? 'Matched Headlines' : 'Visible Headlines'}</em></span>
          <span><b className="num">{total}</b><em>Total Loaded</em></span>
          <span><b>{syncText}</b><em>Last Sync</em></span>
        </div>
      </header>

      <section className="nwx-controls" aria-label="News Controls">
        <div className="nwx-tab-strip">
          {NEWS_TABS.map((t) => (
            <button key={t.id} className={`nwx-tab ${tab === t.id ? 'on' : ''}`} aria-pressed={tab === t.id} onClick={() => setTab(t.id)}>
              <span>{t.label}</span>
            </button>
          ))}
        </div>
        <label className="nwx-search">
          <IconSearch size={15} />
          <input value={q} placeholder="Search headlines" onChange={(e) => setQ(e.target.value)} aria-label="Search Headlines" />
        </label>
      </section>

      <div className="nwx-context">
        <span className={`nwx-code ${meta.tone}`}>{meta.code}</span>
        <p>{TAB_HINTS[tab]}</p>
        <span className="nwx-source">Catalog {tab} · {meta.desk}</span>
      </div>

      <section className="nwx-grid">
        <div className="nwx-lead">
          <div className="nwx-section-head">
            <span>Lead Headline</span>
            <em>{activeTab.label}</em>
          </div>
          {lead ? (
            <a className={`nwx-lead-card ${meta.tone}`} href={lead.url} target="_blank" rel="noreferrer noopener">
              <span className="nwx-lead-mark"><IconNewspaper size={18} /></span>
              <h2>{lead.title}</h2>
              <span className="nwx-lead-meta">
                <b>Binance</b>
                <i>{lead.date ?? 'Official Announcement'}</i>
                <IconExternal size={14} />
              </span>
            </a>
          ) : (
            <div className="nwx-empty-card">No lead headline in this view.</div>
          )}
        </div>

        <div className="nwx-feed">
          <div className="nwx-section-head">
            <span>Headline Tape</span>
            <em>{rest.length} Rows</em>
          </div>
          <div className="nwx-feed-list">
        {items === null && !failed && <div className="ov-empty">Loading...</div>}
        {failed && <div className="ov-empty">Feed unavailable. Binance could not be reached. Check Data Health.</div>}
        {items !== null && !failed && filtered.length === 0 && (
          <div className="ov-empty">{ql ? `Nothing matches "${q}".` : 'No announcements in this category.'}</div>
        )}
        {rest.map((it, index) => (
          <a key={it.id} className="nwx-row" href={it.url} target="_blank" rel="noreferrer noopener">
            <span className="nwx-row-index num">{String(index + 2).padStart(2, '0')}</span>
            <span className="nwx-row-body">
              <span className="nwx-row-title">{it.title}</span>
              <span className="nwx-row-sub"><b>Binance</b><i>{activeTab.label}</i></span>
            </span>
            <span className="nwx-row-date num">{it.date ?? 'Official'}</span>
            <span className="nwx-row-open"><IconExternal size={13} /></span>
          </a>
        ))}
          </div>
        </div>
      </section>
      <p className="nwx-source-note">Source: Binance announcement catalog. The page only displays feed data returned by the server.</p>
    </div>
  );
}
