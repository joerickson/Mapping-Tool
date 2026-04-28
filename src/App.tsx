import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { SignedIn, SignedOut, RedirectToSignIn } from '@clerk/clerk-react'
import SignInPage from './pages/SignIn'
import SignUpPage from './pages/SignUp'
import UploadPage from './pages/Upload'
import MapPage from './pages/Map'
import ServiceLocationPage from './pages/ServiceLocation'
import PortfolioPage from './pages/Portfolio'
import SharedPortfolioPage from './pages/SharedPortfolio'
import ParcelImportPage from './pages/admin/parcels/Import'
import CountiesPage from './pages/admin/parcels/Counties'
import FallbacksPage from './pages/admin/parcels/Fallbacks'

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  return (
    <>
      <SignedIn>{children}</SignedIn>
      <SignedOut>
        <RedirectToSignIn />
      </SignedOut>
    </>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/sign-in" element={<SignInPage />} />
        <Route path="/sign-up" element={<SignUpPage />} />
        <Route path="/portfolio/:shareToken" element={<SharedPortfolioPage />} />
        <Route
          path="/"
          element={
            <ProtectedRoute>
              <Navigate to="/map" replace />
            </ProtectedRoute>
          }
        />
        <Route
          path="/map"
          element={
            <ProtectedRoute>
              <MapPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/upload"
          element={
            <ProtectedRoute>
              <UploadPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/locations/:serviceLocationId"
          element={
            <ProtectedRoute>
              <ServiceLocationPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/portfolios/:portfolioId"
          element={
            <ProtectedRoute>
              <PortfolioPage />
            </ProtectedRoute>
          }
        />
        {/* Admin — Parcel data layer */}
        <Route
          path="/admin/parcels/import"
          element={
            <ProtectedRoute>
              <ParcelImportPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/admin/parcels/counties"
          element={
            <ProtectedRoute>
              <CountiesPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/admin/parcels/fallbacks"
          element={
            <ProtectedRoute>
              <FallbacksPage />
            </ProtectedRoute>
          }
        />
      </Routes>
    </BrowserRouter>
  )
}
