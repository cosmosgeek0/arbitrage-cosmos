export const DASHBOARD_TABS = [
  { id: 'overview', label: 'Overview', detail: 'Posture & Attention' },
  { id: 'engines', label: 'Engines', detail: 'Basis, Volume & Q' },
  { id: 'connections', label: 'Connections Watchman', detail: 'Sources & Coverage' },
  { id: 'transitions', label: 'Reboot/Transitions', detail: 'Machine & Trace' },
  { id: 'risk', label: 'Risk/Controls', detail: 'Capital & Guardrails' },
] as const;

export type DashboardTabId = (typeof DASHBOARD_TABS)[number]['id'];
export type DashboardTabOrientation = 'horizontal' | 'vertical';

export function dashboardTabIndexForKey(
  currentIndex: number,
  key: string,
  orientation: DashboardTabOrientation,
): number | null {
  const lastIndex = DASHBOARD_TABS.length - 1;
  if (key === 'Home') return 0;
  if (key === 'End') return lastIndex;

  const previousKey = orientation === 'vertical' ? 'ArrowUp' : 'ArrowLeft';
  const nextKey = orientation === 'vertical' ? 'ArrowDown' : 'ArrowRight';
  if (key === previousKey) return currentIndex === 0 ? lastIndex : currentIndex - 1;
  if (key === nextKey) return currentIndex === lastIndex ? 0 : currentIndex + 1;
  return null;
}
