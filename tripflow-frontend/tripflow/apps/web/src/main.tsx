import React from 'react';
import ReactDOM from 'react-dom/client';
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import './index.css';
import { App } from './App';
import { HomePage } from './pages/HomePage';
import { InputPage } from './pages/InputPage';
import { ConfirmPage } from './pages/ConfirmPage';
import { PlanningPage } from './pages/PlanningPage';
import { TripPage } from './pages/TripPage';
import { SettingsPage } from './pages/SettingsPage';

// HashRouter：Netlify 与 Cloudflare Tunnel 下的静态托管都无需服务端路由回退
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <HashRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <App>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/trip/:tripId/input" element={<InputPage />} />
          <Route path="/trip/:tripId/confirm" element={<ConfirmPage />} />
          <Route path="/trip/:tripId/planning" element={<PlanningPage />} />
          <Route path="/trip/:tripId" element={<TripPage />} />
          <Route path="/trip/:tripId/settings" element={<SettingsPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </App>
    </HashRouter>
  </React.StrictMode>,
);
