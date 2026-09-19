import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';

// Ensure benign Vite development / websocket messages do not trigger false positive errors
if (typeof window !== 'undefined') {
  const isViteNotice = (arg: any): boolean => {
    if (!arg) return false;
    const str = typeof arg === 'string' ? arg : (arg?.message || arg?.stack || String(arg) || '');
    return (
      str.includes('[vite]') ||
      str.includes('failed to connect to websocket') ||
      str.includes('WebSocket closed') ||
      str.includes('vite:ws')
    );
  };

  const origError = console.error;
  const origWarn = console.warn;

  console.error = (...args: any[]) => {
    if (args.some(isViteNotice)) return;
    origError.apply(console, args);
  };

  console.warn = (...args: any[]) => {
    if (args.some(isViteNotice)) return;
    origWarn.apply(console, args);
  };

  window.addEventListener(
    'unhandledrejection',
    (e) => {
      if (isViteNotice(e.reason)) {
        e.preventDefault();
        e.stopImmediatePropagation();
      }
    },
    true
  );
}

createRoot(document.getElementById('root')!).render(
  <App />
);
