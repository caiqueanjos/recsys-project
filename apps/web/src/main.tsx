import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import { App } from './App';
import { StoreProvider } from './state/StoreProvider';
import './style.css';

createRoot(document.getElementById('root')!).render(
  <BrowserRouter>
    <StoreProvider>
      <App />
    </StoreProvider>
  </BrowserRouter>,
);
