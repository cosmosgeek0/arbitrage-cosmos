import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { ErrorBoundary } from './components/ErrorBoundary';
import './styles.css';

// A random, first-party device identity keeps Recent Devices truthful when
// multiple browsers share the same public IP and User-Agent. The raw token is
// never returned by the API or stored server-side; the server stores a hash.
const DEVICE_ID_COOKIE = 'cosmos_device';
const DEVICE_ID_STORAGE = 'cosmos-device-id';
function ensureBrowserDeviceIdentity(): void {
  try {
    const cookiePresent = document.cookie.split(';').some((part) => part.trim().startsWith(`${DEVICE_ID_COOKIE}=`));
    if (cookiePresent) return;
    let token = localStorage.getItem(DEVICE_ID_STORAGE);
    if (!token) {
      token = typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : Array.from(crypto.getRandomValues(new Uint8Array(24)), (value) => value.toString(16).padStart(2, '0')).join('');
      localStorage.setItem(DEVICE_ID_STORAGE, token);
    }
    const secure = window.location.protocol === 'https:' ? '; Secure' : '';
    document.cookie = `${DEVICE_ID_COOKIE}=${encodeURIComponent(token)}; Path=/; Max-Age=31536000; SameSite=Strict${secure}`;
  } catch {
    // Privacy settings can disable storage/cookies. The server retains its
    // honest IP + User-Agent fallback for those browsers.
  }
}
ensureBrowserDeviceIdentity();

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
