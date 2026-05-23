import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Eye, EyeOff, Lock, User, ArrowRight, Shield, Zap, BarChart3, Users } from 'lucide-react'

const FEATURES = [
  { icon: Zap,        text: 'AI-powered email campaigns' },
  { icon: BarChart3,  text: 'Real-time tracking & analytics' },
  { icon: Users,      text: 'Multi-user team collaboration' },
  { icon: Shield,     text: 'Enterprise-grade security' },
]

export default function Login() {
  const [username,    setUsername]    = useState('')
  const [password,    setPassword]    = useState('')
  const [showPass,    setShowPass]    = useState(false)
  const [error,       setError]       = useState('')
  const [loading,     setLoading]     = useState(false)
  const [focusedField, setFocused]    = useState(null)
  const navigate = useNavigate()

  async function doLogin(e) {
    e.preventDefault()
    if (!username.trim() || !password) return
    setLoading(true); setError('')
    try {
      const res  = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: username.trim(), password }),
      })
      const data = await res.json()
      if (data.ok) {
        const keysToKeep = new Set(['crm_token','crm_userId','crm_role','crm_userName','crm_viewAs'])
        Object.keys(localStorage).filter(k => k.startsWith('crm_') && !keysToKeep.has(k)).forEach(k => localStorage.removeItem(k))
        localStorage.removeItem('crm_viewAs')
        localStorage.setItem('crm_token',    data.token)
        localStorage.setItem('crm_userId',   data.userId || 'admin')
        localStorage.setItem('crm_role',     data.role   || 'admin')
        localStorage.setItem('crm_userName', data.name   || username)
        navigate('/')
      } else {
        setError(data.error || 'Invalid credentials. Please try again.')
        setPassword('')
      }
    } catch {
      setError('Unable to connect. Please check your network.')
    }
    setLoading(false)
  }

  return (
    <div className="min-h-screen flex">
      {/* ── Left panel ─────────────────────────────────────────────── */}
      <div className="hidden lg:flex lg:w-[58%] relative overflow-hidden flex-col"
           style={{ background: 'linear-gradient(135deg, #0f172a 0%, #1e1b4b 40%, #0f172a 100%)' }}>

        {/* Geometric background blobs */}
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <div className="absolute -top-40 -left-40 w-96 h-96 rounded-full opacity-20"
               style={{ background: 'radial-gradient(circle, #6366f1 0%, transparent 70%)' }} />
          <div className="absolute top-1/2 -right-32 w-80 h-80 rounded-full opacity-15"
               style={{ background: 'radial-gradient(circle, #8b5cf6 0%, transparent 70%)' }} />
          <div className="absolute -bottom-20 left-1/3 w-72 h-72 rounded-full opacity-10"
               style={{ background: 'radial-gradient(circle, #06b6d4 0%, transparent 70%)' }} />
          {/* Grid pattern */}
          <svg className="absolute inset-0 w-full h-full opacity-[0.04]" xmlns="http://www.w3.org/2000/svg">
            <defs>
              <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
                <path d="M 40 0 L 0 0 0 40" fill="none" stroke="white" strokeWidth="0.5"/>
              </pattern>
            </defs>
            <rect width="100%" height="100%" fill="url(#grid)" />
          </svg>
        </div>

        {/* Content */}
        <div className="relative z-10 flex flex-col h-full px-16 py-14">

          {/* Logo */}
          <div className="flex items-center gap-3 mb-auto">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center"
                 style={{ background: 'linear-gradient(135deg, #6366f1, #8b5cf6)' }}>
              <Zap size={20} className="text-white" />
            </div>
            <span className="text-white font-bold text-xl tracking-tight">EnginErds</span>
            <span className="text-xs font-semibold px-2 py-0.5 rounded-full border border-indigo-400/40 text-indigo-300"
                  style={{ letterSpacing: '0.12em' }}>CRM</span>
          </div>

          {/* Hero text */}
          <div className="mb-auto">
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-indigo-400/30 bg-indigo-500/10 mb-6">
              <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              <span className="text-indigo-300 text-xs font-medium tracking-wide">ENTERPRISE PLATFORM</span>
            </div>

            <h1 className="text-5xl font-extrabold text-white leading-tight mb-4"
                style={{ letterSpacing: '-0.02em' }}>
              Sales Intelligence<br />
              <span style={{ background: 'linear-gradient(90deg, #818cf8, #c084fc)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
                at Scale
              </span>
            </h1>
            <p className="text-slate-400 text-lg leading-relaxed max-w-md">
              Manage leads, automate outreach, and close deals faster with AI-driven insights.
            </p>
          </div>

          {/* Feature list */}
          <div className="grid grid-cols-2 gap-3 mb-12">
            {FEATURES.map(({ icon: Icon, text }) => (
              <div key={text} className="flex items-center gap-3 px-4 py-3 rounded-xl border border-white/8"
                   style={{ background: 'rgba(255,255,255,0.04)' }}>
                <div className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0"
                     style={{ background: 'linear-gradient(135deg, #6366f1, #8b5cf6)' }}>
                  <Icon size={14} className="text-white" />
                </div>
                <span className="text-slate-300 text-xs font-medium leading-snug">{text}</span>
              </div>
            ))}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between">
            <p className="text-slate-600 text-xs">© 2025 EnginErds Tech Solution</p>
            <div className="flex items-center gap-1.5 text-slate-600 text-xs">
              <Shield size={11} />
              <span>256-bit SSL Encrypted</span>
            </div>
          </div>
        </div>
      </div>

      {/* ── Right panel ────────────────────────────────────────────── */}
      <div className="flex-1 flex items-center justify-center p-8"
           style={{ background: '#f8fafc' }}>
        <div className="w-full max-w-md">

          {/* Mobile logo */}
          <div className="flex items-center gap-2 mb-10 lg:hidden">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center"
                 style={{ background: 'linear-gradient(135deg, #6366f1, #8b5cf6)' }}>
              <Zap size={16} className="text-white" />
            </div>
            <span className="font-bold text-slate-900">EnginErds CRM</span>
          </div>

          {/* Header */}
          <div className="mb-10">
            <h2 className="text-3xl font-bold text-slate-900 mb-2" style={{ letterSpacing: '-0.02em' }}>
              Welcome back
            </h2>
            <p className="text-slate-500 text-sm">Sign in to your workspace to continue.</p>
          </div>

          {/* Form */}
          <form onSubmit={doLogin} className="space-y-5">

            {/* Username */}
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-2 tracking-wide uppercase">
                Username
              </label>
              <div className="relative">
                <User size={16} className="absolute left-4 top-1/2 -translate-y-1/2 pointer-events-none transition-colors"
                     style={{ color: focusedField === 'user' ? '#6366f1' : '#94a3b8' }} />
                <input
                  type="text"
                  value={username}
                  onChange={e => setUsername(e.target.value)}
                  onFocus={() => setFocused('user')}
                  onBlur={() => setFocused(null)}
                  placeholder="your.username"
                  autoFocus
                  required
                  style={{
                    width: '100%', paddingLeft: '2.75rem', paddingRight: '1rem',
                    paddingTop: '0.875rem', paddingBottom: '0.875rem',
                    borderRadius: '0.75rem', fontSize: '0.9rem',
                    border: focusedField === 'user' ? '1.5px solid #6366f1' : '1.5px solid #e2e8f0',
                    background: '#fff', outline: 'none', color: '#0f172a',
                    boxShadow: focusedField === 'user' ? '0 0 0 4px rgba(99,102,241,0.08)' : 'none',
                    transition: 'all 0.15s ease',
                  }}
                />
              </div>
            </div>

            {/* Password */}
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-2 tracking-wide uppercase">
                Password
              </label>
              <div className="relative">
                <Lock size={16} className="absolute left-4 top-1/2 -translate-y-1/2 pointer-events-none transition-colors"
                     style={{ color: focusedField === 'pass' ? '#6366f1' : '#94a3b8' }} />
                <input
                  type={showPass ? 'text' : 'password'}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  onFocus={() => setFocused('pass')}
                  onBlur={() => setFocused(null)}
                  placeholder="••••••••••••"
                  required
                  style={{
                    width: '100%', paddingLeft: '2.75rem', paddingRight: '3rem',
                    paddingTop: '0.875rem', paddingBottom: '0.875rem',
                    borderRadius: '0.75rem', fontSize: '0.9rem',
                    border: focusedField === 'pass' ? '1.5px solid #6366f1' : '1.5px solid #e2e8f0',
                    background: '#fff', outline: 'none', color: '#0f172a',
                    boxShadow: focusedField === 'pass' ? '0 0 0 4px rgba(99,102,241,0.08)' : 'none',
                    transition: 'all 0.15s ease',
                  }}
                />
                <button type="button" onClick={() => setShowPass(v => !v)} tabIndex={-1}
                        className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors">
                  {showPass ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>

            {/* Error */}
            {error && (
              <div className="flex items-center gap-2.5 px-4 py-3 rounded-xl text-sm"
                   style={{ background: '#fef2f2', border: '1px solid #fecaca', color: '#b91c1c' }}>
                <div className="w-4 h-4 rounded-full flex items-center justify-center flex-shrink-0"
                     style={{ background: '#fca5a5' }}>
                  <span style={{ fontSize: '10px', fontWeight: 700, color: '#7f1d1d' }}>!</span>
                </div>
                {error}
              </div>
            )}

            {/* Submit */}
            <button
              type="submit"
              disabled={loading || !username.trim() || !password}
              style={{
                width: '100%', padding: '0.9rem 1.5rem',
                borderRadius: '0.75rem', border: 'none', cursor: loading ? 'not-allowed' : 'pointer',
                background: loading || !username.trim() || !password
                  ? '#e2e8f0'
                  : 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)',
                color: loading || !username.trim() || !password ? '#94a3b8' : '#fff',
                fontSize: '0.9rem', fontWeight: 600,
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem',
                transition: 'all 0.2s ease',
                boxShadow: loading || !username.trim() || !password ? 'none' : '0 4px 15px rgba(99,102,241,0.35)',
              }}
            >
              {loading ? (
                <>
                  <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                  </svg>
                  Authenticating…
                </>
              ) : (
                <>Sign In <ArrowRight size={16} /></>
              )}
            </button>
          </form>

          {/* Security notice */}
          <div className="mt-8 flex items-center gap-2 justify-center">
            <Shield size={12} className="text-slate-400" />
            <p className="text-xs text-slate-400 text-center">
              Protected by enterprise-grade encryption. Unauthorized access is prohibited.
            </p>
          </div>

          {/* Bottom brand (mobile) */}
          <p className="text-center text-xs text-slate-400 mt-8 lg:hidden">
            © 2025 EnginErds Tech Solution
          </p>
        </div>
      </div>
    </div>
  )
}
