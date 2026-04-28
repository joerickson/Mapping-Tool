import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import AuthGuard from './components/auth/AuthGuard'
import LoginPage from './pages/Login'
import SignupPage from './pages/Signup'
import LogoutPage from './pages/Logout'
import ForgotPasswordPage from './pages/ForgotPassword'
import UpdatePasswordPage from './pages/UpdatePassword'
import UploadPage from './pages/Upload'
import MapPage from './pages/Map'
import ServiceLocationPage from './pages/ServiceLocation'
import PortfolioPage from './pages/Portfolio'
import SharedPortfolioPage from './pages/SharedPortfolio'
import ParcelImportPage from './pages/admin/parcels/Import'
import CountiesPage from './pages/admin/parcels/Counties'
import FallbacksPage from './pages/admin/parcels/Fallbacks'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* Public auth routes */}
        <Route path="/login" element={<LoginPage />} />
        <Route path="/login/forgot-password" element={<ForgotPasswordPage />} />
        <Route path="/login/update-password" element={<UpdatePasswordPage />} />
        <Route path="/signup" element={<SignupPage />} />
        <Route path="/logout" element={<LogoutPage />} />

        {/* Public share / embed routes — no auth required */}
        <Route path="/portfolio/:shareToken" element={<SharedPortfolioPage />} />

        {/* Protected app routes */}
        <Route
          path="/"
          element={
            <AuthGuard>
              <Navigate to="/map" replace />
            </AuthGuard>
          }
        />
        <Route
          path="/map"
          element={
            <AuthGuard>
              <MapPage />
            </AuthGuard>
          }
        />
        <Route
          path="/upload"
          element={
            <AuthGuard>
              <UploadPage />
            </AuthGuard>
          }
        />
        <Route
          path="/locations/:serviceLocationId"
          element={
            <AuthGuard>
              <ServiceLocationPage />
            </AuthGuard>
          }
        />
        <Route
          path="/portfolios/:portfolioId"
          element={
            <AuthGuard>
              <PortfolioPage />
            </AuthGuard>
          }
        />

        {/* Admin — Parcel data layer */}
        <Route
          path="/admin/parcels/import"
          element={
            <AuthGuard>
              <ParcelImportPage />
            </AuthGuard>
          }
        />
        <Route
          path="/admin/parcels/counties"
          element={
            <AuthGuard>
              <CountiesPage />
            </AuthGuard>
          }
        />
        <Route
          path="/admin/parcels/fallbacks"
          element={
            <AuthGuard>
              <FallbacksPage />
            </AuthGuard>
          }
        />
      </Routes>
    </BrowserRouter>
  )
}
