import { useEffect, useState } from 'react'
import { Btn, Empty, PageHeader, Spinner, toast } from '../components/ui'
import { RefreshCw, Mail, CheckSquare } from 'lucide-react'

const PRIORITY_STYLES = {
  HIGH:   { card: 'border-l-red-400 bg-red-50/30',    badge: 'bg-red-100 text-red-700',    icon: '🔴' },
  MEDIUM: { card: 'border-l-amber-400 bg-amber-50/30', badge: 'bg-amber-100 text-amber-700', icon: '🟡' },
  LOW:    { card: 'border-l-slate-300 bg-slate-50',    badge: 'bg-slate-100 text-slate-600', icon: '⚪' },
}

export default function Tasks() {
  const [tasks, setTasks]     = useState([])
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)

  async function load() {
    setLoading(true)
    try {
      const res = await fetch('/api/tasks')
      const data = await res.json()
      setTasks(data.tasks || [])
    } catch(e) { toast('Could not load tasks', 'error') }
    setLoading(false)
  }

  async function sendDigest() {
    setSending(true)
    try {
      const res = await fetch('/api/send-reminder')
      const data = await res.json()
      if (data.ok) toast('Daily digest sent to contact@enginerds.in ✓', 'success')
      else toast('Could not send: ' + (data.reason || data.error), 'error')
    } catch(e) { toast('Send failed', 'error') }
    setSending(false)
  }

  useEffect(() => { load() }, [])

  const high   = tasks.filter(t => t.priority === 'HIGH')
  const medium = tasks.filter(t => t.priority === 'MEDIUM')

  return (
    <div>
      <PageHeader title="Today's Tasks" subtitle={`${tasks.length} pending actions`}>
        <Btn variant="secondary" size="sm" onClick={load}><RefreshCw size={13} /> Refresh</Btn>
        <Btn variant="primary" onClick={sendDigest} disabled={sending}>
          <Mail size={13} /> {sending ? 'Sending...' : 'Email Digest'}
        </Btn>
      </PageHeader>

      {loading ? (
        <div className="flex justify-center py-20"><Spinner size={32} /></div>
      ) : tasks.length === 0 ? (
        <div className="card p-16">
          <Empty icon={CheckSquare} title="All caught up! 🎉" sub="No urgent tasks for today. Check back tomorrow." />
        </div>
      ) : (
        <div className="space-y-6">
          {/* Summary */}
          <div className="grid grid-cols-3 gap-4">
            <div className="card p-4 border-l-4 border-l-red-400">
              <p className="text-2xl font-bold text-red-600">{high.length}</p>
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mt-1">High Priority</p>
            </div>
            <div className="card p-4 border-l-4 border-l-amber-400">
              <p className="text-2xl font-bold text-amber-600">{medium.length}</p>
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mt-1">Medium Priority</p>
            </div>
            <div className="card p-4 border-l-4 border-l-emerald-400">
              <p className="text-2xl font-bold text-emerald-600">{tasks.length}</p>
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mt-1">Total Tasks</p>
            </div>
          </div>

          {/* Task list */}
          <div className="space-y-2">
            {tasks.map((t, i) => {
              const s = PRIORITY_STYLES[t.priority] || PRIORITY_STYLES.LOW
              return (
                <div key={i} className={`flex items-center gap-4 p-4 rounded-xl border-l-4 border border-slate-200 hover:shadow-md hover:-translate-y-0.5 transition-all duration-150 ${s.card}`}>
                  <span className="text-2xl">{t.icon}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold text-slate-900">{t.title}</p>
                    <p className="text-xs text-slate-500 mt-0.5">{t.detail}</p>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <span className={`badge text-[11px] ${s.badge}`}>{t.priority}</span>
                    <span className="badge text-[11px] bg-slate-100 text-slate-600">{t.type}</span>
                    {t.email && (
                      <a href={`mailto:${t.email}`} className="p-1.5 rounded-lg hover:bg-white border border-slate-200 text-blue-500 transition-colors" title={`Email ${t.name}`}>
                        <Mail size={13} />
                      </a>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
