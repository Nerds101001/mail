import { Component } from 'react'

// Catches errors thrown while React renders/commits its children. Without one, a
// single uncaught error unmounts the WHOLE app and the user sees a blank page.
//
//   <ErrorBoundary scope="page" resetKey={pathname}>  → sidebar stays, only the page is replaced;
//                                                       navigating to another page resets it
//   <ErrorBoundary scope="app">                        → last resort, full-screen message
//
// The exact exception is shown (so it can be copied) and sent to the server
// (/api/ops?type=client-error → pm2 logs) so a "blank page" report can be traced.

function report(error, info, scope) {
  try {
    const token = localStorage.getItem('crm_token') || ''
    if (!token) return
    fetch('/api/ops?type=client-error', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        scope,
        url: window.location.pathname + window.location.search,
        message: String(error?.message || error).slice(0, 500),
        stack: String(error?.stack || '').slice(0, 3000),
        componentStack: String(info?.componentStack || '').slice(0, 1500),
        viewport: `${window.innerWidth}x${window.innerHeight}`,
      }),
      keepalive: true,
    }).catch(() => {})
  } catch { /* reporting must never throw */ }
}

export default class ErrorBoundary extends Component {
  state = { error: null }

  static getDerivedStateFromError(error) { return { error } }

  componentDidCatch(error, info) {
    console.error('[ErrorBoundary]', error, info?.componentStack)
    report(error, info, this.props.scope || 'page')
  }

  componentDidUpdate(prev) {
    // Moving to another page clears the error.
    if (this.state.error && prev.resetKey !== this.props.resetKey) this.setState({ error: null })
  }

  render() {
    const { error } = this.state
    if (!error) return this.props.children

    const full = this.props.scope === 'app'
    return (
      <div className={full ? 'min-h-screen flex items-center justify-center p-6 bg-slate-100' : 'p-6'}>
        <div className="max-w-xl mx-auto bg-white border border-red-200 rounded-2xl shadow-sm p-6">
          <h2 className="text-base font-bold text-slate-900">Something went wrong on this page</h2>
          <p className="text-sm text-slate-500 mt-1">
            Your data is safe. Only what you were typing on this page is lost. The error has been recorded.
          </p>
          <pre className="mt-3 text-[11px] leading-snug text-red-700 bg-red-50 border border-red-100 rounded-lg p-3 whitespace-pre-wrap break-words max-h-40 overflow-auto">
            {String(error?.message || error)}
          </pre>
          <p className="text-xs text-slate-400 mt-3">
            If it keeps happening, try a private window (it disables browser extensions) and send this message to support.
          </p>
          <div className="flex gap-2 mt-4">
            <button className="btn-primary" onClick={() => this.setState({ error: null })}>Try again</button>
            <button className="btn-secondary" onClick={() => window.location.reload()}>Reload page</button>
          </div>
        </div>
      </div>
    )
  }
}
