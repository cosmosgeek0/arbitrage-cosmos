import { lazy, Suspense, useEffect, useRef } from 'react';
import { StoreProvider, useStore } from './store';
import { IconClock } from './components/Icons';
import { Sidebar, Topbar, BottomNav, Overlays, RefreshDock } from './components/Header';
import { ErrorBoundary } from './components/ErrorBoundary';
import { Tape } from './components/Tape';
import { Palette } from './components/Palette';
import { OptionalSurfaceGate } from './components/OptionalSurfaceGate';
import { Dashboard } from './pages/Dashboard';
import { Loans } from './pages/Loans';
import { Account } from './pages/Account';
import { Strategies } from './pages/Strategies';
import { VolumeScanner } from './pages/VolumeScanner';
import { Opportunities } from './pages/Opportunities';
import { Risk } from './pages/Risk';
import { SystemHealth } from './pages/SystemHealth';
import { NotificationsPage } from './pages/NotificationsPage';
import {
  ProductControlRoomProvider,
  ProductControlRoomRoute,
  useProductControlRoomContext,
} from './features/productControlRoom';
import {
  createHttpProductIntegrationTransport,
  createProductIntegrationClient,
  readDurableMaterialCursor,
  type ProductIntegrationEndpoints,
} from './lib/productIntegration';
import { NotificationFeedProvider } from './lib/notificationFeed';
import { OptionalSurfaceControlProvider } from './lib/optionalSurfaceControl';
import './pages/MetricTiles.css';

const LazyMarkets = lazy(() => import('./pages/Markets').then((module) => ({ default: module.Markets })));
const LazyTokenDetail = lazy(() => import('./pages/TokenDetail').then((module) => ({ default: module.TokenDetail })));
const LazyLedgerPage = lazy(() => import('./pages/LedgerPage').then((module) => ({ default: module.LedgerPage })));
const LazyNews = lazy(() => import('./pages/News').then((module) => ({ default: module.News })));
const LazyCalendarPage = lazy(() => import('./pages/CalendarPage').then((module) => ({ default: module.CalendarPage })));

const PRODUCT_INTEGRATION_ENDPOINTS: Readonly<ProductIntegrationEndpoints> = Object.freeze({
  supervisor: '/api/product-integration/v1/supervisor',
  materialEvents: '/api/product-integration/v1/material-events',
  trace: (correlationId: string) => `/api/product-integration/v1/traces/${encodeURIComponent(correlationId)}`,
  commandResult: (commandId: string) => `/api/product-integration/v1/commands/${encodeURIComponent(commandId)}/result`,
  commandPreview: '/api/product-integration/v1/commands/preview',
  commandSubmit: '/api/product-integration/v1/commands',
});

const productIntegrationClient = createProductIntegrationClient(
  createHttpProductIntegrationTransport(PRODUCT_INTEGRATION_ENDPOINTS),
);
const durableResumeCursor = readDurableMaterialCursor();

function OptionalPageLoading({ label }: { label: string }) {
  return (
    <div className="optional-page-loading" role="status" aria-live="polite">
      <span />
      <b>Loading {label}</b>
    </div>
  );
}

function MutationFailureAlert() {
  const { mutationError } = useStore();
  return (
    <div className="global-mutation-alert" role="alert" aria-atomic="true">
      {mutationError ? (
        <>
          <strong>CHANGE NOT SAVED</strong>
          <span>{mutationError.code} · {mutationError.message}</span>
        </>
      ) : null}
    </div>
  );
}

function Shell() {
  const { page, detailSymbol, prefs } = useStore();
  const { binding: productBinding } = useProductControlRoomContext();
  const mainRef = useRef<HTMLElement | null>(null);
  const framePage = page === 'detail' ? 'detail' : page;
  const productSnapshot = productBinding.snapshot;
  const productBindingState = productBinding.loading
    ? 'LOADING'
    : productBinding.error !== null
      ? 'BLOCKED'
      : productSnapshot === null
        ? 'UNAVAILABLE'
        : 'OBSERVED';

  useEffect(() => {
    mainRef.current?.scrollTo({ top: 0, left: 0 });
  }, [page, detailSymbol]);

  return (
    <div className="app-root">
      <Topbar />
      <MutationFailureAlert />
      <div className="app-body">
        <Sidebar />
        <div className="app-main">
          {prefs.tape && <Tape />}
          <main ref={mainRef} className={`app-page-main page-${framePage}`}>
            <section
              className={`app-page-frame frame-${framePage}`}
              aria-label={`${framePage} workspace`}
              data-i00-product-binding-state={productBindingState}
              data-i00-product-revision={productSnapshot?.revision ?? 'null'}
              data-i00-product-digest={productSnapshot?.digest ?? 'null'}
              data-i00-product-evaluated-at-ms={productSnapshot?.evaluatedAtMs ?? 'null'}
              data-i00-product-truth-label={productSnapshot?.truthLabel ?? 'UNAVAILABLE'}
              data-i00-product-persistent-synthetic={productSnapshot === null ? 'null' : String(productSnapshot.persistentSyntheticLabel)}
              data-i00-product-continuity={productBinding.continuity}
              data-i00-product-machine-ready={productSnapshot?.ownerView.machineReady ?? 'UNKNOWN'}
              data-i00-product-trade-ready={productSnapshot?.ownerView.tradeReady ?? 'UNKNOWN'}
              data-i00-product-effective-mode={productSnapshot?.ownerView.effectiveMode ?? 'UNKNOWN'}
              data-i00-product-tested-commit={productSnapshot?.ownerView.revisions.testedCommit ?? 'null'}
              data-i00-product-schema-revision={productSnapshot?.ownerView.revisions.schemaRevision ?? 'null'}
            >
              <ErrorBoundary resetKey={`${page}-${detailSymbol}`} label={page}>
                {page === 'dashboard' && <Dashboard />}
                {page === 'control-room' && <ProductControlRoomRoute />}
                {page === 'account' && <Account view="overview" />}
                {page === 'wallets' && <Account view="overview" />}
                {page === 'markets' && (
                  <OptionalSurfaceGate surfaceId="markets">
                    <Suspense fallback={<OptionalPageLoading label="Markets" />}>
                      <LazyMarkets />
                    </Suspense>
                  </OptionalSurfaceGate>
                )}
                {page === 'detail' && (
                  <OptionalSurfaceGate surfaceId="token">
                    <Suspense fallback={<OptionalPageLoading label="Token" />}>
                      <LazyTokenDetail symbol={detailSymbol} />
                    </Suspense>
                  </OptionalSurfaceGate>
                )}
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
                {page === 'ledger' && (
                  <OptionalSurfaceGate surfaceId="logs">
                    <Suspense fallback={<OptionalPageLoading label="Logs" />}>
                      <LazyLedgerPage />
                    </Suspense>
                  </OptionalSurfaceGate>
                )}
                {page === 'system' && <SystemHealth />}
                {page === 'notifications' && <NotificationsPage />}
                {page === 'news' && (
                  <OptionalSurfaceGate surfaceId="news">
                    <Suspense fallback={<OptionalPageLoading label="News" />}>
                      <LazyNews />
                    </Suspense>
                  </OptionalSurfaceGate>
                )}
                {page === 'calendar' && (
                  <OptionalSurfaceGate surfaceId="calendar">
                    <Suspense fallback={<OptionalPageLoading label="Calendar" />}>
                      <LazyCalendarPage />
                    </Suspense>
                  </OptionalSurfaceGate>
                )}
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
    <OptionalSurfaceControlProvider>
      <StoreProvider>
        <ProductControlRoomProvider client={productIntegrationClient} initialMaterialCursor={durableResumeCursor}>
          <NotificationFeedProvider>
            <Shell />
          </NotificationFeedProvider>
        </ProductControlRoomProvider>
      </StoreProvider>
    </OptionalSurfaceControlProvider>
  );
}
