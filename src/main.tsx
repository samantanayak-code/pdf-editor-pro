import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { AuthProvider } from './lib/auth';
import * as pdfjsLib from 'pdfjs-dist';
import pdfjsWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker;

const originalConsoleError = console.error;
console.error = (...args) => {
  const errorString = args.join(' ');
  if (
    errorString.includes('growthbook') ||
    errorString.includes('tcpServers') ||
    errorString.includes('Contextify') ||
    errorString.includes('blitz.') ||
    errorString.includes('service_worker') ||
    (errorString.includes('Failed to load resource') && errorString.includes('cdn.'))
  ) {
    return;
  }
  originalConsoleError.apply(console, args);
};

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AuthProvider>
      <App />
    </AuthProvider>
  </StrictMode>
);
