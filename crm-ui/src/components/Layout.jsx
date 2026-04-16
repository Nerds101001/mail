import { NavLink, useNavigate } from 'react-router-dom'
import { useCRM } from '../store'
import {
  LayoutDashboard, CheckSquare, Users, GitBranch, Send,
  UserCheck, FileText, BarChart2, Settings, LogOut, Zap, Mail, UserX, History
} from 'lucide-react'

const NAV = [
  { label: 'Overview', items: [
    { to: '/',         icon: LayoutDashboard, label: 'Dashboard' },
    { to: '/tasks',    icon: CheckSquare,     label: "Today's Tasks", badge: 'tasks' },
  ]},
  { label: 'Sales', items: [
    { to: '/leads',    icon: Users,           label: 'Leads' },
    { to: '/pipeline', icon: GitBranch,       label: 'Pipeline' },
    { to: '/campaign', icon: Send,            label: 'Campaign' },
    { to: '/history',  icon: History,         label: 'Cam. History' },
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
  const { leads, clients, gmailStatus } = useCRM()
  const navigate = useNavigate()
  const hot = leads.filter(l => (l.opens >= 2 || l.clicks >= 1) && !['WON','LOST','UNSUBSCRIBED'].includes(l.pipelineStage)).length

  function doLogout() {
    const token = localStorage.getItem('crm_token')
    if (token) fetch(`/api/auth?token=${token}`, { method: 'DELETE' }).catch(() => {})
    localStorage.removeItem('crm_token')
    navigate('/login')
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
    </div>
  )
}
