import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/plus-jakarta-sans';
import '@fontsource-variable/plus-jakarta-sans/wght-italic.css';
import '@fontsource-variable/geist-mono';
import '@fontsource-variable/geist-mono/wght-italic.css';
import App from './App';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
