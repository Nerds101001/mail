import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { CRMProvider, useCRM } from './store'
import Layout from './components/Layout'
import { ToastContainer } from './components/ui'
import Login    from './pages/Login'
import Dashboard from './pages/Dashboard'
import Leads    from './pages/Leads'
import Pipeline from './pages/Pipeline'
import Campaign from './pages/Campaign'
import Clients  from './pages/Clients'
import Deals    from './pages/Deals'
import Tracking from './pages/Tracking'
import Tasks    from './pages/Tasks'
import Settings from './pages/Settings'

function ProtectedApp() {
  const { loadFromRedis, checkGmailStatus } = useCRM()
  const [taskCount, setTaskCount] = useState(0)

  useEffect(() => {
    loadFromRedis()
    checkGmailStatus()
    // Load task count for badge
    fetch('/api/tasks').then(r => r.json()).then(d => setTaskCount(d.tasks?.length || 0)).catch(() => {})
  }, [])

  return (
    <Layout taskCount={taskCount}>
      <Routes>
        <Route path="/"         element={<Dashboard />} />
        <Route path="/tasks"    element={<Tasks />} />
        <Route path="/leads"    element={<Leads />} />
        <Route path="/pipeline" element={<Pipeline />} />
        <Route path="/campaign" element={<Campaign />} />
        <Route path="/clients"  element={<Clients />} />
        <Route path="/deals"    element={<Deals />} />
        <Route path="/tracking" element={<Tracking />} />
        <Route path="/settings" element={<Settings />} />
      </Routes>
    </Layout>
  )
}

function AuthGuard() {
  const [checked, setChecked] = useState(false)
  const [authed, setAuthed]   = useState(false)

  useEffect(() => {
    const token = localStorage.getItem('crm_token')
    if (!token) { setChecked(true); return }
    fetch(`/api/auth?token=${token}`)
      .then(r => r.json())
      .then(d => { setAuthed(d.ok); setChecked(true) })
      .catch(() => { setAuthed(true); setChecked(true) }) // allow if API unreachable
  }, [])

  if (!checked) return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50">
      <div className="flex flex-col items-center gap-3">
        <div className="w-10 h-10 bg-emerald-500 rounded-xl flex items-center justify-center animate-pulse">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="white"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>
        </div>
        <p className="text-sm text-slate-400">Loading...</p>
      </div>
    </div>
  )

  return authed ? <ProtectedApp /> : <Navigate to="/login" replace />
}

export default function App() {
  return (
    <CRMProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/*"     element={<AuthGuard />} />
        </Routes>
        <ToastContainer />
      </BrowserRouter>
    </CRMProvider>
  )
}
