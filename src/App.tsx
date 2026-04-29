import React from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { ClientProvider } from './context/ClientContext'
import AuthGuard from './components/auth/AuthGuard'
import LoginPage from './pages/Login'
import SignupPage from './pages/Signup'
import LogoutPage from './pages/Logout'
import ForgotPasswordPage from './pages/ForgotPassword'
import UpdatePasswordPage from './pages/UpdatePassword'
import UploadPage from './pages/Upload'
import UploadReviewPage from './pages/UploadReview'
import MapPage from './pages/Map'
import ServiceLocationPage from './pages/ServiceLocation'
import PortfolioPage from './pages/Portfolio'
import SharedPortfolioPage from './pages/SharedPortfolio'
import ParcelImportPage from './pages/admin/parcels/Import'
import CountiesPage from './pages/admin/parcels/Counties'
import FallbacksPage from './pages/admin/parcels/Fallbacks'
import DangerousAdminPage from './pages/admin/Dangerous'
import AdminUploadsPage from './pages/admin/Uploads'
import AdminHubPage from './pages/admin/AdminHub'
import AccountsListPage from './pages/accounts/AccountsList'
import NewAccountPage from './pages/accounts/NewAccount'
import AccountDetailPage from './pages/accounts/AccountDetail'
import AccountAnalysisPage from './pages/accounts/AccountAnalysis'
import NewAccountClientPage from './pages/accounts/NewAccountClient'
import ClientsListPage from './pages/clients/ClientsList'
import NewClientPage from './pages/clients/NewClient'
import ClientDetailPage from './pages/clients/ClientDetail'
import ClientSetupPage from './pages/clients/ClientSetup'
import UploadSummaryPage from './pages/UploadSummary'
import PropertyDetailPage from './pages/PropertyDetail'

class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean; error: Error | null }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error }
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center h-screen bg-gray-50 p-8 text-center">
          <div className="max-w-md">
            <h1 className="text-xl font-semibold text-gray-900 mb-2">Something went wrong</h1>
            <p className="text-sm text-gray-500 mb-4">
              {this.state.error?.message ?? 'An unexpected error occurred.'}
            </p>
            <button
              onClick={() => { this.setState({ hasError: false, error: null }); window.location.reload() }}
              className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700"
            >
              Reload Page
            </button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}

export default function App() {
  return (
    <ErrorBoundary>
    <BrowserRouter>
      <ClientProvider>
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
          <Route path="/" element={<AuthGuard><Navigate to="/map" replace /></AuthGuard>} />
          <Route path="/map" element={<AuthGuard><MapPage /></AuthGuard>} />
          <Route path="/upload" element={<AuthGuard><UploadPage /></AuthGuard>} />
          <Route path="/upload/:batchId/review" element={<AuthGuard><UploadReviewPage /></AuthGuard>} />
          <Route path="/uploads/:batchId/summary" element={<AuthGuard><UploadSummaryPage /></AuthGuard>} />
          <Route path="/locations/:serviceLocationId" element={<AuthGuard><ServiceLocationPage /></AuthGuard>} />
          <Route path="/properties/:id" element={<AuthGuard><PropertyDetailPage /></AuthGuard>} />
          <Route path="/portfolios/:portfolioId" element={<AuthGuard><PortfolioPage /></AuthGuard>} />

          {/* Accounts */}
          <Route path="/accounts" element={<AuthGuard><AccountsListPage /></AuthGuard>} />
          <Route path="/accounts/new" element={<AuthGuard><NewAccountPage /></AuthGuard>} />
          <Route path="/accounts/:id" element={<AuthGuard><AccountDetailPage /></AuthGuard>} />
          <Route path="/accounts/:accountId/analysis" element={<AuthGuard><AccountAnalysisPage /></AuthGuard>} />
          <Route path="/accounts/:id/clients/new" element={<AuthGuard><NewAccountClientPage /></AuthGuard>} />

          {/* Clients */}
          <Route path="/clients" element={<AuthGuard><ClientsListPage /></AuthGuard>} />
          <Route path="/clients/new" element={<AuthGuard><NewClientPage /></AuthGuard>} />
          <Route path="/clients/:id" element={<AuthGuard><ClientDetailPage /></AuthGuard>} />
          <Route path="/clients/:id/setup" element={<AuthGuard><ClientSetupPage /></AuthGuard>} />

          {/* Admin */}
          <Route path="/admin" element={<AuthGuard><AdminHubPage /></AuthGuard>} />
          <Route path="/admin/dangerous" element={<AuthGuard><DangerousAdminPage /></AuthGuard>} />
          <Route path="/admin/uploads" element={<AuthGuard><AdminUploadsPage /></AuthGuard>} />
          <Route path="/admin/parcels/import" element={<AuthGuard><ParcelImportPage /></AuthGuard>} />
          <Route path="/admin/parcels/counties" element={<AuthGuard><CountiesPage /></AuthGuard>} />
          <Route path="/admin/parcels/fallbacks" element={<AuthGuard><FallbacksPage /></AuthGuard>} />
        </Routes>
      </ClientProvider>
    </BrowserRouter>
    </ErrorBoundary>
  )
}
