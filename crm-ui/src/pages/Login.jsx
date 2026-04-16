import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Zap } from 'lucide-react'

export default function Login() {
  const [pin, setPin]       = useState('')
  const [error, setError]   = useState('')
  const [loading, setLoading] = useState(false)
  const navigate = useNavigate()

  async function doLogin(e) {
    e.preventDefault()
    if (!pin.trim()) { setError('Enter your PIN'); return }
    setLoading(true); setError('')
    try {
      const res = await fetch('/api/auth', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ pin: pin.trim() }) })
      const data = await res.json()
      if (data.ok) {
        localStorage.setItem('crm_token', data.token)
        navigate('/')
      } else {
        setError('Invalid PIN. Please try again.')
        setPin('')
      }
    } catch(e) {
      setError('Connection error. Is the server running?')
    }
    setLoading(false)
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-emerald-50 flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 bg-emerald-500 rounded-2xl shadow-lg shadow-emerald-200 mb-4">
            <Zap size={28} className="text-white" />
          </div>
          <h1 className="text-2xl font-bold text-slate-900">Enginerds CRM</h1>
          <p className="text-sm text-slate-500 mt-1">Business Operating System</p>
        </div>

        {/* Card */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-xl shadow-slate-100 p-8">
          <h2 className="text-base font-bold text-slate-800 mb-1">Team Access</h2>
          <p className="text-sm text-slate-400 mb-6">Enter your team PIN to continue</p>

          <form onSubmit={doLogin} className="space-y-4">
            <div>
              <label className="label">Team PIN</label>
              <input
                className="input text-center text-xl tracking-[0.5em] font-mono"
                type="password"
                value={pin}
                onChange={e => setPin(e.target.value)}
                placeholder="••••••••"
                autoFocus
              />
            </div>

            {error && (
              <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full btn-primary justify-center py-3 text-base"
            >
              {loading ? (
                <svg className="animate-spin w-5 h-5" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                </svg>
              ) : 'Login →'}
            </button>
          </form>
        </div>

        <p className="text-center text-xs text-slate-400 mt-6">
          Enginerds Tech Solution · Internal CRM
        </p>
      </div>
    </div>
  )
}
