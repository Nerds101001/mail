import { X } from 'lucide-react'
import { useState } from 'react'

// ── Badge ─────────────────────────────────────────────────────────────────────
export function Badge({ children, className = '' }) {
  return <span className={`badge ${className}`}>{children}</span>
}

// ── Button ────────────────────────────────────────────────────────────────────
export function Btn({ children, variant = 'primary', size = 'md', className = '', ...props }) {
  const base = {
    primary:   'btn-primary',
    secondary: 'btn-secondary',
    danger:    'btn-danger',
    ghost:     'btn-ghost',
  }[variant]
  const sz = size === 'sm' ? 'text-xs px-3 py-1.5' : ''
  return <button className={`${base} ${sz} ${className}`} {...props}>{children}</button>
}

// ── Input ─────────────────────────────────────────────────────────────────────
export function Input({ label, ...props }) {
  return (
    <div>
      {label && <label className="label">{label}</label>}
      <input className="input" {...props} />
    </div>
  )
}

export function Select({ label, children, ...props }) {
  return (
    <div>
      {label && <label className="label">{label}</label>}
      <select className="input" {...props}>{children}</select>
    </div>
  )
}

export function Textarea({ label, ...props }) {
  return (
    <div>
      {label && <label className="label">{label}</label>}
      <textarea className="input resize-y min-h-[80px]" {...props} />
    </div>
  )
}

// ── Modal ─────────────────────────────────────────────────────────────────────
export function Modal({ open, onClose, title, children, width = 'max-w-lg' }) {
  if (!open) return null
  return (
    <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${width}`}>
        <div className="flex items-center justify-between p-6 border-b border-slate-100">
          <h2 className="text-base font-bold text-slate-900 tracking-tight">{title}</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors">
            <X size={18} />
          </button>
        </div>
        <div className="p-6">{children}</div>
      </div>
    </div>
  )
}

// ── Card ──────────────────────────────────────────────────────────────────────
export function Card({ children, className = '', hover = false, onClick }) {
  return (
    <div className={`${hover ? 'card-hover' : 'card'} ${className}`} onClick={onClick}>
      {children}
    </div>
  )
}

// ── Stat Card ─────────────────────────────────────────────────────────────────
export function StatCard({ label, value, sub, icon: Icon, color = 'emerald', onClick }) {
  const colors = {
    emerald: { bg: 'bg-emerald-50', text: 'text-emerald-600', val: 'text-emerald-600', border: 'border-emerald-200' },
    blue:    { bg: 'bg-blue-50',    text: 'text-blue-600',    val: 'text-blue-600',    border: 'border-blue-200' },
    amber:   { bg: 'bg-amber-50',   text: 'text-amber-600',   val: 'text-amber-600',   border: 'border-amber-200' },
    red:     { bg: 'bg-red-50',     text: 'text-red-600',     val: 'text-red-600',     border: 'border-red-200' },
    purple:  { bg: 'bg-purple-50',  text: 'text-purple-600',  val: 'text-purple-600',  border: 'border-purple-200' },
    slate:   { bg: 'bg-slate-50',   text: 'text-slate-600',   val: 'text-slate-700',   border: 'border-slate-200' },
  }[color]
  return (
    <div className={`stat-card border ${colors.border} hover:border-${color}-300`} onClick={onClick}>
      <div className="flex items-start justify-between mb-3">
        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">{label}</p>
        {Icon && <div className={`p-2 rounded-lg ${colors.bg}`}><Icon size={16} className={colors.text} /></div>}
      </div>
      <p className={`text-3xl font-bold ${colors.val} mb-1`}>{value}</p>
      {sub && <p className="text-xs text-slate-400">{sub}</p>}
    </div>
  )
}

// ── Spinner ───────────────────────────────────────────────────────────────────
export function Spinner({ size = 16 }) {
  return (
    <svg className="animate-spin" width={size} height={size} viewBox="0 0 24 24" fill="none">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
    </svg>
  )
}

// ── Toast ─────────────────────────────────────────────────────────────────────
let toastFn = null
export function setToastFn(fn) { toastFn = fn }
export function toast(msg, type = 'info') { toastFn?.(msg, type) }

export function ToastContainer() {
  const [toasts, setToasts] = useState([])
  setToastFn((msg, type) => {
    const id = Date.now()
    setToasts(p => [...p, { id, msg, type }])
    setTimeout(() => setToasts(p => p.filter(t => t.id !== id)), 3500)
  })
  const colors = { success: 'border-l-emerald-500 bg-emerald-50', error: 'border-l-red-500 bg-red-50', info: 'border-l-blue-500 bg-blue-50', warn: 'border-l-amber-500 bg-amber-50' }
  const textColors = { success: 'text-emerald-800', error: 'text-red-800', info: 'text-blue-800', warn: 'text-amber-800' }
  return (
    <div className="fixed bottom-6 right-6 z-[9999] flex flex-col gap-2">
      {toasts.map(t => (
        <div key={t.id} className={`border-l-4 rounded-lg px-4 py-3 shadow-lg text-sm font-medium max-w-xs animate-in slide-in-from-right ${colors[t.type]} ${textColors[t.type]}`}>
          {t.msg}
        </div>
      ))}
    </div>
  )
}

// ── Empty State ───────────────────────────────────────────────────────────────
export function Empty({ icon: Icon, title, sub }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      {Icon && <div className="p-4 bg-slate-100 rounded-2xl mb-4"><Icon size={32} className="text-slate-400" /></div>}
      <p className="text-sm font-semibold text-slate-600 mb-1">{title}</p>
      {sub && <p className="text-xs text-slate-400">{sub}</p>}
    </div>
  )
}

// ── Page Header ───────────────────────────────────────────────────────────────
export function PageHeader({ title, subtitle, children }) {
  return (
    <div className="flex items-center justify-between mb-6">
      <div>
        <h1 className="text-xl font-bold text-slate-900">{title}</h1>
        {subtitle && <p className="text-sm text-slate-500 mt-0.5">{subtitle}</p>}
      </div>
      {children && <div className="flex items-center gap-2">{children}</div>}
    </div>
  )
}
