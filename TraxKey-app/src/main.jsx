import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './lib/AuthContext.jsx';
import { ThemeProvider } from './lib/ThemeContext.jsx';
import DashboardShell from './components/DashboardShell.jsx';
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
import PropertyProfilePage from './pages/PropertyProfilePage.jsx';
import PricingPage from './pages/PricingPage.jsx';
import PortfolioChatPage from './pages/PortfolioChatPage.jsx';
import AdminSuggestionsPage from './pages/AdminSuggestionsPage.jsx';
import AdminLoginPage from './pages/AdminLoginPage.jsx';
import AdminDashboardPage from './pages/AdminDashboardPage.jsx';
import ForgotPasswordPage from './pages/ForgotPasswordPage.jsx';
import ResetPasswordPage from './pages/ResetPasswordPage.jsx';
import ProfilePage from './pages/ProfilePage.jsx';
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
          <Route path="/admin/login" element={<AdminLoginPage />} />
          <Route path="/admin" element={<AdminDashboardPage />} />
          <Route path="/admin/suggestions" element={<AdminSuggestionsPage />} />

          <Route element={<RequireAuth><DashboardShell /></RequireAuth>}>
            <Route path="/" element={<DashboardPage />} />
            <Route path="/properties" element={<PropertiesPage />} />
            <Route path="/residents" element={<ResidentsPage />} />
            <Route path="/vendors" element={<VendorsPage />} />
            <Route path="/calendars" element={<CalendarsPage />} />
            <Route path="/turns" element={<TurnsPage />} />
            <Route path="/leases" element={<LeasesPage />} />
            <Route path="/business-memory" element={<BusinessMemoryPage />} />
            <Route path="/inspections" element={<InspectionsPage />} />
            <Route path="/calendar" element={<CalendarPage />} />
            <Route path="/insights" element={<InsightsPage />} />
            <Route path="/orders" element={<OrderedItemsPage />} />
            <Route path="/str-ops" element={<StrOpsPage />} />
            <Route path="/owners" element={<OwnersPage />} />
            <Route path="/invoices" element={<InvoicesPage />} />
            <Route path="/analytics" element={<AnalyticsPage />} />
            <Route path="/ask" element={<PortfolioChatPage />} />
            <Route path="/onboarding" element={<PropertyProfilePage />} />
            <Route path="/pricing" element={<PricingPage />} />
            <Route path="/profile" element={<ProfilePage />} />
            <Route path="/activity" element={<ActivityPage />} />
          </Route>
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
