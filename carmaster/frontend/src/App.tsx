import { Routes, Route, Navigate } from 'react-router-dom';
import { DashboardPage } from './pages/Dashboard';
import { JobsPage } from './pages/Jobs';
import { CustomersPage } from './pages/Customers';
import { QuotesPage } from './pages/Quotes';
import { QuoteDetailPage } from './pages/QuoteDetail';
import { InvoicesPage } from './pages/Invoices';
import { InvoiceDetailPage } from './pages/InvoiceDetail';
import { SettingsPage } from './pages/Settings';
import { LoginPage } from './pages/Login';
import { ProtectedRoute } from './components/ProtectedRoute';
import { PublicPWA } from './pages/PublicPWA';
import { ServiceSchedulePage } from './pages/ServiceSchedule';

function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/q" element={<PublicPWA />} />
      <Route
        path="/"
        element={
          <ProtectedRoute>
            <DashboardPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/jobs"
        element={
          <ProtectedRoute>
            <JobsPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/customers"
        element={
          <ProtectedRoute>
            <CustomersPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/service-schedule"
        element={
          <ProtectedRoute>
            <ServiceSchedulePage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/quotes"
        element={
          <ProtectedRoute>
            <QuotesPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/quotes/:id"
        element={
          <ProtectedRoute>
            <QuoteDetailPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/invoices"
        element={
          <ProtectedRoute>
            <InvoicesPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/invoices/:id"
        element={
          <ProtectedRoute>
            <InvoiceDetailPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/settings"
        element={
          <ProtectedRoute>
            <SettingsPage />
          </ProtectedRoute>
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default App;
