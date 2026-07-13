import type { SurfaceId } from '../../lib/productIntegration';

export interface SurfaceMountContract {
  readonly surfaceId: SurfaceId;
  readonly existingOwner: string;
  readonly insertionAnchor: string;
  readonly adapterExport: string;
  readonly mountKind: 'REPLACE_LEGACY_SUMMARY' | 'APPEND_CANONICAL_BAND' | 'REGISTER_DIRECTOR_ROUTE' | 'ACCOUNT_SUBVIEW';
}

export const SURFACE_MOUNT_CONTRACTS: readonly Readonly<SurfaceMountContract>[] = Object.freeze([
  { surfaceId: 'dashboard', existingOwner: 'web/src/pages/Dashboard.tsx', insertionAnchor: '<SystemIntegrationSurface surface="dashboard" />', adapterExport: 'ProductSurfaceAdapter surfaceId="dashboard"', mountKind: 'REPLACE_LEGACY_SUMMARY' },
  { surfaceId: 'control-room', existingOwner: 'web/src/App.tsx + web/src/components/Header.tsx', insertionAnchor: 'director-owned route and navigation registration', adapterExport: 'ProductControlRoomRoute', mountKind: 'REGISTER_DIRECTOR_ROUTE' },
  { surfaceId: 'account', existingOwner: 'web/src/pages/Account.tsx', insertionAnchor: 'inside Account data-view frame after canonical account summary', adapterExport: 'ProductSurfaceAdapter surfaceId="account"', mountKind: 'APPEND_CANONICAL_BAND' },
  { surfaceId: 'markets', existingOwner: 'web/src/pages/Markets.tsx', insertionAnchor: 'after Markets summary and before the table canvas', adapterExport: 'ProductSurfaceAdapter surfaceId="markets"', mountKind: 'APPEND_CANONICAL_BAND' },
  { surfaceId: 'token', existingOwner: 'web/src/pages/TokenDetail.tsx', insertionAnchor: 'after symbol identity summary and before evidence workspace', adapterExport: 'ProductSurfaceAdapter surfaceId="token"', mountKind: 'APPEND_CANONICAL_BAND' },
  { surfaceId: 'basis', existingOwner: 'web/src/pages/Strategies.tsx', insertionAnchor: 'after Basis workspace header', adapterExport: 'ProductSurfaceAdapter surfaceId="basis"', mountKind: 'APPEND_CANONICAL_BAND' },
  { surfaceId: 'volume', existingOwner: 'web/src/pages/VolumeScanner.tsx', insertionAnchor: 'after Volume workspace header', adapterExport: 'ProductSurfaceAdapter surfaceId="volume"', mountKind: 'APPEND_CANONICAL_BAND' },
  { surfaceId: 'opportunities', existingOwner: 'web/src/pages/Opportunities.tsx', insertionAnchor: '<SystemIntegrationSurface surface="opportunities" />', adapterExport: 'ProductSurfaceAdapter surfaceId="opportunities"', mountKind: 'REPLACE_LEGACY_SUMMARY' },
  { surfaceId: 'borrow', existingOwner: 'web/src/pages/Loans.tsx', insertionAnchor: 'after Borrow workspace summary', adapterExport: 'ProductSurfaceAdapter surfaceId="borrow"', mountKind: 'APPEND_CANONICAL_BAND' },
  { surfaceId: 'execution', existingOwner: 'web/src/pages/Account.tsx', insertionAnchor: 'MISSING: director must add explicit execution view to AccountView and route it from App', adapterExport: 'ProductSurfaceAdapter surfaceId="execution"', mountKind: 'ACCOUNT_SUBVIEW' },
  { surfaceId: 'orders', existingOwner: 'web/src/pages/Account.tsx', insertionAnchor: 'existing orders view; App must pass the orders route instead of defaulting to overview', adapterExport: 'ProductSurfaceAdapter surfaceId="orders"', mountKind: 'ACCOUNT_SUBVIEW' },
  { surfaceId: 'positions', existingOwner: 'web/src/pages/Account.tsx', insertionAnchor: 'MISSING: director must add explicit positions view to AccountView and route it from App', adapterExport: 'ProductSurfaceAdapter surfaceId="positions"', mountKind: 'ACCOUNT_SUBVIEW' },
  { surfaceId: 'fills', existingOwner: 'web/src/pages/Account.tsx', insertionAnchor: 'existing fills view; App must pass the fills route instead of defaulting to overview', adapterExport: 'ProductSurfaceAdapter surfaceId="fills"', mountKind: 'ACCOUNT_SUBVIEW' },
  { surfaceId: 'pnl', existingOwner: 'web/src/pages/Account.tsx', insertionAnchor: 'MISSING: director must add explicit pnl view to AccountView and route it from App', adapterExport: 'ProductSurfaceAdapter surfaceId="pnl"', mountKind: 'ACCOUNT_SUBVIEW' },
  { surfaceId: 'risk', existingOwner: 'web/src/pages/Risk.tsx', insertionAnchor: '<SystemIntegrationSurface surface="risk" />', adapterExport: 'ProductSurfaceAdapter surfaceId="risk"', mountKind: 'REPLACE_LEGACY_SUMMARY' },
  { surfaceId: 'health', existingOwner: 'web/src/pages/SystemHealth.tsx', insertionAnchor: '<SystemIntegrationSurface surface="health" />', adapterExport: 'ProductSurfaceAdapter surfaceId="health"', mountKind: 'REPLACE_LEGACY_SUMMARY' },
  { surfaceId: 'logs-ledger', existingOwner: 'web/src/pages/LedgerPage.tsx', insertionAnchor: '<SystemIntegrationSurface surface="logs" />', adapterExport: 'ProductSurfaceAdapter surfaceId="logs-ledger"', mountKind: 'REPLACE_LEGACY_SUMMARY' },
  { surfaceId: 'notifications', existingOwner: 'web/src/pages/NotificationsPage.tsx', insertionAnchor: 'inside Inbox before daily incident tape', adapterExport: 'ProductSurfaceAdapter surfaceId="notifications"', mountKind: 'APPEND_CANONICAL_BAND' },
]);

const UNIQUE_SURFACES = new Set(SURFACE_MOUNT_CONTRACTS.map((entry) => entry.surfaceId));
if (UNIQUE_SURFACES.size !== SURFACE_MOUNT_CONTRACTS.length) {
  throw new Error('PRODUCT_SURFACE_MOUNT_DUPLICATE');
}
