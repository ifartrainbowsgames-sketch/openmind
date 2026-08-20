import { lazy, Suspense } from 'react'
import { Routes, Route, Navigate } from 'react-router'
import { Loader2 } from 'lucide-react'
import { LenisProvider } from './components/fx'
import ErrorBoundary from './components/ErrorBoundary'

// route-level code splitting — each page ships as its own chunk
const Home = lazy(() => import('./pages/Home'))
const Dashboard = lazy(() => import('./pages/Dashboard'))
const Login = lazy(() => import('./pages/Login'))
const Employees = lazy(() => import('./pages/Employees'))
const MobileApp = lazy(() => import('./pages/MobileApp'))
const Settings = lazy(() => import('./pages/Settings'))
const WidgetEmbed = lazy(() => import('./pages/WidgetEmbed'))

function PageLoader() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <Loader2 className="h-6 w-6 animate-spin text-accent" />
    </div>
  )
}

export default function App() {
  return (
    <ErrorBoundary>
      <a href="#main-content" className="skip-link">Skip to main content</a>
      <LenisProvider>
        <Suspense fallback={<PageLoader />}>
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/login" element={<Login />} />
            <Route path="/dashboard" element={<Dashboard />} />
            {/* Employees.tsx still exists here, so it keeps its own route
                rather than redirecting to the dashboard as the backend branch
                did after removing the page. */}
            <Route path="/employees" element={<Employees />} />
            <Route path="/app" element={<MobileApp />} />
            <Route path="/widget" element={<WidgetEmbed />} />
            {/* Redirect keeps a bare /settings link working. */}
            <Route path="/settings" element={<Navigate to="/settings/general" replace />} />
            <Route path="/settings/:section" element={<Settings />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
      </LenisProvider>
    </ErrorBoundary>
  )
}
