import { NavLink, useNavigate } from 'react-router-dom'
import { useCRM } from '../store'
import { useEffect, useRef, useState } from 'react'
import {
  LayoutDashboard, CheckSquare, Users, GitBranch, Send,
  UserCheck, FileText, BarChart2, Settings, LogOut, Zap, Mail, UserX, History, Paperclip,
  Eye, Pause, X as XIcon, ChevronRight, Receipt, Layers,
} from 'lucide-react'
import * as campaignRunner from '../campaignRunner'

const NAV = [
  { label: 'Overview', items: [
    { to: '/',         icon: LayoutDashboard, label: 'Dashboard' },
    { to: '/tasks',    icon: CheckSquare,     label: "Today's Tasks", badge: 'tasks' },
  ]},
  { label: 'Sales', items: [
    { to: '/leads',       icon: Users,       label: 'Leads' },
    { to: '/pipeline',    icon: GitBranch,   label: 'Pipeline' },
    { to: '/campaign',    icon: Send,        label: 'Campaign' },
    { to: '/drip',        icon: Layers,      label: 'Drip Sequences' },
    { to: '/history',     icon: History,     label: 'Cam. History' },
    { to: '/attachments', icon: Paperclip,   label: 'Attachments' },
  ]},
  { label: 'Business', items: [
    { to: '/clients',  icon: UserCheck,   label: 'Clients' },
    { to: '/deals',    icon: FileText,    label: 'Deals' },
    { to: '/invoices', icon: Receipt,     label: 'Invoices' },
  ]},
  { label: 'Analytics', items: [
    { to: '/tracking',     icon: BarChart2, label: 'Tracking' },
    { to: '/unsubscribes', icon: UserX,     label: 'Unsubscribes' },
  ]},
  { label: 'Config', items: [
    { to: '/users',    icon: Users,     label: 'Users',    adminOnly: true },
    { to: '/settings', icon: Settings,  label: 'Settings' },
  ]},
]

export default function Layout({ children, taskCount = 0 }) {
  const { leads, setLeads, saveLeads, clients, gmailStatus, viewAs, setViewAs, loadFromRedis } = useCRM()
  const navigate   = useNavigate()
  const isAdmin    = localStorage.getItem('crm_role') === 'admin'
  const userName   = localStorage.getItem('crm_userName') || 'Admin'
  const userRole   = localStorage.getItem('crm_role') || 'admin'
  const hot        = leads.filter(l => l.pipelineStage === 'HOT' && !['WON','LOST','UNSUBSCRIBED'].includes(l.pipelineStage)).length
  const [userList, setUserList]   = useState([])
  const [runner,   setRunner]     = useState(campaignRunner.getState())
  const [liveAlerts, setLiveAlerts] = useState([])  // floating real-time alerts
  const leadsRef    = useRef(leads)
  const setLeadsRef = useRef(setLeads)
  const saveLeadsRef = useRef(saveLeads)

  // Keep refs in sync so SSE handler always reads latest state without re-subscribing
  useEffect(() => { leadsRef.current = leads },        [leads])
  useEffect(() => { setLeadsRef.current = setLeads },  [setLeads])
  useEffect(() => { saveLeadsRef.current = saveLeads }, [saveLeads])

  useEffect(() => campaignRunner.subscribe(setRunner), [])

  // ── Real-time SSE connection (EC2 always-on) ────────────────────────────────
  useEffect(() => {
    const es = new EventSource('/api/sse')

    function handleOpen(e) {
      try {
        const { leadId, opens, clicks, newStage, device, geo, campaignId, ts } = JSON.parse(e.data)
        const isClick = e.type === 'click_event'
        const lead    = leadsRef.current.find(l => l.id === leadId)
        const name    = lead?.name || lead?.email || leadId
        const company = lead?.company ? ` · ${lead.company}` : ''
        const geoStr  = geo?.city ? ` · ${geo.city}${geo.country ? ', ' + geo.country : ''}` : geo?.country ? ` · ${geo.country}` : ''
        const devStr  = device?.client && device.client !== 'Unknown' ? ` · ${device.client}` : ''

        // Live alert card
        const alertId = Date.now()
        const alertMsg = isClick
          ? `🖱️ ${name}${company} clicked a link${devStr}${geoStr}`
          : `📧 ${name}${company} opened email #${opens}${devStr}${geoStr}`
        setLiveAlerts(prev => [{ id: alertId, msg: alertMsg, isClick, newStage, leadName: name }, ...prev].slice(0, 5))
        setTimeout(() => setLiveAlerts(prev => prev.filter(a => a.id !== alertId)), 8000)

        // Auto-stage: apply server's decision to local state immediately
        if (newStage && lead && lead.pipelineStage !== newStage) {
          const updated = leadsRef.current.map(l => l.id === leadId ? { ...l, pipelineStage: newStage } : l)
          setLeadsRef.current(updated)
          saveLeadsRef.current(updated)
        }
      } catch {}
    }

    function handleReply(e) {
      try {
        const { leadId, leadName, email, ts } = JSON.parse(e.data)
        const name = leadName || email || leadId
        const alertId = Date.now()
        setLiveAlerts(prev => [{
          id: alertId,
          msg: `🚨 ${name} replied to your email! Follow up now.`,
          isClick: false,
          isReply: true,
          newStage: 'REPLIED',
          leadName: name,
        }, ...prev].slice(0, 5))
        setTimeout(() => setLiveAlerts(prev => prev.filter(a => a.id !== alertId)), 12000)
        // Update stage locally
        const lead = leadsRef.current.find(l => l.id === leadId)
        if (lead && lead.pipelineStage !== 'REPLIED') {
          const updated = leadsRef.current.map(l => l.id === leadId ? { ...l, pipelineStage: 'REPLIED' } : l)
          setLeadsRef.current(updated)
          saveLeadsRef.current(updated)
        }
      } catch {}
    }

    es.addEventListener('open_event',  handleOpen)
    es.addEventListener('click_event', handleOpen)
    es.addEventListener('reply_event', handleReply)
    es.onerror = () => {}  // silent reconnect
    return () => es.close()
  }, []) // connect once — uses refs for live data

  useEffect(() => {
    if (!isAdmin) return
    const token = localStorage.getItem('crm_token') || ''
    fetch(`/api/auth?type=users&token=${token}`)
      .then(r => r.json())
      .then(d => { if (Array.isArray(d)) setUserList(d) })
      .catch(() => {})
  }, [isAdmin])

  function doLogout() {
    const token = localStorage.getItem('crm_token')
    if (token) fetch(`/api/auth?token=${token}`, { method: 'DELETE' }).catch(() => {})
    Object.keys(localStorage).filter(k => k.startsWith('crm_')).forEach(k => localStorage.removeItem(k))
    navigate('/login')
  }

  function handleViewAs(e) {
    const val = e.target.value
    setViewAs(val)
    loadFromRedis(val)
  }

  const initials = userName.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()

  return (
    <div className="flex h-screen overflow-hidden" style={{ background: '#f1f5f9' }}>

      {/* ── SIDEBAR ─────────────────────────────────────────────────── */}
      <aside className="w-60 flex flex-col flex-shrink-0 relative"
             style={{ background: 'linear-gradient(160deg, #0f172a 0%, #1e1b4b 100%)' }}>

        {/* Subtle grid overlay */}
        <div className="absolute inset-0 opacity-[0.03] pointer-events-none"
             style={{ backgroundImage: 'radial-gradient(circle, #fff 1px, transparent 1px)', backgroundSize: '24px 24px' }} />

        {/* Logo */}
        <div className="relative px-5 py-5 border-b border-white/8">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
                 style={{ background: 'linear-gradient(135deg, #6366f1, #8b5cf6)', boxShadow: '0 4px 12px rgba(99,102,241,0.4)' }}>
              <Zap size={17} className="text-white" />
            </div>
            <div>
              <p className="text-sm font-bold text-white leading-none tracking-tight">EnginErds</p>
              <p className="text-[10px] text-slate-500 mt-0.5 font-medium tracking-wide">CRM PLATFORM</p>
            </div>
          </div>
        </div>

        {/* Nav */}
        <nav className="relative flex-1 overflow-y-auto px-3 py-4 space-y-5">
          {NAV.map(group => (
            <div key={group.label}>
              <p className="text-[9px] font-bold text-slate-600 uppercase tracking-[0.15em] px-3 mb-1.5">
                {group.label}
              </p>
              <div className="space-y-0.5">
                {group.items.map(item => {
                  if (item.adminOnly && !isAdmin) return null
                  return (
                    <NavLink
                      key={item.to}
                      to={item.to}
                      end={item.to === '/'}
                      className={({ isActive }) => isActive ? 'nav-item-active' : 'nav-item'}
                    >
                      <item.icon size={15} className="flex-shrink-0" />
                      <span className="flex-1 text-[13px]">{item.label}</span>
                      {item.badge === 'tasks' && taskCount > 0 && (
                        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full min-w-[18px] text-center"
                              style={{ background: '#ef4444', color: '#fff' }}>
                          {taskCount}
                        </span>
                      )}
                    </NavLink>
                  )
                })}
              </div>
            </div>
          ))}
        </nav>

        {/* Bottom */}
        <div className="relative px-3 py-3 border-t border-white/8 space-y-2">

          {/* Gmail status */}
          <div className={`flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-medium transition-colors ${
            gmailStatus.connected
              ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/20'
              : 'bg-white/5 text-slate-500 border border-white/8'
          }`}>
            <Mail size={13} className="flex-shrink-0" />
            <span className="truncate">{gmailStatus.connected ? gmailStatus.email : 'Gmail not connected'}</span>
          </div>

          {/* Admin: view-as switcher */}
          {isAdmin && userList.length > 0 && (
            <div className={`px-2 py-2 rounded-xl border text-xs ${viewAs ? 'bg-amber-500/10 border-amber-500/20' : 'bg-white/5 border-white/8'}`}>
              <div className="flex items-center gap-1.5 mb-1.5 text-slate-500">
                <Eye size={11} />
                <span className="font-semibold text-[10px] uppercase tracking-wider">Viewing as</span>
              </div>
              <select
                className="w-full text-xs rounded-lg px-2 py-1.5 focus:outline-none"
                style={{ background: 'rgba(255,255,255,0.08)', color: '#e2e8f0', border: '1px solid rgba(255,255,255,0.12)' }}
                value={viewAs || ''}
                onChange={handleViewAs}
              >
                <option value="" style={{ background: '#1e293b' }}>👑 Admin (own data)</option>
                {userList.map(u => (
                  <option key={u.id} value={u.id} style={{ background: '#1e293b' }}>{u.name || u.username}</option>
                ))}
              </select>
              {viewAs && (
                <p className="text-[10px] text-amber-400 mt-1 truncate">
                  Viewing {userList.find(u => u.id === viewAs)?.name || viewAs}'s data
                </p>
              )}
            </div>
          )}

          {/* User info + logout */}
          <div className="flex items-center gap-2.5 px-2 py-2 rounded-xl bg-white/5 border border-white/8">
            <div className="w-7 h-7 rounded-lg flex items-center justify-center text-[11px] font-bold text-white flex-shrink-0"
                 style={{ background: 'linear-gradient(135deg, #6366f1, #8b5cf6)' }}>
              {initials}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[12px] font-semibold text-white truncate">{userName}</p>
              <p className="text-[10px] text-slate-500 capitalize">{userRole}</p>
            </div>
            <button onClick={doLogout} title="Logout"
                    className="w-7 h-7 rounded-lg flex items-center justify-center text-slate-500 hover:text-red-400 hover:bg-red-500/10 transition-colors">
              <LogOut size={14} />
            </button>
          </div>
        </div>
      </aside>

      {/* ── MAIN AREA ───────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col overflow-hidden">

        {/* TOPBAR */}
        <header className="bg-white border-b border-slate-200 px-6 h-14 flex items-center gap-4 flex-shrink-0"
                style={{ boxShadow: '0 1px 4px rgba(0,0,0,0.05)' }}>
          <div className="flex items-center gap-5 text-sm">
            <div className="flex items-center gap-2 text-slate-500">
              <span className="text-xs font-medium">Leads</span>
              <span className="font-bold text-slate-900 tabular-nums">{leads.length}</span>
            </div>
            <div className="w-px h-4 bg-slate-200" />
            <div className="flex items-center gap-2 text-slate-500">
              <span className="text-xs font-medium">Clients</span>
              <span className="font-bold text-slate-900 tabular-nums">{clients.length}</span>
            </div>
            {hot > 0 && (
              <>
                <div className="w-px h-4 bg-slate-200" />
                <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-red-50 border border-red-200">
                  <span className="w-1.5 h-1.5 bg-red-500 rounded-full animate-pulse" />
                  <span className="text-xs font-bold text-red-600">{hot} Hot</span>
                </div>
              </>
            )}
          </div>
          <div className="ml-auto flex items-center gap-3">
            <NavLink to="/leads">
              <button className="btn-primary text-xs !px-3 !py-1.5">
                + Add Lead
              </button>
            </NavLink>
          </div>
        </header>

        {/* PAGE CONTENT */}
        <main className="flex-1 overflow-y-auto p-6">
          {children}
        </main>
      </div>

      {/* ── Live Real-time Alert Toasts (SSE) ───────────────────────── */}
      {liveAlerts.length > 0 && (
        <div className="fixed top-4 right-4 z-[60] flex flex-col gap-2 pointer-events-none" style={{ maxWidth: '340px' }}>
          {liveAlerts.map(alert => (
            <div
              key={alert.id}
              className="pointer-events-auto flex items-start gap-3 rounded-2xl px-4 py-3 shadow-2xl border animate-fade-in"
              style={{
                background: alert.isReply
                  ? 'linear-gradient(135deg, #fef2f2, #fff1f2)'
                  : alert.isClick
                  ? 'linear-gradient(135deg, #fef3c7, #fffbeb)'
                  : 'linear-gradient(135deg, #eff6ff, #f0fdf4)',
                borderColor: alert.isReply ? '#fca5a5' : alert.isClick ? '#fcd34d' : '#86efac',
                boxShadow: '0 8px 32px rgba(0,0,0,0.18)',
              }}
            >
              <div className="text-xl leading-none flex-shrink-0 mt-0.5">
                {alert.isClick ? '🖱️' : '📧'}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[12px] font-bold text-slate-800 leading-snug truncate">
                  {alert.isClick ? 'Link Clicked' : 'Email Opened'}
                </p>
                <p className="text-[11px] text-slate-600 leading-snug mt-0.5" style={{ wordBreak: 'break-word' }}>
                  {alert.msg.replace(/^[🖱️📧]\s*/, '')}
                </p>
                {alert.newStage && (
                  <span className="inline-block mt-1 text-[10px] font-bold px-2 py-0.5 rounded-full"
                    style={{
                      background: alert.newStage === 'HOT' ? '#fee2e2' : '#dbeafe',
                      color: alert.newStage === 'HOT' ? '#dc2626' : '#2563eb',
                    }}>
                    → {alert.newStage}
                  </span>
                )}
              </div>
              <button
                className="flex-shrink-0 text-slate-400 hover:text-slate-600 transition-colors mt-0.5"
                onClick={() => setLiveAlerts(prev => prev.filter(a => a.id !== alert.id))}
              >
                <XIcon size={13} />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* ── Floating Campaign Runner Banner ─────────────────────────── */}
      {(runner.status === 'RUNNING' || runner.status === 'PAUSED' || runner.status === 'DONE') && (
        <div className={`fixed bottom-5 right-5 z-50 w-80 rounded-2xl shadow-2xl overflow-hidden border ${
          runner.status === 'RUNNING' ? 'bg-white border-indigo-200'
          : runner.status === 'PAUSED' ? 'bg-white border-amber-200'
          : 'bg-white border-emerald-200'
        }`} style={{ boxShadow: '0 20px 50px rgba(0,0,0,0.15)' }}>

          {/* Header */}
          <div className={`flex items-center justify-between px-4 py-3 ${
            runner.status === 'RUNNING' ? 'bg-gradient-to-r from-indigo-600 to-violet-600'
            : runner.status === 'PAUSED' ? 'bg-amber-500'
            : 'bg-emerald-600'
          }`}>
            <div className="flex items-center gap-2 text-white min-w-0">
              {runner.status === 'RUNNING' && <span className="w-2 h-2 bg-white rounded-full animate-pulse flex-shrink-0"/>}
              {runner.status === 'PAUSED'  && <Pause size={12} className="flex-shrink-0"/>}
              {runner.status === 'DONE'    && <span className="text-sm flex-shrink-0">✅</span>}
              <span className="text-xs font-bold truncate">{runner.campaignName}</span>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              {runner.status === 'RUNNING' && (
                <button
                  onClick={() => campaignRunner.pause()}
                  className="flex items-center gap-1 bg-white/20 hover:bg-white/30 text-white text-[10px] font-semibold px-2 py-1 rounded-lg transition-colors"
                >
                  <Pause size={10}/> Pause
                </button>
              )}
              {(runner.status === 'PAUSED' || runner.status === 'DONE') && (
                <button
                  onClick={() => { campaignRunner.dismiss(); navigate('/history') }}
                  className="text-white/80 hover:text-white transition-colors"
                >
                  <XIcon size={14}/>
                </button>
              )}
            </div>
          </div>

          {/* Body */}
          <div className="px-4 py-3 space-y-2.5">
            {runner.status === 'RUNNING' && (
              <>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-slate-500 truncate max-w-[160px]">{runner.currentLead || 'Starting...'}</span>
                  <span className="font-bold text-indigo-600 shrink-0">{runner.sent}/{runner.total}</span>
                </div>
                <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                  <div className="h-full rounded-full transition-all duration-300"
                       style={{ width: `${runner.progress}%`, background: 'linear-gradient(90deg, #6366f1, #8b5cf6)' }} />
                </div>
                <div className="flex gap-3 text-[11px]">
                  <span className="text-emerald-600 font-semibold">{runner.sent} sent</span>
                  {runner.failed  > 0 && <span className="text-red-500">{runner.failed} failed</span>}
                  {runner.skipped > 0 && <span className="text-slate-400">{runner.skipped} skipped</span>}
                </div>
              </>
            )}

            {runner.status === 'PAUSED' && (
              <>
                <p className="text-xs font-semibold text-amber-800">
                  {runner.capPause ? '🚫 Daily sending limit reached' : '⏸ Paused by you'}
                </p>
                <p className="text-[11px] text-amber-600">
                  {runner.pending} leads pending · Resume in Campaign History after 24h
                </p>
                <div className="flex gap-3 text-[11px]">
                  <span className="text-emerald-600 font-semibold">{runner.sent} sent</span>
                  {runner.failed > 0 && <span className="text-red-500">{runner.failed} failed</span>}
                  <span className="text-amber-600">{runner.pending} pending</span>
                </div>
                <button
                  onClick={() => { campaignRunner.dismiss(); navigate('/history') }}
                  className="flex items-center gap-1 text-xs text-amber-700 font-semibold hover:underline"
                >
                  View in Campaign History <ChevronRight size={11} />
                </button>
              </>
            )}

            {runner.status === 'DONE' && (
              <>
                <p className="text-xs font-semibold text-emerald-800">Campaign complete!</p>
                <div className="flex gap-3 text-[11px]">
                  <span className="text-emerald-600 font-semibold">{runner.sent} sent</span>
                  {runner.failed  > 0 && <span className="text-red-500">{runner.failed} failed</span>}
                  {runner.skipped > 0 && <span className="text-slate-400">{runner.skipped} skipped</span>}
                </div>
                <button
                  onClick={() => { campaignRunner.dismiss(); navigate('/history') }}
                  className="flex items-center gap-1 text-xs text-indigo-600 font-semibold hover:underline"
                >
                  View results <ChevronRight size={11} />
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
