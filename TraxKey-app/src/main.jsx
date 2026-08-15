import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './lib/AuthContext.jsx';
import { ThemeProvider } from './lib/ThemeContext.jsx';
import LoginPage from './pages/LoginPage.jsx';
import SignupPage from './pages/SignupPage.jsx';
import DashboardPage from './pages/DashboardPage.jsx';
import PropertiesPage from './pages/PropertiesPage.jsx';
import ResidentsPage from './pages/ResidentsPage.jsx';
import VendorsPage from './pages/VendorsPage.jsx';
import ActivityPage from './pages/ActivityPage.jsx';
import CalendarsPage from './pages/CalendarsPage.jsx';
import TurnsPage from './pages/TurnsPage.jsx';
import LeasesPage from './pages/LeasesPage.jsx';
import BusinessMemoryPage from './pages/BusinessMemoryPage.jsx';
import InspectionsPage from './pages/InspectionsPage.jsx';
import CalendarPage from './pages/CalendarPage.jsx';
import InsightsPage from './pages/InsightsPage.jsx';
import OrderedItemsPage from './pages/OrderedItemsPage.jsx';
import StrOpsPage from './pages/StrOpsPage.jsx';
import OwnersPage from './pages/OwnersPage.jsx';
import InvoicesPage from './pages/InvoicesPage.jsx';
import AnalyticsPage from './pages/AnalyticsPage.jsx';
import AdminSuggestionsPage from './pages/AdminSuggestionsPage.jsx';
import AdminLoginPage from './pages/AdminLoginPage.jsx';
import AdminDashboardPage from './pages/AdminDashboardPage.jsx';
import ForgotPasswordPage from './pages/ForgotPasswordPage.jsx';
import ResetPasswordPage from './pages/ResetPasswordPage.jsx';
import './index.css';

function RequireAuth({ children }) {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  return children;
}

function App() {
  return (
    <ThemeProvider>
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/signup" element={<SignupPage />} />
          <Route path="/forgot-password" element={<ForgotPasswordPage />} />
          <Route path="/reset-password" element={<ResetPasswordPage />} />
          <Route path="/" element={<RequireAuth><DashboardPage /></RequireAuth>} />
          <Route path="/properties" element={<RequireAuth><PropertiesPage /></RequireAuth>} />
          <Route path="/residents" element={<RequireAuth><ResidentsPage /></RequireAuth>} />
          <Route path="/vendors" element={<RequireAuth><VendorsPage /></RequireAuth>} />
          <Route path="/calendars" element={<RequireAuth><CalendarsPage /></RequireAuth>} />
          <Route path="/turns" element={<RequireAuth><TurnsPage /></RequireAuth>} />
          <Route path="/leases" element={<RequireAuth><LeasesPage /></RequireAuth>} />
          <Route path="/business-memory" element={<RequireAuth><BusinessMemoryPage /></RequireAuth>} />
          <Route path="/inspections" element={<RequireAuth><InspectionsPage /></RequireAuth>} />
          <Route path="/calendar" element={<RequireAuth><CalendarPage /></RequireAuth>} />
          <Route path="/insights" element={<RequireAuth><InsightsPage /></RequireAuth>} />
          <Route path="/orders" element={<RequireAuth><OrderedItemsPage /></RequireAuth>} />
          <Route path="/str-ops" element={<RequireAuth><StrOpsPage /></RequireAuth>} />
          <Route path="/owners" element={<RequireAuth><OwnersPage /></RequireAuth>} />
          <Route path="/invoices" element={<RequireAuth><InvoicesPage /></RequireAuth>} />
          <Route path="/analytics" element={<RequireAuth><AnalyticsPage /></RequireAuth>} />
          <Route path="/admin/login" element={<AdminLoginPage />} />
          <Route path="/admin" element={<AdminDashboardPage />} />
          <Route path="/admin/suggestions" element={<AdminSuggestionsPage />} />
          <Route path="/activity" element={<RequireAuth><ActivityPage /></RequireAuth>} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
    </ThemeProvider>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
