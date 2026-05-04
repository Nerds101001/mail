export const isValidEmail = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)

export const enrichLead = (l) => {
  if (!l.email) return l
  const e = l.email.toLowerCase().trim()
  const [user, domain] = e.split('@')
  l.domain = domain || ''
  if (!l.pipelineStage) l.pipelineStage = 'COLD'

  const typos = { 'gmial.com':'gmail.com','gmal.com':'gmail.com','gnail.com':'gmail.com' }
  if (typos[domain]) l.status = 'TYPO'
  const disposable = ['mailinator.com','10minutemail.com','temp-mail.org','guerrillamail.com']
  if (disposable.includes(domain)) l.status = 'DISPOSABLE'
  // Tag personal/role-based for info only — still set to VALID so campaign sends to them
  const personal = ['gmail.com','yahoo.com','outlook.com','hotmail.com','icloud.com','aol.com','live.com']
  if (personal.includes(domain) && !['DISPOSABLE','TYPO'].includes(l.status)) l.emailType = 'PERSONAL'
  const roles = ['info','admin','support','sales','contact','hr','office','hello','marketing','team','jobs','billing']
  if (roles.includes(user) && !['DISPOSABLE','TYPO'].includes(l.status)) l.emailType = l.emailType || 'ROLE-BASED'
  // Only block truly invalid emails — personal and role-based are sendable
  if (!['SENT','REPLIED','FOLLOW-UP','INVALID','DUPLICATE','DISPOSABLE','TYPO','INVALID-LENGTH','UNSUBSCRIBED'].includes(l.status)) l.status = 'VALID'

  // Don't auto-fill company from domain - keep it blank if not provided
  // if (!l.company && domain) l.company = (domain.split('.')[0] || '').toUpperCase()
  
  if (!l.role) {
    if (e.includes('ceo') || e.includes('founder') || e.includes('owner')) l.role = 'FOUNDER'
    else if (e.includes('sales')) l.role = 'SALES'
    else if (e.includes('cto') || e.includes('tech')) l.role = 'CTO'
    else l.role = 'GENERAL'
  }
  l.priority = l.role === 'FOUNDER' ? 'HIGH' : (l.role === 'SALES' || l.role === 'CTO') ? 'MEDIUM' : 'LOW'
  l.score = l.role === 'FOUNDER' ? 90 : l.role === 'CTO' ? 75 : l.role === 'SALES' ? 70 : 40
  return l
}

export const PIPELINE_STAGES = ['COLD','CONTACTED','OPENED','HOT','DEMO','QUOTED','WON','LOST','UNSUBSCRIBED','NOT-INTERESTED']

export const STAGE_COLORS = {
  COLD:     { bg: 'bg-slate-100',   text: 'text-slate-600',   dot: '#94a3b8' },
  CONTACTED:{ bg: 'bg-blue-100',    text: 'text-blue-700',    dot: '#3b82f6' },
  OPENED:   { bg: 'bg-amber-100',   text: 'text-amber-700',   dot: '#f59e0b' },
  HOT:      { bg: 'bg-red-100',     text: 'text-red-700',     dot: '#ef4444' },
  DEMO:     { bg: 'bg-purple-100',  text: 'text-purple-700',  dot: '#8b5cf6' },
  QUOTED:   { bg: 'bg-indigo-100',  text: 'text-indigo-700',  dot: '#6366f1' },
  WON:      { bg: 'bg-emerald-100', text: 'text-emerald-700', dot: '#10b981' },
  LOST:     { bg: 'bg-red-100',     text: 'text-red-600',     dot: '#ef4444' },
  UNSUBSCRIBED: { bg: 'bg-slate-100', text: 'text-slate-500', dot: '#94a3b8' },
  'NOT-INTERESTED': { bg: 'bg-slate-100', text: 'text-slate-500', dot: '#94a3b8' },
}

export const STATUS_COLORS = {
  VALID:       'bg-emerald-100 text-emerald-700',
  SENT:        'bg-blue-100 text-blue-700',
  REPLIED:     'bg-emerald-200 text-emerald-800',
  'FOLLOW-UP': 'bg-amber-100 text-amber-700',
  INVALID:     'bg-red-100 text-red-700',
  DUPLICATE:   'bg-orange-100 text-orange-700',
  PERSONAL:    'bg-slate-100 text-slate-600',
  'ROLE-BASED':'bg-blue-100 text-blue-600',
  DISPOSABLE:  'bg-red-100 text-red-600',
  TYPO:        'bg-amber-100 text-amber-600',
  UNSUBSCRIBED:'bg-slate-100 text-slate-500',
}

export const PAYMENT_COLORS = {
  PAID:    'bg-emerald-100 text-emerald-700',
  PENDING: 'bg-amber-100 text-amber-700',
  OVERDUE: 'bg-red-100 text-red-700',
}

export const daysDiff  = (d) => d ? Math.ceil((new Date(d) - Date.now()) / 86400000) : null
export const daysSince = (d) => d ? Math.floor((Date.now() - new Date(d)) / 86400000) : null

export const fmtCurrency = (n) => `₹${(parseFloat(n)||0).toLocaleString('en-IN')}`
export const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-IN', { day:'2-digit', month:'short', year:'numeric' }) : '—'
