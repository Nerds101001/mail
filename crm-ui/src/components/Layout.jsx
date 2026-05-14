import { NavLink, useNavigate } from 'react-router-dom'
import { useCRM } from '../store'
import { useEffect, useState } from 'react'
import {
  LayoutDashboard, CheckSquare, Users, GitBranch, Send,
  UserCheck, FileText, BarChart2, Settings, LogOut, Zap, Mail, UserX, History, Paperclip, Eye,
  Pause, X as XIcon,
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
    { to: '/history',     icon: History,     label: 'Cam. History' },
    { to: '/attachments', icon: Paperclip,   label: 'Attachments' },
  ]},
  { label: 'Business', items: [
    { to: '/clients',  icon: UserCheck,       label: 'Clients' },
    { to: '/deals',    icon: FileText,        label: 'Deals' },
  ]},
  { label: 'Analytics', items: [
    { to: '/tracking',     icon: BarChart2,       label: 'Tracking' },
    { to: '/unsubscribes', icon: UserX,           label: 'Unsubscribes' },
  ]},
  { label: 'Config', items: [
    { to: '/users',    icon: Users,           label: 'Users',    adminOnly: true },
    { to: '/settings', icon: Settings,        label: 'Settings' },
  ]},
]

export default function Layout({ children, taskCount = 0 }) {
  const { leads, clients, gmailStatus, viewAs, setViewAs, loadFromRedis } = useCRM()
  const navigate   = useNavigate()
  const isAdmin    = localStorage.getItem('crm_role') === 'admin'
  const hot        = leads.filter(l => l.pipelineStage === 'HOT' && !['WON','LOST','UNSUBSCRIBED'].includes(l.pipelineStage)).length
  const [userList, setUserList]     = useState([])
  const [runner, setRunner]         = useState(campaignRunner.getState())

  // Subscribe to runner state for the floating progress banner
  useEffect(() => campaignRunner.subscribe(setRunner), [])

  // Load user list for admin view-as switcher
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
    // Clear ALL CRM data from localStorage — critical for user isolation
    Object.keys(localStorage).filter(k => k.startsWith('crm_')).forEach(k => localStorage.removeItem(k))
    navigate('/login')
  }

  function handleViewAs(e) {
    const val = e.target.value
    setViewAs(val)
    // Pass the value directly — avoids the async state-update lag of viewAsRef
    loadFromRedis(val)
  }

  return (
    <div className="flex h-screen bg-slate-50 overflow-hidden">
      {/* SIDEBAR */}
      <aside className="w-56 bg-white border-r border-slate-200 flex flex-col shadow-sm flex-shrink-0">
        {/* Logo */}
        <div className="px-4 py-5 border-b border-slate-100">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 bg-emerald-500 rounded-lg flex items-center justify-center shadow-sm">
              <Zap size={16} className="text-white" />
            </div>
            <div>
              <p className="text-sm font-bold text-slate-900 leading-none">Enginerds</p>
              <p className="text-[10px] text-slate-400 mt-0.5 font-medium">CRM Platform</p>
            </div>
          </div>
        </div>

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto px-3 py-3 space-y-4">
          {NAV.map(group => (
            <div key={group.label}>
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest px-2 mb-1.5">{group.label}</p>
              <div className="space-y-0.5">
                {group.items.map(item => {
                  const isAdmin = localStorage.getItem('crm_role') === 'admin'
                  if (item.adminOnly && !isAdmin) return null
                  return (
                    <NavLink
                      key={item.to}
                      to={item.to}
                      end={item.to === '/'}
                      className={({ isActive }) => isActive ? 'nav-item-active' : 'nav-item'}
                    >
                      <item.icon size={16} />
                      <span className="flex-1">{item.label}</span>
                      {item.badge === 'tasks' && taskCount > 0 && (
                        <span className="bg-red-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full min-w-[18px] text-center">{taskCount}</span>
                      )}
                    </NavLink>
                  )
                })}
              </div>
            </div>
          ))}
        </nav>

        {/* Bottom */}
        <div className="px-3 py-3 border-t border-slate-100 space-y-1">
          <div className="px-3 py-2 text-xs text-slate-500">
            <span className="font-semibold text-slate-700">{localStorage.getItem('crm_userName') || 'Admin'}</span>
            <span className="ml-1 text-slate-400">({localStorage.getItem('crm_role') || 'admin'})</span>
          </div>

          {/* Admin: view-as user switcher */}
          {isAdmin && userList.length > 0 && (
            <div className={`mx-1 px-2 py-2 rounded-lg text-xs border ${viewAs ? 'bg-amber-50 border-amber-200' : 'bg-slate-50 border-slate-200'}`}>
              <div className="flex items-center gap-1 mb-1 text-slate-500">
                <Eye size={11} />
                <span className="font-semibold uppercase tracking-wide text-[10px]">Viewing as</span>
              </div>
              <select
                className="w-full text-xs bg-white border border-slate-200 rounded px-1.5 py-1 focus:outline-none focus:ring-1 focus:ring-amber-400"
                value={viewAs || ''}
                onChange={handleViewAs}
              >
                <option value="">👑 Admin (own data)</option>
                {userList.map(u => (
                  <option key={u.id} value={u.id}>{u.name || u.username}</option>
                ))}
              </select>
              {viewAs && (
                <p className="text-[10px] text-amber-600 mt-1">Viewing {userList.find(u=>u.id===viewAs)?.name || viewAs}'s data</p>
              )}
            </div>
          )}

          <div className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium ${gmailStatus.connected ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-50 text-slate-500'}`}>
            <Mail size={13} />
            <span className="truncate">{gmailStatus.connected ? gmailStatus.email : 'Gmail not connected'}</span>
          </div>
          <button onClick={doLogout} className="nav-item w-full text-red-500 hover:bg-red-50 hover:text-red-600">
            <LogOut size={16} /><span>Logout</span>
          </button>
        </div>
      </aside>

      {/* MAIN */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* TOPBAR */}
        <header className="bg-white border-b border-slate-200 px-6 py-3 flex items-center gap-4 shadow-sm flex-shrink-0">
          <div className="flex items-center gap-6 text-sm">
            <div className="flex items-center gap-1.5">
              <span className="text-slate-400 font-medium">Leads</span>
              <span className="font-bold text-slate-900">{leads.length}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-slate-400 font-medium">Clients</span>
              <span className="font-bold text-slate-900">{clients.length}</span>
            </div>
            {hot > 0 && (
              <div className="flex items-center gap-1.5">
                <span className="w-2 h-2 bg-red-500 rounded-full animate-pulse"></span>
                <span className="font-bold text-red-600">{hot} Hot</span>
              </div>
            )}
          </div>
          <div className="ml-auto flex items-center gap-3">
            <NavLink to="/leads">
              <button className="btn-primary text-xs px-3 py-1.5">+ Add Lead</button>
            </NavLink>
          </div>
        </header>

        {/* PAGE CONTENT */}
        <main className="flex-1 overflow-y-auto p-6">
          {children}
        </main>
      </div>

      {/* ── Floating Campaign Runner Banner ────────────────────────────── */}
      {(runner.status === 'RUNNING' || runner.status === 'PAUSED' || runner.status === 'DONE') && (
        <div className={`fixed bottom-5 right-5 z-50 w-80 rounded-2xl shadow-2xl border overflow-hidden ${
          runner.status === 'RUNNING' ? 'bg-white border-blue-200'
          : runner.status === 'PAUSED' ? 'bg-amber-50 border-amber-200'
          : 'bg-emerald-50 border-emerald-200'
        }`}>
          {/* Header */}
          <div className={`flex items-center justify-between px-4 py-2.5 ${
            runner.status === 'RUNNING' ? 'bg-blue-600'
            : runner.status === 'PAUSED' ? 'bg-amber-500'
            : 'bg-emerald-600'
          }`}>
            <div className="flex items-center gap-2 text-white">
              {runner.status === 'RUNNING' && <span className="w-2 h-2 bg-white rounded-full animate-pulse"/>}
              {runner.status === 'PAUSED'  && <Pause size={12}/>}
              {runner.status === 'DONE'    && <span className="text-sm">✅</span>}
              <span className="text-xs font-bold truncate max-w-[180px]">{runner.campaignName}</span>
            </div>
            <div className="flex items-center gap-2">
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
                  title="Dismiss"
                >
                  <XIcon size={14}/>
                </button>
              )}
            </div>
          </div>

          {/* Body */}
          <div className="px-4 py-3 space-y-2">
            {runner.status === 'RUNNING' && (
              <>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-slate-500 truncate max-w-[160px]">{runner.currentLead || 'Starting...'}</span>
                  <span className="font-bold text-blue-700 shrink-0">{runner.sent}/{runner.total}</span>
                </div>
                <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-blue-500 rounded-full transition-all duration-300"
                    style={{ width: `${runner.progress}%` }}
                  />
                </div>
                <div className="flex gap-3 text-[10px] text-slate-500">
                  <span className="text-emerald-600 font-semibold">{runner.sent} sent</span>
                  {runner.failed  > 0 && <span className="text-red-500">{runner.failed} failed</span>}
                  {runner.skipped > 0 && <span>{runner.skipped} skipped</span>}
                </div>
              </>
            )}

            {runner.status === 'PAUSED' && (
              <>
                <p className="text-xs font-semibold text-amber-800">
                  {runner.capPause ? '🚫 Daily sending limit reached' : '⏸ Paused by you'}
                </p>
                <p className="text-[10px] text-amber-600">
                  {runner.pending} leads pending · Resume button appears in Campaign History after 24h
                </p>
                <div className="flex gap-3 text-[10px] text-slate-500">
                  <span className="text-emerald-600 font-semibold">{runner.sent} sent</span>
                  {runner.failed > 0 && <span className="text-red-500">{runner.failed} failed</span>}
                  <span className="text-amber-600">{runner.pending} pending</span>
                </div>
                <button
                  onClick={() => { campaignRunner.dismiss(); navigate('/history') }}
                  className="w-full mt-1 text-xs text-amber-700 font-semibold hover:underline"
                >
                  View in Campaign History →
                </button>
              </>
            )}

            {runner.status === 'DONE' && (
              <>
                <p className="text-xs font-semibold text-emerald-800">Campaign complete!</p>
                <div className="flex gap-3 text-[10px]">
                  <span className="text-emerald-600 font-semibold">{runner.sent} sent</span>
                  {runner.failed  > 0 && <span className="text-red-500">{runner.failed} failed</span>}
                  {runner.skipped > 0 && <span className="text-slate-500">{runner.skipped} skipped</span>}
                </div>
                <button
                  onClick={() => { campaignRunner.dismiss(); navigate('/history') }}
                  className="w-full mt-1 text-xs text-emerald-700 font-semibold hover:underline"
                >
                  View results in Campaign History →
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
