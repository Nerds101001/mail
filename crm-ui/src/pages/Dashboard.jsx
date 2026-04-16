import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useCRM } from '../store'
import { StatCard, Card, Btn, Spinner } from '../components/ui'
import { daysDiff, daysSince, fmtCurrency } from '../utils'
import { Users, UserCheck, Flame, CheckSquare, Send, MessageSquare, RefreshCw, RotateCcw, TrendingUp, Mail } from 'lucide-react'

export default function Dashboard() {
  const { leads, clients, deals, activity, logActivity } = useCRM()
  const [tasks, setTasks] = useState([])
  const [loadingTasks, setLoadingTasks] = useState(true)
  const navigate = useNavigate()

  const sent    = leads.filter(l => ['SENT','REPLIED','FOLLOW-UP'].includes(l.status)).length
  const replied = leads.filter(l => l.status === 'REPLIED').length
  const hot     = leads.filter(l => (l.opens >= 2 || l.clicks >= 1) && !['WON','LOST','UNSUBSCRIBED'].includes(l.pipelineStage)).length
  const renewalsSoon = clients.filter(c => { const d = daysDiff(c.renewalDate); return d !== null && d >= 0 && d <= 30 }).length
  const overdue = clients.filter(c => c.paymentStatus === 'OVERDUE').length
  const revenue = clients.reduce((s, c) => s + (parseFloat(c.amount) || 0), 0)

  useEffect(() => {
    fetch('/api/tasks').then(r => r.json()).then(d => { setTasks(d.tasks || []); setLoadingTasks(false) }).catch(() => setLoadingTasks(false))
  }, [])

  async function sendDigest() {
    const res = await fetch('/api/send-reminder')
    const d = await res.json()
    if (d.ok) alert('Daily digest sent to contact@enginerds.in ✓')
    else alert('Could not send: ' + (d.reason || d.error))
  }

  const priorityColor = { HIGH: 'border-l-red-400', MEDIUM: 'border-l-amber-400', LOW: 'border-l-slate-300' }
  const priorityBadge = { HIGH: 'bg-red-100 text-red-700', MEDIUM: 'bg-amber-100 text-amber-700', LOW: 'bg-slate-100 text-slate-600' }

  return (
    <div className="space-y-6">
      {/* Stats row 1 */}
      <div className="grid grid-cols-4 gap-4">
        <StatCard label="Total Leads"    value={leads.length}  sub="All contacts"          icon={Users}       color="slate"   onClick={() => navigate('/leads')} />
        <StatCard label="Hot Leads"      value={hot}           sub="Opened or clicked"     icon={Flame}       color="red"     onClick={() => navigate('/leads')} />
        <StatCard label="Active Clients" value={clients.length} sub={fmtCurrency(revenue)+' pipeline'} icon={UserCheck} color="emerald" onClick={() => navigate('/clients')} />
        <StatCard label="Tasks Today"    value={tasks.length}  sub="Pending actions"       icon={CheckSquare} color="amber"   onClick={() => navigate('/tasks')} />
      </div>

      {/* Stats row 2 */}
      <div className="grid grid-cols-4 gap-4">
        <StatCard label="Emails Sent"     value={sent}           sub={leads.length ? Math.round(sent/leads.length*100)+'% send rate' : '0%'} icon={Send}         color="blue" />
        <StatCard label="Replies"         value={replied}        sub={sent ? Math.round(replied/sent*100)+'% reply rate' : '0%'}              icon={MessageSquare} color="emerald" />
        <StatCard label="Renewals Due"    value={renewalsSoon}   sub="Next 30 days"         icon={RotateCcw}   color="amber" onClick={() => navigate('/clients')} />
        <StatCard label="Overdue Payments" value={overdue}       sub="Needs follow-up"      icon={TrendingUp}  color="red"   onClick={() => navigate('/clients')} />
      </div>

      <div className="grid grid-cols-2 gap-6">
        {/* Today's Tasks */}
        <Card className="p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-bold text-slate-900">Today's Priority Tasks</h2>
            <div className="flex gap-2">
              <Btn variant="ghost" size="sm" onClick={() => fetch('/api/tasks').then(r=>r.json()).then(d=>setTasks(d.tasks||[]))}>
                <RefreshCw size={13} />
              </Btn>
              <Btn variant="secondary" size="sm" onClick={sendDigest}><Mail size={13} /> Digest</Btn>
            </div>
          </div>
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
          <h2 className="text-sm font-bold text-slate-900 mb-4">Recent Activity</h2>
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
        <h2 className="text-sm font-bold text-slate-900 mb-4">Lead Pipeline Overview</h2>
        <div className="grid grid-cols-8 gap-3">
          {['COLD','CONTACTED','OPENED','HOT','DEMO','QUOTED','WON','LOST'].map(stage => {
            const count = leads.filter(l => l.pipelineStage === stage).length
            const colors = { COLD:'bg-slate-100 text-slate-600', CONTACTED:'bg-blue-100 text-blue-700', OPENED:'bg-amber-100 text-amber-700', HOT:'bg-red-100 text-red-700', DEMO:'bg-purple-100 text-purple-700', QUOTED:'bg-indigo-100 text-indigo-700', WON:'bg-emerald-100 text-emerald-700', LOST:'bg-red-50 text-red-400' }
            return (
              <div key={stage} className={`rounded-xl p-3 text-center cursor-pointer hover:scale-105 transition-transform ${colors[stage]}`} onClick={() => navigate('/pipeline')}>
                <p className="text-2xl font-bold">{count}</p>
                <p className="text-[10px] font-semibold uppercase tracking-wide mt-1">{stage}</p>
              </div>
            )
          })}
        </div>
      </Card>
    </div>
  )
}
