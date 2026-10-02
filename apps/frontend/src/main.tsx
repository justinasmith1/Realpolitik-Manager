import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router/dom';

import { AppProviders } from './app/providers';
import { createAppRouter } from './app/router';
import './styles/globals.css';

const container = document.getElementById('root');

if (!container) {
  throw new Error('No se encontró el elemento #root en index.html.');
}

const router = createAppRouter();

createRoot(container).render(
  <StrictMode>
    <AppProviders>
      <RouterProvider router={router} />
    </AppProviders>
  </StrictMode>,
);
