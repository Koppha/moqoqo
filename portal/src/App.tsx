import { Navigate, Route, Routes, useLocation } from 'react-router'
import type { ReactNode } from 'react'
import { useAuth } from './auth'
import { Layout } from './components/Layout'
import { AuditPage } from './pages/Audit'
import { DashboardPage } from './pages/Dashboard'
import { EcoSurePage } from './pages/EcoSure'
import { NotificationsPage } from './pages/Notifications'
import { ServicesPage } from './pages/Services'
import { BrandingPage } from './pages/Branding'
import { AtmPage } from './pages/Atm'
import { HomeOffersPage } from './pages/HomeOffers'
import { PlacesPage } from './pages/Places'
import { FeedbackPage } from './pages/Feedback'
import { SupportPage } from './pages/Support'
import { AnalyticsPage } from './pages/Analytics'
import { PerformancePage } from './pages/Performance'
import { RiskPage } from './pages/Risk'
import { RemittancePage } from './pages/Remittance'
import { DonatePage } from './pages/Donate'
import { UssdPage } from './pages/Ussd'
import { SocietiesPage } from './pages/Societies'
import { SplitBillPage } from './pages/SplitBill'
import { LoginPage } from './pages/Login'
import { MaintenancePage } from './pages/Maintenance'
import { SettingsPage } from './pages/Settings'
import { TransactionsPage } from './pages/Transactions'
import { UsersPage } from './pages/Users'

function RequireAuth({ children }: { children: ReactNode }) {
  const { admin } = useAuth()
  const location = useLocation()
  if (!admin) return <Navigate to="/login" replace state={{ from: location.pathname }} />
  return <>{children}</>
}

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        element={
          <RequireAuth>
            <Layout />
          </RequireAuth>
        }
      >
        <Route index element={<DashboardPage />} />
        <Route path="maintenance" element={<MaintenancePage />} />
        <Route path="users" element={<UsersPage />} />
        <Route path="transactions" element={<TransactionsPage />} />
        <Route path="ecosure" element={<EcoSurePage />} />
        <Route path="services" element={<ServicesPage />} />
        <Route path="branding" element={<BrandingPage />} />
        <Route path="atm" element={<AtmPage />} />
        <Route path="remittance" element={<RemittancePage />} />
        <Route path="split-bill" element={<SplitBillPage />} />
        <Route path="societies" element={<SocietiesPage />} />
        <Route path="donate" element={<DonatePage />} />
        <Route path="ussd" element={<UssdPage />} />
        <Route path="home-offers" element={<HomeOffersPage />} />
        <Route path="places" element={<PlacesPage />} />
        <Route path="support" element={<SupportPage />} />
        <Route path="feedback" element={<FeedbackPage />} />
        <Route path="analytics" element={<AnalyticsPage />} />
        <Route path="performance" element={<PerformancePage />} />
        <Route path="risk" element={<RiskPage />} />
        <Route path="notifications" element={<NotificationsPage />} />
        <Route path="audit" element={<AuditPage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  )
}
