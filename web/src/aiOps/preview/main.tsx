import React, { StrictMode, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { AiOpsWorkspace } from '../AiOpsWorkspace';
import { DEFAULT_AI_OPS_SHADOW_FIXTURE } from '../fixture';
import '../../styles.css';
import '../aiOps.css';
import './preview.css';

function Preview() {
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  const [motion, setMotion] = useState<'full' | 'reduced'>('reduced');

  return (
    <div className="aiox-preview" data-theme={theme} data-motion={motion}>
      <header className="aiox-preview-tools">
        <span>
          <strong>A4 SHADOW fixture QA</strong>
          <small>LOCAL PREVIEW · NOT A PRODUCT ROUTE · NO CANONICAL MOUNT</small>
        </span>
        <button type="button" onClick={() => setTheme((current) => current === 'light' ? 'dark' : 'light')}>
          {theme === 'light' ? 'Dark' : 'Light'} theme
        </button>
        <button type="button" onClick={() => setMotion((current) => current === 'full' ? 'reduced' : 'full')}>
          {motion === 'full' ? 'Reduced motion' : 'Full motion'}
        </button>
      </header>
      <AiOpsWorkspace snapshot={DEFAULT_AI_OPS_SHADOW_FIXTURE} />
    </div>
  );
}

const node = document.getElementById('root');
if (!node) throw new Error('AIOPS_A4_FIXTURE_PREVIEW_ROOT_MISSING');
const host = node as HTMLElement & { __aiOpsA4Root?: Root };
host.__aiOpsA4Root ??= createRoot(host);
host.__aiOpsA4Root.render(<StrictMode><Preview /></StrictMode>);
