import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LanguageProvider } from './i18n';
import ErrorBoundary from './components/ErrorBoundary';
import App from './App.tsx';
import './index.css';
import 'leaflet/dist/leaflet.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {/* @ts-expect-error — ErrorBoundary uses @ts-nocheck internally */}
    <ErrorBoundary>
      <LanguageProvider>
        <QueryClientProvider client={queryClient}>
          <BrowserRouter>
            <App />
          </BrowserRouter>
        </QueryClientProvider>
      </LanguageProvider>
    </ErrorBoundary>
  </StrictMode>,
);
