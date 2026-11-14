import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/plus-jakarta-sans';
import '@fontsource-variable/plus-jakarta-sans/wght-italic.css';
import '@fontsource-variable/geist-mono';
import '@fontsource-variable/geist-mono/wght-italic.css';
import App from './App';
import './styles.css';
import { loadSettings } from './settings';
import { applyAppearance } from './theme';

// Set the theme before the first paint, so there's no flash of the wrong colours.
const saved = loadSettings();
applyAppearance(saved.theme, saved.textSize, saved.colour, saved.customColour);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
