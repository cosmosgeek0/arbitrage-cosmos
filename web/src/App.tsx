import { StoreProvider, useStore } from './store';
import { IconClock } from './components/Icons';
import { Sidebar, Topbar, BottomNav, Overlays, RefreshDock } from './components/Header';
import { ErrorBoundary } from './components/ErrorBoundary';
import { Tape } from './components/Tape';
import { Palette } from './components/Palette';
import { Dashboard } from './pages/Dashboard';
import { Markets } from './pages/Markets';
import { TokenDetail } from './pages/TokenDetail';
import { Loans } from './pages/Loans';
import { Account } from './pages/Account';
import { Strategies } from './pages/Strategies';
import { VolumeScanner } from './pages/VolumeScanner';
import { Opportunities } from './pages/Opportunities';
import { Risk } from './pages/Risk';
import { LedgerPage } from './pages/LedgerPage';
import { SystemHealth } from './pages/SystemHealth';
import { News } from './pages/News';
import { CalendarPage } from './pages/CalendarPage';

function Shell() {
  const { page, detailSymbol, prefs } = useStore();

  return (
    <div className="app-root">
      <Topbar />
      <div className="app-body">
        <Sidebar />
        <div className="app-main">
          {prefs.tape && <Tape />}
        <main key={`${page}-${page === 'detail' ? detailSymbol : ''}`}>
          <ErrorBoundary resetKey={`${page}-${detailSymbol}`} label={page}>
            {page === 'dashboard' && <Dashboard />}
            {page === 'account' && <Account />}
            {page === 'wallets' && <Account />}
            {page === 'markets' && <Markets />}
            {page === 'detail' && <TokenDetail symbol={detailSymbol} />}
            {page === 'loans' && <Loans />}
            {['orders', 'positions', 'fills', 'pnl'].includes(page) && <Account />}
            {page === 'strategies' && <Strategies />}
            {page === 'volume' && <VolumeScanner />}
            {page === 'opportunities' && <Opportunities />}
            {page === 'risk' && <Risk />}
            {page === 'ledger' && <LedgerPage />}
            {page === 'system' && <SystemHealth />}
            {page === 'news' && <News />}
            {page === 'calendar' && <CalendarPage />}
          </ErrorBoundary>
          <footer className="footer">
            <div className="ftr-line">
              <span className="ftr-left">
                <span className="ftr-brand">© 2026 Arbitrage Control Room</span>
                <i>•</i>
                <span>Private</span>
                <i>•</i>
                <span>No withdrawals</span>
                <i>•</i>
                <span>Every action ledgered</span>
              </span>
              <span className="ftr-right">
                <IconClock size={15} />
                <span>Engine UTC</span>
                <i>•</i>
                <span>Binance</span>
              </span>
            </div>
          </footer>
        </main>
        </div>
      </div>
      <BottomNav />
      <Palette />
      <Overlays />
      <RefreshDock />
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
