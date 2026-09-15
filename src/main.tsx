import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { StoreProvider } from './store';
import App from './App';
import './styles.css';

async function bootstrap() {
  if (import.meta.env.VITE_DATA_MODE === 'mock') await import('./mockApi');
  const root = document.getElementById('root');
  if (!root) throw new Error('Не найден корневой элемент #root');
  createRoot(root).render(
    <StrictMode>
      <StoreProvider>
        <App />
      </StoreProvider>
    </StrictMode>
  );
}

bootstrap().catch((error) => {
  console.error(error);
  const root = document.getElementById('root');
  if (root) root.innerHTML = '<main class="startup-error"><h1>Личный кабинет не запустился</h1><p>Проверьте конфигурацию окружения и повторите загрузку.</p></main>';
});
