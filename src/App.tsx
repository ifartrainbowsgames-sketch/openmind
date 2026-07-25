import { lazy, Suspense } from 'react'
import { Routes, Route, Navigate } from 'react-router'
import { Loader2 } from 'lucide-react'
import { LenisProvider } from './components/fx'
import ErrorBoundary from './components/ErrorBoundary'

// route-level code splitting — each page ships as its own chunk
const Home = lazy(() => import('./pages/Home'))
const Dashboard = lazy(() => import('./pages/Dashboard'))
const Login = lazy(() => import('./pages/Login'))
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
            <Route path="/employees" element={<Navigate to="/dashboard?view=automations" replace />} />
            <Route path="/widget" element={<WidgetEmbed />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
      </LenisProvider>
    </ErrorBoundary>
  )
}
