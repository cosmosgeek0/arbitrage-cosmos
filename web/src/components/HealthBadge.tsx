import { useStore } from '../store';
import { IconWifi } from './Icons';
import { timeAgo } from '../format';

export function HealthBadge() {
  const { state, connected, setPage } = useStore();
  const feeds = state?.feeds ?? {};
  const feedsOk = Object.values(feeds).every((s) => s === 'open') && Object.keys(feeds).length > 0;
  const grade = !connected ? 'bad' : !feedsOk ? 'warn' : 'ok';

  return (
    <button className={`health-badge ${grade}`} onClick={() => setPage('account')} title="Connection health">
      <IconWifi size={19} />
      <span className="hb-dot" />
      <span className="hb-tip">
        <span className="hb-row">
          <span className="k">Dashboard link</span>
          <span className="v">{connected ? 'live' : 'reconnecting'}</span>
        </span>
        {Object.entries(feeds).map(([name, s]) => (
          <span key={name} className="hb-row">
            <span className="k">{name}</span>
            <span className="v">{s}</span>
          </span>
        ))}
        <span className="hb-row">
          <span className="k">Binance account</span>
          <span className="v">
            {state?.binance.keysPresent
              ? state.binance.connected
                ? `synced ${timeAgo(state.binance.lastSyncTs)}`
                : 'error'
              : 'no keys'}
          </span>
        </span>
        <span className="hb-row">
          <span className="k">User stream</span>
          <span className="v">{state?.binance.userStream ?? '—'}</span>
        </span>
      </span>
    </button>
  );
}
