import React from 'react';
import ReactDOM from 'react-dom/client';
import '../../../styles.css';
import { AiOperations } from '../../../pages/AiOperations';
import { AI_OPERATIONS_SOURCE_BOUND_PREVIEW } from './sourceBoundPreview';
import './preview.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <main className="aiop-preview-main">
      <AiOperations
        projection={AI_OPERATIONS_SOURCE_BOUND_PREVIEW}
        previewLabel="LOCAL PREVIEW"
      />
    </main>
  </React.StrictMode>,
);
