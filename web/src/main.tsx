import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { ErrorBoundary } from './components/ErrorBoundary';
import './styles.css';

// Capture non-React runtime errors too (event handlers, async, WS), so an
// intermittent crash leaves a breadcrumb in sessionStorage for diagnosis.
window.addEventListener('error', (e) => {
  try {
    sessionStorage.setItem(
      'cosmos-winerr',
      JSON.stringify({ msg: e.message, src: e.filename, line: e.lineno, col: e.colno, at: new Date().toISOString() })
    );
  } catch {
    /* ignore */
  }
});
window.addEventListener('unhandledrejection', (e) => {
  try {
    sessionStorage.setItem('cosmos-winrej', JSON.stringify({ reason: String(e.reason).slice(0, 700), at: new Date().toISOString() }));
  } catch {
    /* ignore */
  }
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary label="app-root">
      <App />
    </ErrorBoundary>
  </StrictMode>
);
