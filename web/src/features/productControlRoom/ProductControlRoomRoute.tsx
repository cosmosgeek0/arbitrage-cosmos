import {
  type ProductCommandRequest,
  type ProductControlRegistryEntry,
} from '../../lib/productIntegration';
import { ProductControlRoom } from './ProductControlRoom';
import { useProductControlRoomContext } from './ProductControlRoomProvider';

export function ProductControlRoomRoute() {
  const { binding, client } = useProductControlRoomContext();
  const continuityBlocked = binding.continuity !== 'PROVEN';
  const preview = (control: Readonly<ProductControlRegistryEntry>) => (
    client.previewCommand(control.controlId, control.currentStateRevision)
  );
  const submit = (request: Readonly<ProductCommandRequest>) => client.submitCommand(request);
  return (
    <ProductControlRoom
      snapshot={continuityBlocked ? null : binding.snapshot}
      staleSnapshot={continuityBlocked ? binding.snapshot : null}
      materialEvents={binding.materialEvents}
      busy={binding.loading}
      unavailableReason={binding.error ?? (continuityBlocked ? `Material-event continuity is ${binding.continuity}.` : null)}
      bindingBlocker={continuityBlocked ? binding.error ?? `Material-event continuity is ${binding.continuity}.` : null}
      onPreview={preview}
      onSubmit={submit}
      onReadTrace={(correlationId) => client.readTrace(correlationId, 200)}
      allowFixtureControls={false}
    />
  );
}
