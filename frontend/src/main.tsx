import React, { Suspense } from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { LoadingScreen } from './components/SpinnerColaBlanca';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Suspense fallback={<LoadingScreen />}>
      <App />
    </Suspense>
  </React.StrictMode>
);
