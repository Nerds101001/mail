import { X, AlertCircle, CheckCircle2, Info, AlertTriangle } from 'lucide-react'
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
    success:   'btn-success',
  }[variant] || 'btn-secondary'
  const sz = size === 'sm' ? 'text-xs !px-3 !py-1.5' : size === 'lg' ? 'text-base !px-5 !py-3' : ''
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
        <div className="flex items-center justify-between px-6 py-5 border-b border-slate-100">
          <h2 className="text-base font-bold text-slate-900 tracking-tight">{title}</h2>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
          >
            <X size={16} />
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
export function StatCard({ label, value, sub, icon: Icon, color = 'indigo', onClick }) {
  const palette = {
    indigo:  { bg: 'bg-indigo-50',  icon: 'text-indigo-600',  val: 'text-indigo-600',  accent: 'bg-indigo-500' },
    blue:    { bg: 'bg-blue-50',    icon: 'text-blue-600',    val: 'text-blue-600',    accent: 'bg-blue-500' },
    emerald: { bg: 'bg-emerald-50', icon: 'text-emerald-600', val: 'text-emerald-600', accent: 'bg-emerald-500' },
    amber:   { bg: 'bg-amber-50',   icon: 'text-amber-600',   val: 'text-amber-600',   accent: 'bg-amber-500' },
    red:     { bg: 'bg-red-50',     icon: 'text-red-600',     val: 'text-red-600',     accent: 'bg-red-500' },
    purple:  { bg: 'bg-purple-50',  icon: 'text-purple-600',  val: 'text-purple-600',  accent: 'bg-purple-500' },
    slate:   { bg: 'bg-slate-100',  icon: 'text-slate-600',   val: 'text-slate-700',   accent: 'bg-slate-500' },
    violet:  { bg: 'bg-violet-50',  icon: 'text-violet-600',  val: 'text-violet-600',  accent: 'bg-violet-500' },
  }
  const c = palette[color] || palette.indigo
  return (
    <div className="stat-card group" onClick={onClick}>
      <div className="flex items-start justify-between mb-2 sm:mb-4">
        <p className="text-[10px] sm:text-xs font-semibold text-slate-500 uppercase tracking-wider">{label}</p>
        {Icon && (
          <div className={`w-7 h-7 sm:w-9 sm:h-9 rounded-xl flex items-center justify-center ${c.bg} group-hover:scale-110 transition-transform duration-200`}>
            <Icon size={14} className={c.icon} />
          </div>
        )}
      </div>
      <p className={`text-2xl sm:text-3xl font-bold tracking-tight mb-0.5 sm:mb-1 ${c.val}`}>{value ?? '—'}</p>
      {sub && <p className="text-[10px] sm:text-xs text-slate-400 font-medium">{sub}</p>}
    </div>
  )
}

// ── Spinner ───────────────────────────────────────────────────────────────────
export function Spinner({ size = 18 }) {
  return (
    <svg className="animate-spin text-indigo-500" width={size} height={size} viewBox="0 0 24 24" fill="none">
      <circle className="opacity-20" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3"/>
      <path className="opacity-80" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
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
  const config = {
    success: { icon: CheckCircle2,  bg: 'bg-emerald-600', border: 'border-emerald-500' },
    error:   { icon: AlertCircle,   bg: 'bg-red-600',     border: 'border-red-500' },
    warn:    { icon: AlertTriangle, bg: 'bg-amber-500',   border: 'border-amber-400' },
    info:    { icon: Info,          bg: 'bg-indigo-600',  border: 'border-indigo-500' },
  }
  return (
    <div className="fixed bottom-20 lg:bottom-6 right-3 left-3 lg:left-auto lg:right-6 z-[9999] flex flex-col gap-2 pointer-events-none" style={{ maxWidth: '360px', marginLeft: 'auto' }}>
      {toasts.map(t => {
        const { icon: Icon, bg, border } = config[t.type] || config.info
        return (
          <div key={t.id} className={`flex items-center gap-3 px-4 py-3 rounded-xl text-white text-sm font-medium shadow-2xl max-w-xs ${bg} border-l-4 ${border} pointer-events-auto`}
               style={{ animation: 'slideIn 0.2s ease' }}>
            <Icon size={16} className="shrink-0 opacity-90" />
            <span>{t.msg}</span>
          </div>
        )
      })}
    </div>
  )
}

// ── Empty State ───────────────────────────────────────────────────────────────
export function Empty({ icon: Icon, title, sub }) {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      {Icon && (
        <div className="w-16 h-16 bg-slate-100 rounded-2xl flex items-center justify-center mb-4">
          <Icon size={28} className="text-slate-400" />
        </div>
      )}
      <p className="text-sm font-semibold text-slate-700 mb-1">{title}</p>
      {sub && <p className="text-xs text-slate-400 max-w-xs">{sub}</p>}
    </div>
  )
}

// ── Page Header ───────────────────────────────────────────────────────────────
export function PageHeader({ title, subtitle, children }) {
  return (
    <div className="flex flex-wrap items-start sm:items-center justify-between gap-3 mb-4 sm:mb-6">
      <div className="min-w-0">
        <h1 className="text-lg sm:text-xl font-bold text-slate-900 tracking-tight">{title}</h1>
        {subtitle && <p className="text-xs sm:text-sm text-slate-500 mt-0.5">{subtitle}</p>}
      </div>
      {children && <div className="flex items-center gap-2 flex-wrap">{children}</div>}
    </div>
  )
}

// ── Section Header ─────────────────────────────────────────────────────────────
export function SectionHeader({ title, children }) {
  return (
    <div className="flex items-center justify-between mb-4">
      <h3 className="text-sm font-bold text-slate-800">{title}</h3>
      {children && <div className="flex items-center gap-2">{children}</div>}
    </div>
  )
}
