import { StoreProvider, useStore } from './store';
import { Sidebar, Topbar, BottomNav } from './components/Header';
import { Tape } from './components/Tape';
import { Palette } from './components/Palette';
import { HealthBadge } from './components/HealthBadge';
import { Dashboard } from './pages/Dashboard';
import { Markets } from './pages/Markets';
import { TokenDetail } from './pages/TokenDetail';
import { ManualTrade } from './pages/ManualTrade';
import { Loans } from './pages/Loans';
import { Account } from './pages/Account';
import { Wallets } from './pages/Wallets';
import { Orders } from './pages/Orders';
import { Positions } from './pages/Positions';
import { Fills } from './pages/Fills';
import { Pnl } from './pages/Pnl';
import { Strategies } from './pages/Strategies';
import { Opportunities } from './pages/Opportunities';
import { Risk } from './pages/Risk';
import { LedgerPage } from './pages/LedgerPage';
import { SystemHealth } from './pages/SystemHealth';
import { Settings } from './pages/Settings';

function Shell() {
  const { page, detailSymbol, prefs } = useStore();

  return (
    <div className="app-root">
      <Sidebar />
      <div className="app-main">
        <Topbar />
        {prefs.tape && <Tape />}
        <main key={`${page}-${page === 'detail' ? detailSymbol : ''}`}>
          {page === 'dashboard' && <Dashboard />}
          {page === 'account' && <Account />}
          {page === 'wallets' && <Wallets />}
          {page === 'markets' && <Markets />}
          {page === 'detail' && <TokenDetail symbol={detailSymbol} />}
          {page === 'loans' && <Loans />}
          {page === 'trade' && <ManualTrade />}
          {page === 'orders' && <Orders />}
          {page === 'positions' && <Positions />}
          {page === 'fills' && <Fills />}
          {page === 'pnl' && <Pnl />}
          {page === 'strategies' && <Strategies />}
          {page === 'opportunities' && <Opportunities />}
          {page === 'risk' && <Risk />}
          {page === 'ledger' && <LedgerPage />}
          {page === 'system' && <SystemHealth />}
          {page === 'settings' && <Settings />}
        </main>
        <footer className="footer">
          <div className="container ftr-line">
            <span>Cosmos Control Room</span>
            <span>private · one account · no withdrawals</span>
            <span>every action ledgered</span>
            <span className="num">engine UTC</span>
          </div>
        </footer>
      </div>
      <BottomNav />
      <Palette />
      <HealthBadge />
    </div>
  );
}

export default function App() {
  return (
    <StoreProvider>
      <Shell />
    </StoreProvider>
  );
}
