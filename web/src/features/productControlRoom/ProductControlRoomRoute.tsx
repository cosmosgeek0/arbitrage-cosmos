import {
  type ProductCommandRequest,
  type ProductControlRegistryEntry,
} from '../../lib/productIntegration';
import { ProductControlRoom } from './ProductControlRoom';
import { useProductControlRoomContext } from './ProductControlRoomProvider';

export function ProductControlRoomRoute() {
  const { binding, client } = useProductControlRoomContext();
  const preview = (control: Readonly<ProductControlRegistryEntry>) => (
    client.previewCommand(control.controlId, control.currentStateRevision)
  );
  const submit = (request: Readonly<ProductCommandRequest>) => client.submitCommand(request);
  return (
    <ProductControlRoom
      snapshot={binding.continuity === 'BLOCKED' ? null : binding.snapshot}
      staleSnapshot={binding.continuity === 'BLOCKED' ? binding.snapshot : null}
      busy={binding.loading}
      unavailableReason={binding.error ?? (binding.continuity === 'BLOCKED' ? 'Material-event continuity is blocked.' : null)}
      bindingBlocker={binding.continuity === 'BLOCKED' ? binding.error ?? 'Material-event continuity is blocked.' : null}
      onPreview={preview}
      onSubmit={submit}
      allowFixtureControls={false}
    />
  );
}
