import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Zap } from 'lucide-react'

export default function Login() {
  const [mode, setMode]       = useState('user') // 'user' | 'admin'
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [pin, setPin]         = useState('')
  const [error, setError]     = useState('')
  const [loading, setLoading] = useState(false)
  const navigate = useNavigate()

  async function doLogin(e) {
    e.preventDefault()
    setLoading(true); setError('')
    try {
      const body = mode === 'admin'
        ? { pin: pin.trim() }
        : { username: username.trim(), password }

      const res = await fetch('/api/auth', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      })
      const data = await res.json()
      if (data.ok) {
        localStorage.setItem('crm_token', data.token)
        localStorage.setItem('crm_userId', data.userId || 'admin')
        localStorage.setItem('crm_role', data.role || 'admin')
        localStorage.setItem('crm_userName', data.name || 'Admin')
        navigate('/')
      } else {
        setError(data.error || 'Invalid credentials')
        setPin(''); setPassword('')
      }
    } catch(e) {
      setError('Connection error. Is the server running?')
    }
    setLoading(false)
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-emerald-50 flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 bg-emerald-500 rounded-2xl shadow-lg shadow-emerald-200 mb-4">
            <Zap size={28} className="text-white" />
          </div>
          <h1 className="text-2xl font-bold text-slate-900">Enginerds CRM</h1>
          <p className="text-sm text-slate-500 mt-1">Business Operating System</p>
        </div>

        <div className="bg-white rounded-2xl border border-slate-200 shadow-xl shadow-slate-100 p-8">
          {/* Mode toggle */}
          <div className="flex gap-1 bg-slate-100 rounded-lg p-1 mb-6">
            <button onClick={() => setMode('user')} className={`flex-1 py-2 rounded-md text-sm font-semibold transition-all ${mode==='user' ? 'bg-white shadow-sm text-slate-900' : 'text-slate-500'}`}>
              Team Login
            </button>
            <button onClick={() => setMode('admin')} className={`flex-1 py-2 rounded-md text-sm font-semibold transition-all ${mode==='admin' ? 'bg-white shadow-sm text-emerald-700' : 'text-slate-500'}`}>
              Admin PIN
            </button>
          </div>

          <form onSubmit={doLogin} className="space-y-4">
            {mode === 'user' ? (
              <>
                <div>
                  <label className="label">Username</label>
                  <input className="input" type="text" value={username} onChange={e=>setUsername(e.target.value)} placeholder="your.username" autoFocus />
                </div>
                <div>
                  <label className="label">Password</label>
                  <input className="input" type="password" value={password} onChange={e=>setPassword(e.target.value)} placeholder="••••••••" />
                </div>
              </>
            ) : (
              <div>
                <label className="label">Admin PIN</label>
                <input className="input text-center text-xl tracking-[0.5em] font-mono" type="password" value={pin} onChange={e=>setPin(e.target.value)} placeholder="••••••••" autoFocus />
              </div>
            )}

            {error && <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">{error}</div>}

            <button type="submit" disabled={loading} className="w-full btn-primary justify-center py-3 text-base">
              {loading ? <svg className="animate-spin w-5 h-5" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg> : 'Login →'}
            </button>
          </form>
        </div>
        <p className="text-center text-xs text-slate-400 mt-6">Enginerds Tech Solution · Internal CRM</p>
      </div>
    </div>
  )
}
