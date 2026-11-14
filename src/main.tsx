import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/plus-jakarta-sans';
import '@fontsource-variable/plus-jakarta-sans/wght-italic.css';
import '@fontsource-variable/geist-mono';
import '@fontsource-variable/geist-mono/wght-italic.css';
import App from './App';
import ErrorBoundary from './ErrorBoundary';
import './styles.css';
import { loadSettings } from './settings';
import { applyAppearance, applyFonts } from './theme';

// Set the theme before the first paint, so there's no flash of the wrong colours.
const saved = loadSettings();
applyAppearance(saved.theme, saved.textSize, saved.colour, saved.customColour, saved.lineSpacing);
applyFonts(saved.textFont, saved.codeFont);

// The built app can be installed and opens without its server running (see public/sw.js). Not in development,
// where a saved copy of the files would get in the way of live reloading.
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
