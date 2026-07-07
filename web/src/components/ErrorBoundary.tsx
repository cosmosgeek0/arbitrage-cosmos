import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
  /** Changing this (e.g. the active page) clears a caught error automatically. */
  resetKey?: unknown;
  label?: string;
}
interface State {
  error: Error | null;
}

/**
 * Stops a single component crash from blanking the entire cockpit. Without this,
 * any render-phase throw unmounts the whole React tree → a blank white/black
 * screen. Here we catch it, show a recoverable card, and record the error (console
 * + sessionStorage['cosmos-crash']) so the exact cause can be diagnosed later.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidUpdate(prev: Props): void {
    if (this.state.error && prev.resetKey !== this.props.resetKey) {
      this.setState({ error: null });
    }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // eslint-disable-next-line no-console
    console.error('[cockpit] render crash:', error, info.componentStack);
    try {
      sessionStorage.setItem(
        'cosmos-crash',
        JSON.stringify({
          message: error.message,
          stack: (error.stack ?? '').slice(0, 1400),
          componentStack: (info.componentStack ?? '').slice(0, 1400),
          label: this.props.label ?? null,
          page: localStorage.getItem('cosmos-active-page'),
          at: new Date().toISOString(),
        })
      );
    } catch {
      /* sessionStorage may be unavailable — ignore */
    }
  }

  render(): ReactNode {
    if (this.state.error) {
      return (
        <div className="crash-screen">
          <div className="crash-card">
            <div className="crash-title">This view hit an error</div>
            <p className="crash-sub">
              The cockpit stopped rendering this screen to avoid showing wrong data. Your data and the
              server are unaffected.
            </p>
            <pre className="crash-msg">{this.state.error.message}</pre>
            <div className="crash-actions">
              <button className="crash-btn primary" onClick={() => this.setState({ error: null })}>
                Try again
              </button>
              <button
                className="crash-btn"
                onClick={() => {
                  localStorage.setItem('cosmos-active-page', 'dashboard');
                  window.location.reload();
                }}
              >
                Go to dashboard
              </button>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
