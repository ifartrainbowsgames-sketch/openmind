import { Component, type ErrorInfo, type ReactNode } from 'react'

interface State {
  error: Error | null
}

export default class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('OpenMind render failure', error, info.componentStack)
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <main className="flex min-h-screen items-center justify-center bg-background p-6">
        <div role="alert" className="max-w-lg border border-primary bg-card p-6 hard-shadow">
          <p className="spec-label">Application error</p>
          <h1 className="mt-2 font-serif-display text-3xl font-semibold">This page could not be rendered.</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            No credentials were logged. Reload the page and retry the last action.
          </p>
          <button
            onClick={() => window.location.reload()}
            className="mt-5 border border-primary bg-primary px-4 py-2 font-mono-spec text-xs uppercase tracking-wider text-primary-foreground"
          >
            Reload
          </button>
        </div>
      </main>
    )
  }
}
