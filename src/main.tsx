import './theme.css';
import './theme.js';
import { createRoot } from 'react-dom/client';
import { withRemoteAuthUrl } from './api.js';
import { App } from './App.js';

if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
  navigator.serviceWorker.register(withRemoteAuthUrl('/sw.js'), { scope: '/' }).catch(() => {});
}

createRoot(document.getElementById('root')!).render(<App />);

