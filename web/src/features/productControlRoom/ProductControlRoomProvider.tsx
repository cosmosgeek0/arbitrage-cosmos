import { createContext, useContext, type ReactNode } from 'react';
import type { SystemSupervisorSnapshot } from '../../lib/systemIntegration';
import {
  type DurableMaterialCursorRead,
  type ProductControlRoomBindingState,
  type ProductIntegrationClient,
  useProductControlRoomBinding,
} from '../../lib/productIntegration';

interface ProductControlRoomContextValue {
  readonly client: Readonly<ProductIntegrationClient>;
  readonly binding: ProductControlRoomBindingState<SystemSupervisorSnapshot>;
}

const ProductControlRoomContext = createContext<ProductControlRoomContextValue | null>(null);

export function ProductControlRoomProvider({
  client,
  initialMaterialCursor,
  children,
}: {
  readonly client: Readonly<ProductIntegrationClient>;
  readonly initialMaterialCursor: Readonly<DurableMaterialCursorRead>;
  readonly children: ReactNode;
}) {
  const binding = useProductControlRoomBinding<SystemSupervisorSnapshot>(client, 5_000, initialMaterialCursor);
  return (
    <ProductControlRoomContext.Provider value={{ client, binding }}>
      {children}
    </ProductControlRoomContext.Provider>
  );
}

export function useProductControlRoomContext(): ProductControlRoomContextValue {
  const context = useContext(ProductControlRoomContext);
  if (!context) throw new Error('PRODUCT_CONTROL_ROOM_PROVIDER_REQUIRED');
  return context;
}
