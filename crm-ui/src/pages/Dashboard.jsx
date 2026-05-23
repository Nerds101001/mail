import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useCRM } from '../store'
import { StatCard, Card, Btn, Spinner, SectionHeader } from '../components/ui'
import { daysDiff, daysSince, fmtCurrency } from '../utils'
import { Users, UserCheck, Flame, CheckSquare, Send, MessageSquare, RefreshCw, RotateCcw, TrendingUp, Mail } from 'lucide-react'

export default function Dashboard() {
  const { leads, clients, deals, activity, loadFromRedis, viewAs } = useCRM()
  const [tasks, setTasks] = useState([])
  const [loadingTasks, setLoadingTasks] = useState(true)
  const navigate = useNavigate()

  const sent    = leads.filter(l => ['SENT','REPLIED','FOLLOW-UP'].includes(l.status)).length
  const replied = leads.filter(l => l.status === 'REPLIED').length
  const hot     = leads.filter(l => l.pipelineStage === 'HOT' && !['WON','LOST','UNSUBSCRIBED'].includes(l.pipelineStage)).length
  const renewalsSoon = clients.filter(c => { const d = daysDiff(c.renewalDate); return d !== null && d >= 0 && d <= 30 }).length
  const overdueClients = clients.filter(c => c.paymentStatus === 'OVERDUE')
  const overdue = overdueClients.length
  const renewingSoonClients = clients.filter(c => { const d = daysDiff(c.renewalDate); return d !== null && d >= 0 && d <= 7 })
  const revenue = clients.reduce((s, c) => s + (parseFloat(c.amount) || 0), 0)

  const authHeader = () => ({ Authorization: `Bearer ${localStorage.getItem('crm_token') || ''}` })
  const vaParam    = () => viewAs ? `&viewAs=${encodeURIComponent(viewAs)}` : ''

  useEffect(() => {
    loadFromRedis()
    fetch(`/api/ops?type=tasks${vaParam()}`, { headers: authHeader() })
      .then(r => r.json())
      .then(d => { setTasks(d.tasks || []); setLoadingTasks(false) })
      .catch(() => setLoadingTasks(false))
  }, [viewAs])

  async function sendDigest() {
    const res = await fetch(`/api/ops?type=reminder${vaParam()}`, { headers: authHeader() })
    const d = await res.json()
    if (d.ok) alert('Daily digest sent ✓')
    else alert('Could not send: ' + (d.reason || d.error))
  }

  const priorityColor = { HIGH: 'border-l-red-400', MEDIUM: 'border-l-amber-400', LOW: 'border-l-slate-300' }
  const priorityBadge = { HIGH: 'bg-red-100 text-red-700', MEDIUM: 'bg-amber-100 text-amber-700', LOW: 'bg-slate-100 text-slate-600' }

  return (
    <div className="space-y-6">
      {/* Alert banners */}
      {(overdueClients.length > 0 || renewingSoonClients.length > 0) && (
        <div className="space-y-2">
          {overdueClients.length > 0 && (
            <div
              className="flex items-center gap-3 px-4 py-3 bg-red-50 border border-red-200 rounded-xl cursor-pointer hover:bg-red-100 transition-colors"
              onClick={() => navigate('/clients')}
            >
              <span className="text-lg">🚨</span>
              <div className="flex-1">
                <p className="text-sm font-bold text-red-800">
                  {overdueClients.length} overdue payment{overdueClients.length > 1 ? 's' : ''}
                </p>
                <p className="text-xs text-red-600 truncate">
                  {overdueClients.map(c => c.name || c.company || c.email).join(', ')}
                </p>
              </div>
              <span className="text-xs text-red-500 font-medium whitespace-nowrap">View Clients →</span>
            </div>
          )}
          {renewingSoonClients.length > 0 && (
            <div
              className="flex items-center gap-3 px-4 py-3 bg-amber-50 border border-amber-200 rounded-xl cursor-pointer hover:bg-amber-100 transition-colors"
              onClick={() => navigate('/clients')}
            >
              <span className="text-lg">⏰</span>
              <div className="flex-1">
                <p className="text-sm font-bold text-amber-800">
                  {renewingSoonClients.length} renewal{renewingSoonClients.length > 1 ? 's' : ''} due within 7 days
                </p>
                <p className="text-xs text-amber-700 truncate">
                  {renewingSoonClients.map(c => c.name || c.company || c.email).join(', ')}
                </p>
              </div>
              <span className="text-xs text-amber-600 font-medium whitespace-nowrap">View Clients →</span>
            </div>
          )}
        </div>
      )}

      {/* Stats row 1 */}
      <div className="grid grid-cols-4 gap-4">
        <StatCard label="Total Leads"    value={leads.length}  sub="All contacts"          icon={Users}       color="indigo"  onClick={() => navigate('/leads')} />
        <StatCard label="Hot Leads"      value={hot}           sub="Opened or clicked"     icon={Flame}       color="red"     onClick={() => navigate('/leads')} />
        <StatCard label="Active Clients" value={clients.length} sub={fmtCurrency(revenue)+' pipeline'} icon={UserCheck} color="emerald" onClick={() => navigate('/clients')} />
        <StatCard label="Tasks Today"    value={tasks.length}  sub="Pending actions"       icon={CheckSquare} color="amber"   onClick={() => navigate('/tasks')} />
      </div>

      {/* Stats row 2 */}
      <div className="grid grid-cols-4 gap-4">
        <StatCard label="Emails Sent"     value={sent}           sub={leads.length ? Math.round(sent/leads.length*100)+'% send rate' : '0%'} icon={Send}         color="blue" />
        <StatCard label="Replies"         value={replied}        sub={sent ? Math.round(replied/sent*100)+'% reply rate' : '0%'}              icon={MessageSquare} color="violet" />
        <StatCard label="Renewals Due"    value={renewalsSoon}   sub="Next 30 days"         icon={RotateCcw}   color="amber" onClick={() => navigate('/clients')} />
        <StatCard label="Overdue Payments" value={overdue}       sub="Needs follow-up"      icon={TrendingUp}  color="red"   onClick={() => navigate('/clients')} />
      </div>

      <div className="grid grid-cols-2 gap-6">
        {/* Today's Tasks */}
        <Card className="p-5">
          <SectionHeader title="Today's Priority Tasks">
            <Btn variant="ghost" size="sm" onClick={() => fetch('/api/ops?type=tasks', { headers: authHeader() }).then(r=>r.json()).then(d=>setTasks(d.tasks||[]))}>
              <RefreshCw size={13} />
            </Btn>
            <Btn variant="secondary" size="sm" onClick={sendDigest}><Mail size={13} /> Digest</Btn>
          </SectionHeader>
          {loadingTasks ? (
            <div className="flex justify-center py-8"><Spinner /></div>
          ) : tasks.length === 0 ? (
            <div className="text-center py-8">
              <div className="text-2xl mb-2">🎉</div>
              <p className="text-sm font-medium text-slate-600">All caught up!</p>
              <p className="text-xs text-slate-400">No urgent tasks today</p>
            </div>
          ) : (
            <div className="space-y-2">
              {tasks.slice(0, 6).map((t, i) => (
                <div key={i} className={`flex items-center gap-3 p-3 rounded-lg border-l-4 bg-slate-50 hover:bg-slate-100 transition-colors ${priorityColor[t.priority]}`}>
                  <span className="text-lg">{t.icon}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-slate-800 truncate">{t.title}</p>
                    <p className="text-xs text-slate-500 truncate">{t.detail}</p>
                  </div>
                  <span className={`badge text-[10px] ${priorityBadge[t.priority]}`}>{t.priority}</span>
                </div>
              ))}
              {tasks.length > 6 && (
                <button onClick={() => navigate('/tasks')} className="text-xs text-emerald-600 font-medium hover:underline w-full text-center pt-1">
                  +{tasks.length - 6} more tasks →
                </button>
              )}
            </div>
          )}
        </Card>

        {/* Recent Activity */}
        <Card className="p-5">
          <SectionHeader title="Recent Activity" />
          {activity.length === 0 ? (
            <div className="text-center py-8">
              <p className="text-sm text-slate-400">No activity yet</p>
            </div>
          ) : (
            <div className="space-y-1">
              {[...activity].reverse().slice(0, 10).map((a, i) => (
                <div key={i} className="flex items-start gap-3 py-2 border-b border-slate-50 last:border-0">
                  <span className="text-[10px] text-slate-400 font-mono mt-0.5 whitespace-nowrap">
                    {new Date(a.time).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
                  </span>
                  <p className="text-xs text-slate-600">{a.msg}</p>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      {/* Pipeline summary */}
      <Card className="p-5">
        <SectionHeader title="Lead Pipeline Overview" />
        <div className="grid grid-cols-8 gap-3">
          {['COLD','CONTACTED','OPENED','HOT','DEMO','QUOTED','WON','LOST'].map(stage => {
            const count = leads.filter(l => l.pipelineStage === stage).length
            const palette = {
              COLD:      { bg: 'bg-slate-50',    text: 'text-slate-600',   bar: 'bg-slate-300' },
              CONTACTED: { bg: 'bg-blue-50',     text: 'text-blue-700',    bar: 'bg-blue-400' },
              OPENED:    { bg: 'bg-amber-50',    text: 'text-amber-700',   bar: 'bg-amber-400' },
              HOT:       { bg: 'bg-red-50',      text: 'text-red-700',     bar: 'bg-red-500' },
              DEMO:      { bg: 'bg-purple-50',   text: 'text-purple-700',  bar: 'bg-purple-500' },
              QUOTED:    { bg: 'bg-indigo-50',   text: 'text-indigo-700',  bar: 'bg-indigo-500' },
              WON:       { bg: 'bg-emerald-50',  text: 'text-emerald-700', bar: 'bg-emerald-500' },
              LOST:      { bg: 'bg-slate-50',    text: 'text-slate-400',   bar: 'bg-slate-200' },
            }
            const { bg, text, bar } = palette[stage] || palette.COLD
            return (
              <div key={stage}
                   className={`${bg} rounded-xl p-3 text-center cursor-pointer hover:scale-105 transition-all duration-200 border border-transparent hover:border-slate-200`}
                   onClick={() => navigate('/pipeline')}>
                <p className={`text-2xl font-bold tabular-nums ${text}`}>{count}</p>
                <p className={`text-[9px] font-bold uppercase tracking-wider mt-1.5 ${text}`}>{stage}</p>
                <div className="mt-2 h-1 rounded-full bg-black/5">
                  <div className={`h-full rounded-full ${bar} transition-all duration-500`}
                       style={{ width: count > 0 ? `${Math.min(100, count * 10)}%` : '0%' }} />
                </div>
              </div>
            )
          })}
        </div>
      </Card>
    </div>
  )
}
