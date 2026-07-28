import {
  PassiveAiOperationsStatus,
  type AiOperationsPassiveStatusView,
} from '../features/aiOperations';
import '../features/aiOperations/PassiveAiOperationsStatus.css';

interface AiOperationsProps {
  readonly projection: Readonly<AiOperationsPassiveStatusView>;
  readonly previewLabel?: 'LOCAL PREVIEW';
}

export function AiOperations({ projection, previewLabel }: AiOperationsProps) {
  return (
    <div className="container page aiop-page">
      <PassiveAiOperationsStatus projection={projection} previewLabel={previewLabel} />
    </div>
  );
}
