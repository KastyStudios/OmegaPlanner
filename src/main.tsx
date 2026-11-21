import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import '@fontsource-variable/schibsted-grotesk';
import './index.css';
import { applyTheme } from './lib/theme';

applyTheme();

// iOS Safari ignores user-scalable=no for pinch gestures; block them here.
for (const type of ['gesturestart', 'gesturechange', 'gestureend']) {
  document.addEventListener(type, (e) => e.preventDefault(), { passive: false });
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
