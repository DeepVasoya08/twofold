import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './App';
import { Providers } from './app/Providers';
import { finishGoogleSignIn } from './app/google-sign-in';
import { setUpLibrary } from './app/library-platform';
import { BrowserRouter } from './app/router';

import './styles/base.css';

const container = document.getElementById('root');
if (!container) {
  throw new Error('Root element #root not found');
}

// The Google sign-in window comes back here; it passes its answer on and closes.
if (finishGoogleSignIn(window.location)) {
  container.textContent = 'Google Photos is connected. You can close this window.';
} else {
  setUpLibrary();
  createRoot(container).render(
    <StrictMode>
      <BrowserRouter>
        <Providers>
          <App />
        </Providers>
      </BrowserRouter>
    </StrictMode>,
  );
}
