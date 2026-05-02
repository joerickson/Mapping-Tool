import React from 'react'
import { BrowserRouter, Routes, Route, Navigate, useParams } from 'react-router-dom'
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
import AdminUsersPage from './pages/admin/Users'
import AdminBootstrapPage from './pages/admin/Bootstrap'
import InviteAcceptPage from './pages/InviteAccept'
import AuthCallbackPage from './pages/AuthCallback'
import AdminGuard from './components/auth/AdminGuard'
import AccountsListPage from './pages/accounts/AccountsList'
import NewAccountPage from './pages/accounts/NewAccount'
import AccountDetailPage from './pages/accounts/AccountDetail'
import AccountAnalysisPage from './pages/accounts/AccountAnalysis'
import ConstraintTemplatesPage from './pages/accounts/ConstraintTemplates'
import AuditLogPage from './pages/accounts/AuditLog'
import PropertiesAdminPage from './pages/accounts/PropertiesAdmin'
import SchedulerPage from './pages/accounts/Scheduler'
import ServiceOfferingsPage from './pages/accounts/ServiceOfferings'
import TemplatesListPage from './pages/accounts/scheduler/TemplatesList'
import NewTemplatePage from './pages/accounts/scheduler/NewTemplate'
import TemplateDetailPage from './pages/accounts/scheduler/TemplateDetail'
import CycleComparePage from './pages/accounts/scheduler/CycleCompare'
import CycleDetailPage from './pages/accounts/scheduler/CycleDetail'
import CombinedSchedulesPage from './pages/accounts/scheduler/CombinedSchedules'
import TravelPlannerPage from './pages/accounts/TravelPlanner'
import CustomFieldsAdminPage from './pages/accounts/CustomFieldsAdmin'
import NewAccountClientPage from './pages/accounts/NewAccountClient'
import NewCombinedClientPage from './pages/accounts/NewCombinedClient'
import ClientsListPage from './pages/clients/ClientsList'
import NewClientPage from './pages/clients/NewClient'
import ClientDetailPage from './pages/clients/ClientDetail'
import ClientSetupPage from './pages/clients/ClientSetup'
import UploadSummaryPage from './pages/UploadSummary'
import PropertyDetailPage from './pages/PropertyDetail'
import DesignSystemPage from './pages/DesignSystem'
import { ToastProvider } from './components/ui/Toast'

// Phase 3.6 — old /accounts/:accountId/analysis bounces to the new Account
// Overview where the user picks a client.
function AnalysisRedirectToOverview() {
  const { accountId } = useParams<{ accountId: string }>()
  return <Navigate to={`/accounts/${accountId}?from=legacy-analysis`} replace />
}

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
       <ToastProvider>
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
          <Route
            path="/accounts/:accountId/analysis"
            element={<AuthGuard><AnalysisRedirectToOverview /></AuthGuard>}
          />
          <Route
            path="/accounts/:accountId/clients/:clientId/analysis"
            element={<AuthGuard><AccountAnalysisPage /></AuthGuard>}
          />
          <Route
            path="/accounts/:accountId/clients/:clientId/admin/constraint-templates"
            element={<AuthGuard><ConstraintTemplatesPage /></AuthGuard>}
          />
          <Route
            path="/accounts/:accountId/clients/:clientId/admin/audit-log"
            element={<AuthGuard><AuditLogPage /></AuthGuard>}
          />
          <Route
            path="/accounts/:accountId/clients/:clientId/admin/properties"
            element={<AuthGuard><PropertiesAdminPage /></AuthGuard>}
          />
          <Route
            path="/accounts/:accountId/clients/:clientId/scheduler"
            element={<AuthGuard><SchedulerPage /></AuthGuard>}
          />
          <Route
            path="/accounts/:accountId/clients/:clientId/admin/service-offerings"
            element={<AuthGuard><ServiceOfferingsPage /></AuthGuard>}
          />
          <Route
            path="/accounts/:accountId/clients/:clientId/scheduler/templates"
            element={<AuthGuard><TemplatesListPage /></AuthGuard>}
          />
          <Route
            path="/accounts/:accountId/clients/:clientId/scheduler/templates/new"
            element={<AuthGuard><NewTemplatePage /></AuthGuard>}
          />
          <Route
            path="/accounts/:accountId/clients/:clientId/scheduler/templates/:templateId"
            element={<AuthGuard><TemplateDetailPage /></AuthGuard>}
          />
          <Route
            path="/accounts/:accountId/clients/:clientId/scheduler/cycles/:cycleId"
            element={<AuthGuard><CycleDetailPage /></AuthGuard>}
          />
          <Route
            path="/accounts/:accountId/clients/:clientId/scheduler/compare"
            element={<AuthGuard><CycleComparePage /></AuthGuard>}
          />
          <Route
            path="/accounts/:accountId/combined-schedules"
            element={<AuthGuard><CombinedSchedulesPage /></AuthGuard>}
          />
          <Route
            path="/accounts/:accountId/clients/:clientId/travel"
            element={<AuthGuard><TravelPlannerPage /></AuthGuard>}
          />
          <Route
            path="/accounts/:accountId/clients/:clientId/admin/custom-fields"
            element={<AuthGuard><CustomFieldsAdminPage /></AuthGuard>}
          />
          <Route path="/accounts/:id/clients/new" element={<AuthGuard><NewAccountClientPage /></AuthGuard>} />
          <Route path="/accounts/:id/clients/new-combined" element={<AuthGuard><NewCombinedClientPage /></AuthGuard>} />

          {/* Clients */}
          <Route path="/clients" element={<AuthGuard><ClientsListPage /></AuthGuard>} />
          <Route path="/clients/new" element={<AuthGuard><NewClientPage /></AuthGuard>} />
          <Route path="/clients/:id" element={<AuthGuard><ClientDetailPage /></AuthGuard>} />
          <Route path="/clients/:id/setup" element={<AuthGuard><ClientSetupPage /></AuthGuard>} />

          {/* Admin */}
          <Route path="/admin" element={<AuthGuard><AdminGuard><AdminHubPage /></AdminGuard></AuthGuard>} />
          <Route path="/admin/bootstrap" element={<AuthGuard><AdminBootstrapPage /></AuthGuard>} />
          <Route path="/admin/users" element={<AuthGuard><AdminGuard><AdminUsersPage /></AdminGuard></AuthGuard>} />
          <Route path="/admin/dangerous" element={<AuthGuard><AdminGuard><DangerousAdminPage /></AdminGuard></AuthGuard>} />
          <Route path="/admin/uploads" element={<AuthGuard><AdminGuard><AdminUploadsPage /></AdminGuard></AuthGuard>} />
          <Route path="/admin/parcels/import" element={<AuthGuard><AdminGuard><ParcelImportPage /></AdminGuard></AuthGuard>} />
          <Route path="/admin/parcels/counties" element={<AuthGuard><AdminGuard><CountiesPage /></AdminGuard></AuthGuard>} />
          <Route path="/admin/parcels/fallbacks" element={<AuthGuard><AdminGuard><FallbacksPage /></AdminGuard></AuthGuard>} />
          <Route path="/invite/:token" element={<InviteAcceptPage />} />
          <Route path="/auth/callback" element={<AuthCallbackPage />} />

          {/* Design system reference (Phase B). Public for now — no AuthGuard
              so designers can hit the URL directly during review. */}
          <Route path="/design-system" element={<DesignSystemPage />} />
        </Routes>
       </ToastProvider>
      </ClientProvider>
    </BrowserRouter>
    </ErrorBoundary>
  )
}
