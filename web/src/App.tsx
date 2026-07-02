import { StoreProvider, useStore } from './store';
import { Header, BottomNav } from './components/Header';
import { Tape } from './components/Tape';
import { Palette } from './components/Palette';
import { HealthBadge } from './components/HealthBadge';
import { Dashboard } from './pages/Dashboard';
import { Markets } from './pages/Markets';
import { ManualTrade } from './pages/ManualTrade';
import { Loans } from './pages/Loans';
import { Account } from './pages/Account';
import { Orders } from './pages/Orders';
import { Positions } from './pages/Positions';
import { Fills } from './pages/Fills';
import { Pnl } from './pages/Pnl';
import { Strategies } from './pages/Strategies';
import { Opportunities } from './pages/Opportunities';
import { Risk } from './pages/Risk';
import { LedgerPage } from './pages/LedgerPage';
import { Settings } from './pages/Settings';

function Shell() {
  const { page, detailSymbol } = useStore();

  return (
    <div className="app-root">
      <Header />
      <Tape />
      <main key={`${page}-${detailSymbol ?? ''}`} className="pageIn">
        {page === 'dashboard' && <Dashboard />}
        {page === 'markets' && <Markets />}
        {page === 'trade' && <ManualTrade />}
        {page === 'loans' && <Loans />}
        {page === 'account' && <Account />}
        {page === 'orders' && <Orders />}
        {page === 'positions' && <Positions />}
        {page === 'fills' && <Fills />}
        {page === 'pnl' && <Pnl />}
        {page === 'strategies' && <Strategies />}
        {page === 'opportunities' && <Opportunities />}
        {page === 'risk' && <Risk />}
        {page === 'ledger' && <LedgerPage />}
        {page === 'settings' && <Settings />}
      </main>
      <footer className="footer">
        <div className="container ftr-line">
          <span>Cosmos Arbitrage Control Room</span>
          <span>private · one account · no withdrawals</span>
          <span>every action ledgered</span>
          <span className="num">all times local · engine UTC</span>
        </div>
      </footer>
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
