import { useState } from 'react'
import { useCRM } from '../store'
import { enrichLead } from '../utils'
import { Btn, Card, PageHeader, toast } from '../components/ui'
import { Play, Zap, PenLine } from 'lucide-react'

export default function Campaign() {
  const { leads, setLeads, profiles, settings, logActivity, pushToRedis } = useCRM()
  const [mode, setMode]         = useState('ai') // 'ai' | 'custom'
  const [cfg, setCfg]           = useState({ batch:30, rate:5, fu1:2, fu2:4, target:'valid', filterVal:'', sender:'Pawan Kumar - Enginerds Tech Solution', replyTo:'contact@enginerds.in', subjectAlt:'' })
  const [aiPrompt, setAiPrompt] = useState('')
  const [customSubj, setCustomSubj] = useState('')
  const [customBody, setCustomBody] = useState('')
  const [prevSubj, setPrevSubj] = useState('Subject will appear here')
  const [prevBody, setPrevBody] = useState('Click Generate Preview...')
  const [running, setRunning]   = useState(false)
  const [progress, setProgress] = useState(0)
  const [status, setStatus]     = useState('Ready to launch')
  const [log, setLog]           = useState([])
  const [genLoading, setGenLoading] = useState(false)

  const activeProfiles = profiles.filter(p => p.active)
  const [selectedSenders, setSelectedSenders] = useState(new Set(profiles.filter(p=>p.active).map(p=>p.user||p.email||'')))

  function getTargets() {
    const fv = cfg.filterVal.trim().toLowerCase()
    if (cfg.target === 'all')      return leads.slice()
    if (cfg.target === 'valid')    return leads.filter(l => l.status === 'VALID')
    if (cfg.target === 'followup') return leads.filter(l => l.status === 'FOLLOW-UP')
    if (cfg.target === 'hot')      return leads.filter(l => l.pipelineStage === 'HOT' || (l.opens >= 2 || l.clicks >= 1))
    if (cfg.target === 'category') return leads.filter(l => (l.category||'').toLowerCase() === fv)
    if (cfg.target === 'tag')      return leads.filter(l => (l.tags||[]).some(t => t.toLowerCase() === fv))
    return []
  }

  async function getContent(lead) {
    if (mode === 'custom') {
      if (!customSubj || !customBody) throw new Error('Custom mode: subject and body required')
      const r = s => s.replace(/\[Name\]/g, lead.name||'').replace(/\[Company\]/g, lead.company||'').replace(/\[Role\]/g, lead.role||'')
      return { subject: r(customSubj), body: r(customBody) }
    }
    if (settings.openaiKey) {
      const res = await fetch('/api/generate-ai', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ name:lead.name, company:lead.company||'their company', role:lead.role||'', category:lead.category||'', apiKey:settings.openaiKey, customPrompt:aiPrompt }) })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      return data
    }
    return { subject: `Quick idea for ${lead.company||'your company'}`, body: `Hi ${lead.name},\n\nI came across ${lead.company||'your company'} and was impressed by what you're building. At Enginerds Tech Solution, we specialize in ERP & SaaS solutions.\n\nWould you be open to a quick 15-minute call?\n\nBest,\nPawan Kumar\nEnginerds Tech Solution` }
  }

  async function sendOne(lead, subject, body, profile) {
    try {
      const endpoint = profile.type === 'gmail' ? '/api/send-email' : '/api/send-smtp'
      const payload = { leadId:lead.id, to:lead.email, subject, body, senderName:cfg.sender, replyTo:cfg.replyTo }
      if (profile.type === 'smtp') payload.smtpConfig = profile
      if (profile.type === 'gmail') payload.gmailUser = profile.user // multi-Gmail support
      const res = await fetch(endpoint, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(payload) })
      return res.ok
    } catch { return false }
  }

  function addLog(msg, type='info') {
    const colors = { success:'text-emerald-600', error:'text-red-500', info:'text-blue-500', warn:'text-amber-500' }
    setLog(prev => [{ msg, color: colors[type], time: new Date().toLocaleTimeString() }, ...prev].slice(0, 100))
  }

  async function runCampaign() {
    const senderProfiles = activeProfiles.filter(p => selectedSenders.has(p.user||p.email||''))
    if (!senderProfiles.length) { toast('Select at least one sender', 'error'); return }
    const targets = getTargets().slice(0, cfg.batch)
    if (!targets.length) { toast('No leads for selected group', 'info'); return }

    setRunning(true); setLog([]); setProgress(0)
    let processed = 0

    for (let i = 0; i < targets.length; i++) {
      const l = targets[i]
      const pct = Math.round(((i+1)/targets.length)*100)
      setProgress(pct); setStatus(`Processing: ${l.name}`)
      const profile = senderProfiles[processed % senderProfiles.length]

      const daysSince = d => d ? Math.floor((Date.now()-new Date(d))/86400000) : 0

      if (l.stage === '2' && l.lastSent && daysSince(l.lastSent) >= cfg.fu2) {
        const body = `Hi ${l.name},\n\nThis is my last follow-up. If the timing isn't right, no worries — but if you're open to a quick chat, I'd love to connect.\n\nThanks,\nPawan Kumar\nEnginerds Tech Solution`
        const ok = await sendOne(l, `Quick idea for ${l.company||'your company'}`, body, profile)
        if (ok) { setLeads(prev => prev.map(x => x.id===l.id ? {...x,status:'SENT',stage:'3',lastSent:new Date().toISOString()} : x)); addLog(`FU2 sent → ${l.name}`, 'warn'); processed++ }
      } else if (l.stage === '1' && l.lastSent && daysSince(l.lastSent) >= cfg.fu1) {
        const body = `Hi ${l.name},\n\nJust checking in — did you get a chance to look at my previous email?\n\nHappy to hop on a quick call.\n\nRegards,\nPawan Kumar\nEnginerds Tech Solution`
        const ok = await sendOne(l, `Following up — ${l.company||'your company'}`, body, profile)
        if (ok) { setLeads(prev => prev.map(x => x.id===l.id ? {...x,stage:'2',lastSent:new Date().toISOString(),status:'FOLLOW-UP',pipelineStage:'CONTACTED'} : x)); addLog(`FU1 sent → ${l.name}`, 'info'); processed++ }
      } else if (l.status === 'VALID') {
        let subject = `Quick idea for ${l.company||'your company'}`
        let body = ''
        try { const r = await getContent(l); subject = r.subject; body = r.body } catch(e) { addLog(`Content failed for ${l.name}: ${e.message}`, 'error') }
        if (cfg.subjectAlt && processed % 2 === 1) subject = cfg.subjectAlt.replace('[Company]', l.company||'your company')
        if (!body) { addLog(`Skipped ${l.name} — no content`, 'warn'); continue }
        const ok = await sendOne(l, subject, body, profile)
        if (ok) {
          setLeads(prev => prev.map(x => x.id===l.id ? {...x,status:'SENT',stage:'1',lastSent:new Date().toISOString(),lastEmail:body,pipelineStage:'CONTACTED'} : x))
          addLog(`✓ Sent via ${profile.name} → ${l.name}`, 'success')
          logActivity(`Campaign: Sent to ${l.name}`); processed++
        } else { addLog(`✗ Failed → ${l.name}`, 'error') }
      }
      pushToRedis()
      if (i < targets.length - 1) await new Promise(r => setTimeout(r, cfg.rate * 1000))
    }
    setStatus(`Done — ${processed} emails sent`); setRunning(false)
    toast(`Campaign complete: ${processed} sent`, 'success')
    logActivity(`Campaign finished: ${processed} sent`)
  }

  async function generatePreview() {
    if (mode === 'custom') {
      setPrevSubj(customSubj || 'Subject will appear here')
      setPrevBody(customBody || 'Body will appear here')
      return
    }
    if (!settings.openaiKey) { toast('Set NVIDIA API key in Settings', 'error'); return }
    setGenLoading(true)
    try {
      const res = await fetch('/api/generate-ai', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ name:'John Doe', company:'Acme Corp', role:'Founder', category:'SaaS', apiKey:settings.openaiKey, customPrompt:aiPrompt }) })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setPrevSubj(data.subject); setPrevBody(data.body)
    } catch(e) { toast('Preview failed: '+e.message, 'error') }
    setGenLoading(false)
  }

  return (
    <div>
      <PageHeader title="AI Campaign" subtitle="Send personalized emails at scale">
        <Btn variant="primary" onClick={runCampaign} disabled={running}>
          <Play size={14} /> {running ? 'Running...' : 'Run Campaign'}
        </Btn>
      </PageHeader>

      {/* Progress bar */}
      {(running || progress > 0) && (
        <div className="card p-4 mb-6">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-slate-700">{status}</span>
            <span className="text-sm font-bold text-emerald-600">{progress}%</span>
          </div>
          <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
            <div className="h-full bg-gradient-to-r from-emerald-400 to-emerald-600 rounded-full transition-all duration-500" style={{ width: `${progress}%` }} />
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-6">
        {/* Config */}
        <Card className="p-5">
          <h3 className="text-sm font-bold text-slate-900 mb-4">Campaign Config</h3>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div><label className="label">Batch Limit</label><input className="input" type="number" value={cfg.batch} onChange={e=>setCfg({...cfg,batch:+e.target.value})} /></div>
              <div><label className="label">Rate (secs)</label><input className="input" type="number" value={cfg.rate} onChange={e=>setCfg({...cfg,rate:+e.target.value})} /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><label className="label">FU1 Wait (days)</label><input className="input" type="number" value={cfg.fu1} onChange={e=>setCfg({...cfg,fu1:+e.target.value})} /></div>
              <div><label className="label">FU2 Wait (days)</label><input className="input" type="number" value={cfg.fu2} onChange={e=>setCfg({...cfg,fu2:+e.target.value})} /></div>
            </div>
            <div>
              <label className="label">Target Group</label>
              <select className="input" value={cfg.target} onChange={e=>setCfg({...cfg,target:e.target.value})}>
                <option value="valid">VALID Only</option>
                <option value="all">All Contacts</option>
                <option value="followup">FOLLOW-UP Only</option>
                <option value="hot">HOT Leads Only</option>
                <option value="category">Specific Category</option>
                <option value="tag">Specific Tag</option>
              </select>
            </div>
            {(cfg.target==='category'||cfg.target==='tag') && (
              <input className="input" placeholder={`Enter ${cfg.target}...`} value={cfg.filterVal} onChange={e=>setCfg({...cfg,filterVal:e.target.value})} />
            )}
            <div>
              <label className="label">Active Senders</label>
              <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 space-y-2 max-h-28 overflow-y-auto">
                {profiles.length === 0 ? <p className="text-xs text-slate-400">No profiles. Add in Settings.</p> :
                  profiles.map(p => (
                    <label key={p.id} className="flex items-center gap-2 text-sm cursor-pointer">
                      <input type="checkbox" className="rounded" checked={selectedSenders.has(p.user||p.email||'')} onChange={e => {
                        const n = new Set(selectedSenders)
                        e.target.checked ? n.add(p.user||p.email||'') : n.delete(p.user||p.email||'')
                        setSelectedSenders(n)
                      }} />
                      <span className="font-medium text-slate-700">{p.name}</span>
                      <span className="text-xs text-slate-400">({p.type.toUpperCase()})</span>
                    </label>
                  ))
                }
              </div>
            </div>
            <div><label className="label">Sender Name</label><input className="input" value={cfg.sender} onChange={e=>setCfg({...cfg,sender:e.target.value})} /></div>
            <div><label className="label">Reply-to Email</label><input className="input" value={cfg.replyTo} onChange={e=>setCfg({...cfg,replyTo:e.target.value})} /></div>
          </div>
        </Card>

        {/* Email Composer */}
        <Card className="p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-bold text-slate-900">Email Composer</h3>
            <div className="flex gap-1 bg-slate-100 rounded-lg p-1">
              <button onClick={() => setMode('ai')} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition-all ${mode==='ai' ? 'bg-white shadow-sm text-emerald-700' : 'text-slate-500 hover:text-slate-700'}`}>
                <Zap size={12} /> AI
              </button>
              <button onClick={() => setMode('custom')} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition-all ${mode==='custom' ? 'bg-white shadow-sm text-blue-700' : 'text-slate-500 hover:text-slate-700'}`}>
                <PenLine size={12} /> Custom
              </button>
            </div>
          </div>

          {mode === 'ai' ? (
            <div className="space-y-3">
              <div><label className="label">A/B Subject Override (optional)</label><input className="input" value={cfg.subjectAlt} onChange={e=>setCfg({...cfg,subjectAlt:e.target.value})} placeholder="Idea for [Company]" /></div>
              <div><label className="label">AI Instructions</label><textarea className="input resize-y min-h-[80px]" value={aiPrompt} onChange={e=>setAiPrompt(e.target.value)} placeholder="e.g. Focus on ERP for manufacturing, mention ROI..." /></div>
            </div>
          ) : (
            <div className="space-y-3">
              <div><label className="label">Subject Line</label><input className="input" value={customSubj} onChange={e=>setCustomSubj(e.target.value)} placeholder="Quick idea for [Company]" /></div>
              <div><label className="label">Email Body</label><textarea className="input resize-y min-h-[120px]" value={customBody} onChange={e=>setCustomBody(e.target.value)} placeholder={"Hi [Name],\n\n...\n\nBest,\nPawan Kumar"} /></div>
              <div className="flex gap-2">
                {['[Name]','[Company]','[Role]'].map(v => (
                  <button key={v} className="text-xs bg-slate-100 hover:bg-slate-200 text-slate-600 px-2 py-1 rounded-md transition-colors" onClick={() => setCustomBody(b => b + v)}>+{v}</button>
                ))}
              </div>
            </div>
          )}

          <Btn variant="secondary" size="sm" className="mt-3 mb-4" onClick={generatePreview} disabled={genLoading}>
            {genLoading ? 'Generating...' : '✦ Generate Preview'}
          </Btn>

          <div className="bg-slate-50 border border-slate-200 rounded-lg overflow-hidden">
            <div className="px-3 py-2 border-b border-slate-200 bg-white">
              <p className="text-xs font-mono text-slate-500">Subject: <span className="text-slate-800">{prevSubj}</span></p>
            </div>
            <div className="p-3 text-sm text-slate-700 whitespace-pre-wrap max-h-48 overflow-y-auto leading-relaxed">{prevBody}</div>
          </div>
        </Card>
      </div>

      {/* Campaign Log */}
      {log.length > 0 && (
        <Card className="p-5 mt-6">
          <h3 className="text-sm font-bold text-slate-900 mb-3">Campaign Log</h3>
          <div className="space-y-1 max-h-48 overflow-y-auto font-mono text-xs">
            {log.map((entry, i) => (
              <div key={i} className={`flex gap-3 ${entry.color}`}>
                <span className="text-slate-400 flex-shrink-0">[{entry.time}]</span>
                <span>{entry.msg}</span>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  )
}
