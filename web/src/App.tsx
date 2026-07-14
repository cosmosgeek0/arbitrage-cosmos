import { useEffect, useRef } from 'react';
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
import { NotificationsPage } from './pages/NotificationsPage';
import { News } from './pages/News';
import { CalendarPage } from './pages/CalendarPage';
import { ProductControlRoomProvider, ProductControlRoomRoute } from './features/productControlRoom';
import {
  createHttpProductIntegrationTransport,
  createProductIntegrationClient,
  readDurableMaterialCursor,
  type ProductIntegrationEndpoints,
} from './lib/productIntegration';
import './pages/MetricTiles.css';

const PRODUCT_INTEGRATION_ENDPOINTS: Readonly<ProductIntegrationEndpoints> = Object.freeze({
  supervisor: '/api/product-integration/v1/supervisor',
  materialEvents: '/api/product-integration/v1/material-events',
  trace: (correlationId: string) => `/api/product-integration/v1/traces/${encodeURIComponent(correlationId)}`,
  commandPreview: '/api/product-integration/v1/commands/preview',
  commandSubmit: '/api/product-integration/v1/commands',
});

const productIntegrationClient = createProductIntegrationClient(
  createHttpProductIntegrationTransport(PRODUCT_INTEGRATION_ENDPOINTS),
);
const durableResumeCursor = readDurableMaterialCursor();

function Shell() {
  const { page, detailSymbol, prefs } = useStore();
  const mainRef = useRef<HTMLElement | null>(null);
  const framePage = page === 'detail' ? 'detail' : page;

  useEffect(() => {
    mainRef.current?.scrollTo({ top: 0, left: 0 });
  }, [page, detailSymbol]);

  return (
    <div className="app-root">
      <Topbar />
      <div className="app-body">
        <Sidebar />
        <div className="app-main">
          {prefs.tape && <Tape />}
          <main ref={mainRef} className={`app-page-main page-${framePage}`}>
            <section className={`app-page-frame frame-${framePage}`} aria-label={`${framePage} workspace`}>
              <ErrorBoundary resetKey={`${page}-${detailSymbol}`} label={page}>
                {page === 'dashboard' && <Dashboard />}
                {page === 'control-room' && <ProductControlRoomRoute />}
                {page === 'account' && <Account view="overview" />}
                {page === 'wallets' && <Account view="overview" />}
                {page === 'markets' && <Markets />}
                {page === 'detail' && <TokenDetail symbol={detailSymbol} />}
                {page === 'loans' && <Loans />}
                {page === 'execution' && <Account view="execution" />}
                {page === 'orders' && <Account view="orders" />}
                {page === 'positions' && <Account view="positions" />}
                {page === 'fills' && <Account view="fills" />}
                {page === 'pnl' && <Account view="pnl" />}
                {page === 'strategies' && <Strategies />}
                {page === 'volume' && <VolumeScanner />}
                {page === 'opportunities' && <Opportunities />}
                {page === 'risk' && <Risk />}
                {page === 'ledger' && <LedgerPage />}
                {page === 'system' && <SystemHealth />}
                {page === 'notifications' && <NotificationsPage />}
                {page === 'news' && <News />}
                {page === 'calendar' && <CalendarPage />}
              </ErrorBoundary>
            </section>
            <footer className="footer">
              <div className="ftr-line">
                <span className="ftr-left">
                  <span className="ftr-brand">© 2026 Arbitrage Control Room</span>
                  <i>•</i>
                  <span>Local Candidate</span>
                  <i>•</i>
                  <span>No Money Paths</span>
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
      <ProductControlRoomProvider client={productIntegrationClient} initialMaterialCursor={durableResumeCursor}>
        <Shell />
      </ProductControlRoomProvider>
    </StoreProvider>
  );
}
