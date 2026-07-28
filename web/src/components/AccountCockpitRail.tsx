import { AccountCockpitRailView } from './AccountCockpitRailView';
import { useStore } from '../store';
import './AccountCockpitRail.css';

/**
 * The shared account cockpit. It is mounted once in the app shell ahead of the
 * route, so every surface reads the same account truth without repeating it.
 *
 * This rail owns no transport. The store remains the single private-read owner
 * and its existing state read plus bounded fallback remain the only private
 * transports: nothing here fetches, polls, schedules, subscribes, or derives
 * account facts of its own.
 */
export function AccountCockpitRail() {
  const { privateRead, privateReadSource, privateReadError } = useStore();
  return (
    <AccountCockpitRailView
      snapshot={privateRead}
      source={privateReadSource}
      error={privateReadError}
    />
  );
}
