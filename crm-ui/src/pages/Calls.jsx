// Calls — AI voice calls made through Retell (see api/calls.js). History of inbound + outbound calls,
// outcome, summary, transcript and recording. Starting a call happens from the Leads page (📞 button).
import { useState, useEffect } from 'react'
import { PageHeader, Empty, Btn, Modal, toast } from '../components/ui'
import { fmtDate } from '../utils'
import { Phone, PhoneIncoming, PhoneOutgoing, RefreshCw, FileText, Play } from 'lucide-react'

const OUTCOME = {
  interested:     { label: 'Interested',     cls: 'bg-emerald-100 text-emerald-700' },
  callback:       { label: 'Call back',      cls: 'bg-amber-100 text-amber-700' },
  not_interested: { label: 'Not interested', cls: 'bg-slate-200 text-slate-600' },
  do_not_call:    { label: 'Do not call',    cls: 'bg-red-100 text-red-700' },
  no_answer:      { label: 'No answer',      cls: 'bg-slate-100 text-slate-500' },
  voicemail:      { label: 'Voicemail',      cls: 'bg-slate-100 text-slate-500' },
  completed:      { label: 'Completed',      cls: 'bg-blue-100 text-blue-700' },
  other:          { label: 'Other',          cls: 'bg-slate-100 text-slate-500' },
}
const dur = ms => ms ? `${Math.floor(ms / 60000)}:${String(Math.round((ms % 60000) / 1000)).padStart(2, '0')}` : '—'
export const authHeader = () => ({ Authorization: `Bearer ${localStorage.getItem('crm_token') || ''}` })

export default function Calls() {
  const [calls, setCalls]     = useState([])
  const [loading, setLoading] = useState(true)
  const [status, setStatus]   = useState(null)
  const [open, setOpen]       = useState(null)       // call whose transcript is shown
  const [transcript, setTranscript] = useState('')

  async function load() {
    setLoading(true)
    try {
      const [a, b] = await Promise.all([
        fetch('/api/calls?type=list', { headers: authHeader() }),
        fetch('/api/calls?type=status', { headers: authHeader() }),
      ])
      const d = a.ok ? await a.json() : {}
      setCalls(Array.isArray(d.calls) ? d.calls : [])
      setStatus(b.ok ? await b.json() : null)
    } catch { toast('Could not load calls', 'error') }
    setLoading(false)
  }
  useEffect(() => { load() }, [])

  async function showTranscript(c) {
    setOpen(c); setTranscript('Loading…')
    try {
      const r = await fetch(`/api/calls?type=transcript&callId=${encodeURIComponent(c.call_id)}`, { headers: authHeader() })
      const d = r.ok ? await r.json() : {}
      setTranscript(d.transcript || '(no transcript)')
    } catch { setTranscript('(could not load)') }
  }

  const live = calls.filter(c => ['registered', 'ongoing'].includes(c.status)).length
  const done = calls.filter(c => c.outcome).length

  return (
    <div>
      <PageHeader title="AI Calls" subtitle={`${calls.length} calls · ${done} finished${live ? ` · ${live} in progress` : ''}`}>
        <Btn variant="secondary" onClick={load} disabled={loading}><RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Refresh</Btn>
      </PageHeader>

      {status && !status.configured && (
        <div className="card px-5 py-3 mb-4 bg-amber-50 border-amber-200 text-sm text-amber-800">
          Calling is not set up yet. The server needs <code>RETELL_API_KEY</code>, <code>RETELL_AGENT_ID</code> and <code>RETELL_FROM_NUMBER</code> in its <code>.env</code>
          {status.hasKey ? ' (key is present; agent id / number missing).' : ' (no key yet).'}
        </div>
      )}

      {loading ? (
        <div className="card p-16 text-center text-slate-400"><RefreshCw size={24} className="animate-spin mx-auto mb-3" />Loading…</div>
      ) : calls.length === 0 ? (
        <div className="card p-16"><Empty icon={Phone} title="No calls yet" sub="Use the 📞 button on a lead to start an AI call. Inbound calls to your Retell number appear here too." /></div>
      ) : (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[800px]">
              <thead><tr className="bg-slate-50 border-b border-slate-200">
                {['', 'Lead', 'Number', 'When', 'Length', 'Outcome', 'Mood', 'Summary', ''].map((h, i) => <th key={i} className="px-3 py-3 text-left text-xs font-bold text-slate-500 uppercase tracking-wide">{h}</th>)}
              </tr></thead>
              <tbody>
                {calls.map(c => {
                  const o = OUTCOME[c.outcome] || (c.outcome ? { label: c.outcome, cls: 'bg-slate-100 text-slate-500' } : null)
                  const inProgress = ['registered', 'ongoing'].includes(c.status)
                  return (
                    <tr key={c.call_id} className="border-b border-slate-100 hover:bg-slate-50 align-top">
                      <td className="px-3 py-3 text-slate-400">{c.direction === 'inbound' ? <PhoneIncoming size={14} /> : <PhoneOutgoing size={14} />}</td>
                      <td className="px-3 py-3"><div className="font-semibold text-slate-900">{c.lead_name || '—'}</div><div className="text-xs text-slate-400 font-mono">{c.lead_email || ''}</div></td>
                      <td className="px-3 py-3 font-mono text-xs text-slate-600">{c.direction === 'inbound' ? c.from_number : c.to_number}</td>
                      <td className="px-3 py-3 text-xs text-slate-500 whitespace-nowrap">{fmtDate(c.started_at || c.created_at)}</td>
                      <td className="px-3 py-3 text-xs text-slate-600">{inProgress ? <span className="text-emerald-600 font-semibold">● live</span> : dur(c.duration_ms)}</td>
                      <td className="px-3 py-3">{o ? <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${o.cls}`}>{o.label}</span> : <span className="text-xs text-slate-400">{inProgress ? '…' : (c.disconnection || c.status || '—')}</span>}</td>
                      <td className="px-3 py-3 text-xs text-slate-500">{c.sentiment || '—'}</td>
                      <td className="px-3 py-3 text-xs text-slate-600 max-w-md">{c.summary ? c.summary.slice(0, 160) + (c.summary.length > 160 ? '…' : '') : '—'}</td>
                      <td className="px-3 py-3 whitespace-nowrap">
                        {c.summary || c.duration_ms ? <button className="p-1.5 rounded-lg hover:bg-indigo-50 text-indigo-500" title="Transcript" onClick={() => showTranscript(c)}><FileText size={14} /></button> : null}
                        {c.recording_url ? <a className="p-1.5 inline-block rounded-lg hover:bg-emerald-50 text-emerald-600" title="Recording" href={c.recording_url} target="_blank" rel="noreferrer"><Play size={14} /></a> : null}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <Modal open={!!open} onClose={() => setOpen(null)} title={`Transcript — ${open?.lead_name || open?.to_number || ''}`} width="max-w-2xl">
        {open?.summary && <div className="mb-3 p-3 rounded-lg bg-slate-50 text-sm text-slate-700"><b>Summary:</b> {open.summary}</div>}
        <pre className="whitespace-pre-wrap text-xs text-slate-700 bg-white border border-slate-200 rounded-lg p-3 max-h-[60vh] overflow-auto">{transcript}</pre>
      </Modal>
    </div>
  )
}
