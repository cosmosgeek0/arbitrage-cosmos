import { useStore, type Page } from '../store';
import { ManualTrade } from './ManualTrade';
import { Orders } from './Orders';
import { Positions } from './Positions';
import { Fills } from './Fills';
import { Pnl } from './Pnl';

// One execution surface: ticket + account truth. The old standalone pages are
// tabs now; their page ids stay valid routes so deep links (openTicket,
// "Fills →" buttons, prefs.defaultPage) land on the right tab.
const TABS: { id: Page; label: string }[] = [
  { id: 'trade', label: 'Ticket' },
  { id: 'orders', label: 'Orders' },
  { id: 'positions', label: 'Positions' },
  { id: 'fills', label: 'Fills' },
  { id: 'pnl', label: 'PnL' },
];

export const EXECUTION_PAGES: Page[] = TABS.map((t) => t.id);

export function Execution() {
  const { page, setPage } = useStore();
  const tab = EXECUTION_PAGES.includes(page) ? page : 'trade';

  return (
    <div className="exec-shell">
      <div className="container exec-tabbar">
        <nav className="exec-tabs" aria-label="Execution sections">
          {TABS.map((t) => (
            <button
              key={t.id}
              className={`exec-tab ${tab === t.id ? 'on' : ''}`}
              onClick={() => setPage(t.id)}
            >
              {t.label}
            </button>
          ))}
        </nav>
      </div>
      {tab === 'trade' && <ManualTrade />}
      {tab === 'orders' && <Orders />}
      {tab === 'positions' && <Positions />}
      {tab === 'fills' && <Fills />}
      {tab === 'pnl' && <Pnl />}
    </div>
  );
}
