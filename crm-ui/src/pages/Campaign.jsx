import { useState, useRef } from 'react'
import { useCRM } from '../store'
import { Btn, Card, PageHeader, toast } from '../components/ui'
import RichEditor, { htmlToPlain } from '../components/RichEditor'
import { Play, Zap, PenLine, Paperclip, RefreshCw, ChevronLeft, ChevronRight } from 'lucide-react'

export default function Campaign() {
  const { leads, setLeads, profiles, settings, logActivity } = useCRM()
  const [mode, setMode]       = useState('ai')
  const [cfg, setCfg]         = useState({ batch:30, rate:2, fu1:2, fu2:4, target:'valid', filterVal:'', sender:'Pawan Kumar - Enginerds Tech Solution', replyTo:'contact@enginerds.in' })
  const [aiPrompt, setAiPrompt]     = useState('')
  const [variantCount, setVariantCount] = useState(5)
  const [variants, setVariants]     = useState([]) // [{subject, body}]
  const [variantIdx, setVariantIdx] = useState(0)
  const [customSubj, setCustomSubj] = useState('')
  const [customBody, setCustomBody] = useState('')
  const [attachments, setAttachments] = useState([{ type:'link', label:'', url:'' }])
  const [running, setRunning]   = useState(false)
  const [progress, setProgress] = useState(0)
  const [status, setStatus]     = useState('Ready to launch')
  const [log, setLog]           = useState([])
  const [genLoading, setGenLoading] = useState(false)
  const [previewMode, setPreviewMode] = useState(false)
  const bodyRef = useRef(null)

  const activeProfiles = profiles.filter(p => p.active)
  const [selectedSenders, setSelectedSenders] = useState(new Set(profiles.filter(p=>p.active).map(p=>p.user||p.email||'')))

  // Current preview variant
  const currentVariant = variants[variantIdx] || { subject: 'Subject will appear here', body: 'Click Generate Variants...' }

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

  // Build attachment footer text
  function buildAttachmentText() {
    const valid = attachments.filter(a => a.url && a.label)
    if (!valid.length) return ''
    return '\n\n' + valid.map(a => `📎 ${a.label}: ${a.url}`).join('\n')
  }

  async function getContent(lead, variantPool) {
    if (mode === 'custom') {
      if (!customSubj || !customBody) throw new Error('Custom mode: subject and body required')
      const r = s => s.replace(/\[Name\]/g, lead.name||'').replace(/\[Company\]/g, lead.company||'').replace(/\[Role\]/g, lead.role||'')
      return { subject: r(customSubj), body: r(customBody) + buildAttachmentText() }
    }
    // Use pre-generated variant pool (round-robin)
    if (variantPool && variantPool.length > 0) {
      const v = variantPool[Math.floor(Math.random() * variantPool.length)]
      // Personalize the variant for this specific lead
      const personalize = s => s
        .replace(/\[Name\]/g, lead.name||'').replace(/\[Company\]/g, lead.company||'')
        .replace(/\[Role\]/g, lead.role||'').replace(/their company/gi, lead.company||'your company')
        .replace(/the company/gi, lead.company||'your company')
      return { subject: personalize(v.subject), body: personalize(v.body) + buildAttachmentText() }
    }
    // Fallback: generate on the fly
    if (settings.openaiKey) {
      const res = await fetch('/api/generate-ai', { method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ name:lead.name, company:lead.company||'their company', role:lead.role||'', category:lead.category||'', apiKey:settings.openaiKey, customPrompt:aiPrompt, count:1 }) })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      return { subject: data.subject, body: data.body + buildAttachmentText() }
    }
    return {
      subject: `Quick idea for ${lead.company||'your company'}`,
      body: `Hi ${lead.name},\n\nI came across ${lead.company||'your company'} and noticed an opportunity to streamline your operations. At Enginerds Tech Solution, we help businesses like yours eliminate manual processes and gain real-time visibility.\n\nWould you be open to a quick 15-minute call this week?\n\nBest regards,\nPawan Kumar\nEnginerds Tech Solution` + buildAttachmentText()
    }
  }

  async function generateVariants() {
    if (!settings.openaiKey) { toast('Set NVIDIA API key in Settings', 'error'); return }
    setGenLoading(true)
    try {
      const res = await fetch('/api/generate-ai', { method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ name:'[Name]', company:'[Company]', role:'[Role]', category: cfg.filterVal || 'Business', apiKey:settings.openaiKey, customPrompt:aiPrompt, count: variantCount }) })
      const data = await res.json()
      if (!res.ok) {
        // Check if there's a fallback variant
        if (data.fallback) {
          toast('AI generation failed, using template', 'warn')
          const v = data.variants || [data.fallback]
          setVariants(v)
          setVariantIdx(0)
          return
        }
        throw new Error(data.error)
      }
      const v = data.variants || [{ subject: data.subject, body: data.body }]
      setVariants(v)
      setVariantIdx(0)
      toast(`Generated ${v.length} email variants ✓`, 'success')
    } catch(e) { 
      toast('Generation failed: '+e.message, 'error')
      console.error('AI generation error:', e)
    }
    setGenLoading(false)
  }

  async function sendOne(lead, subject, body, profile) {
    try {
      const endpoint = profile.type === 'gmail' ? '/api/send-email' : '/api/send-smtp'
      const payload = { leadId:lead.id, to:lead.email, subject, body, senderName:cfg.sender, replyTo:cfg.replyTo }
      if (profile.type === 'smtp') payload.smtpConfig = profile
      if (profile.type === 'gmail') payload.gmailUser = profile.user
      const res = await fetch(endpoint, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(payload) })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        addLog(`Send error for ${lead.name}: ${err.error || res.status}`, 'error')
        return false
      }
      const data = await res.json()
      if (data.skipped) { addLog(`Skipped ${lead.name} — unsubscribed`, 'warn'); return false }
      return true
    } catch(e) {
      addLog(`Network error for ${lead.name}: ${e.message}`, 'error')
      return false
    }
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

    // Pre-generate variant pool if AI mode and key available
    let variantPool = variants.length > 0 ? variants : []
    if (mode === 'ai' && settings.openaiKey && variantPool.length === 0) {
      addLog('Pre-generating email variants...', 'info')
      try {
        const res = await fetch('/api/generate-ai', { method:'POST', headers:{'Content-Type':'application/json'},
          body: JSON.stringify({ name:'[Name]', company:'[Company]', role:'[Role]', category: cfg.filterVal || 'Business', apiKey:settings.openaiKey, customPrompt:aiPrompt, count: Math.min(variantCount, 5) }) })
        const data = await res.json()
        if (res.ok) { variantPool = data.variants || [{ subject: data.subject, body: data.body }]; setVariants(variantPool) }
      } catch(e) { addLog('Variant pre-gen failed, will generate per-lead', 'warn') }
    }

    setRunning(true); setLog([]); setProgress(0)
    let processed = 0
    const updatedLeads = [...leads]

    for (let i = 0; i < targets.length; i++) {
      const l = targets[i]
      const leadIdx = updatedLeads.findIndex(x => x.id === l.id)
      const pct = Math.round(((i+1)/targets.length)*100)
      setProgress(pct); setStatus(`Processing: ${l.name}`)
      const profile = senderProfiles[processed % senderProfiles.length]
      const daysSince = d => d ? Math.floor((Date.now()-new Date(d))/86400000) : 0

      if (l.stage === '2' && l.lastSent && daysSince(l.lastSent) >= cfg.fu2) {
        const body = `Hi ${l.name},\n\nThis is my last follow-up. If the timing isn't right, no worries — but if you're open to a quick chat about improving operations at ${l.company||'your company'}, I'd love to connect.\n\nThanks,\nPawan Kumar\nEnginerds Tech Solution` + buildAttachmentText()
        const ok = await sendOne(l, `Following up one last time — ${l.company||'your company'}`, body, profile)
        if (ok) { updatedLeads[leadIdx] = {...updatedLeads[leadIdx], status:'SENT', stage:'3', lastSent:new Date().toISOString()}; addLog(`FU2 → ${l.name}`, 'warn'); processed++ }
      } else if (l.stage === '1' && l.lastSent && daysSince(l.lastSent) >= cfg.fu1) {
        const body = `Hi ${l.name},\n\nJust checking in — did you get a chance to look at my previous email about streamlining operations at ${l.company||'your company'}?\n\nHappy to hop on a quick call.\n\nRegards,\nPawan Kumar\nEnginerds Tech Solution` + buildAttachmentText()
        const ok = await sendOne(l, `Quick follow-up — ${l.company||'your company'}`, body, profile)
        if (ok) { updatedLeads[leadIdx] = {...updatedLeads[leadIdx], stage:'2', lastSent:new Date().toISOString(), status:'FOLLOW-UP', pipelineStage:'CONTACTED'}; addLog(`FU1 → ${l.name}`, 'info'); processed++ }
      } else if (['VALID','PERSONAL','ROLE-BASED','TYPO'].includes(l.status) || cfg.target === 'all' || cfg.target === 'hot') {
        if (['UNSUBSCRIBED','NOT-INTERESTED'].includes(l.pipelineStage)) continue;
        let subject = '', body = ''
        try { const r = await getContent(l, variantPool); subject = r.subject; body = r.body } catch(e) { addLog(`Content failed for ${l.name}: ${e.message}`, 'error'); continue }
        const ok = await sendOne(l, subject, body, profile)
        if (ok) {
          updatedLeads[leadIdx] = {...updatedLeads[leadIdx], status:'SENT', stage:'1', lastSent:new Date().toISOString(), lastEmail:body, pipelineStage:'CONTACTED'}
          addLog(`✓ Sent via ${profile.name} → ${l.name}`, 'success')
          logActivity(`Campaign: Sent to ${l.name}`); processed++
        } else { addLog(`✗ Failed → ${l.name}`, 'error') }
      }
      if (i < targets.length - 1 && cfg.rate > 0) await new Promise(r => setTimeout(r, cfg.rate * 1000))
    }

    setLeads(updatedLeads)
    
    // Save campaign to history
    const campaignData = {
      name: `Campaign - ${new Date().toLocaleDateString()}`,
      target: cfg.target,
      sender: cfg.sender,
      leads: targets.map(l => ({
        id: l.id,
        name: l.name,
        email: l.email,
        company: l.company,
        status: updatedLeads.find(ul => ul.id === l.id)?.status || l.status,
        subject: updatedLeads.find(ul => ul.id === l.id)?.lastEmail?.split('\n')[0] || ''
      })),
      stats: {
        sent: processed,
        failed: targets.length - processed,
        skipped: 0
      }
    }
    
    try {
      await fetch('/api/crm?type=save', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ leads: updatedLeads }) })
      await fetch('/api/crm?type=campaigns', { method:'POST', headers:{'Content-Type':'application/json', 'Authorization': `Bearer ${localStorage.getItem('crm_token')}`}, body: JSON.stringify(campaignData) })
    } catch(e) { console.warn('Save failed', e) }

    setStatus(`Done — ${processed} emails sent`); setRunning(false)
    toast(`Campaign complete: ${processed} sent`, 'success')
    logActivity(`Campaign finished: ${processed} sent`)
  }

  return (
    <div>
      <PageHeader title="AI Campaign" subtitle="Send personalized emails at scale">
        <Btn variant="primary" onClick={runCampaign} disabled={running}>
          <Play size={14} /> {running ? 'Running...' : 'Run Campaign'}
        </Btn>
      </PageHeader>

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
              <div><label className="label">Rate (secs)</label><input className="input" type="number" min="0" value={cfg.rate} onChange={e=>setCfg({...cfg,rate:+e.target.value})} /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><label className="label">FU1 Wait (days)</label><input className="input" type="number" value={cfg.fu1} onChange={e=>setCfg({...cfg,fu1:+e.target.value})} /></div>
              <div><label className="label">FU2 Wait (days)</label><input className="input" type="number" value={cfg.fu2} onChange={e=>setCfg({...cfg,fu2:+e.target.value})} /></div>
            </div>
            <div>
              <label className="label">Target Group</label>
              <select className="input" value={cfg.target} onChange={e=>setCfg({...cfg,target:e.target.value})}>
                <option value="valid">VALID Only</option><option value="all">All Contacts</option>
                <option value="followup">FOLLOW-UP Only</option><option value="hot">HOT Leads Only</option>
                <option value="category">Specific Category</option><option value="tag">Specific Tag</option>
              </select>
            </div>
            {(cfg.target==='category'||cfg.target==='tag') && (
              <input className="input" placeholder={`Enter ${cfg.target}...`} value={cfg.filterVal} onChange={e=>setCfg({...cfg,filterVal:e.target.value})} />
            )}
            <div>
              <label className="label">Active Senders (Round-Robin)</label>
              <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 space-y-2 max-h-28 overflow-y-auto">
                {profiles.length === 0 ? <p className="text-xs text-slate-400">No profiles. Add in Settings.</p> :
                  profiles.map(p => (
                    <label key={p.id} className="flex items-center gap-2 text-sm cursor-pointer">
                      <input type="checkbox" className="rounded" checked={selectedSenders.has(p.user||p.email||'')} onChange={e => {
                        const n = new Set(selectedSenders); e.target.checked ? n.add(p.user||p.email||'') : n.delete(p.user||p.email||''); setSelectedSenders(n)
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

            {/* Attachments */}
            <div>
              <label className="label flex items-center gap-1"><Paperclip size={11} /> Attachments / Links</label>
              <div className="space-y-2">
                {attachments.map((a, i) => (
                  <div key={i} className="flex gap-2">
                    <input className="input flex-1" placeholder="Label (e.g. Our Brochure)" value={a.label} onChange={e => { const n=[...attachments]; n[i]={...n[i],label:e.target.value}; setAttachments(n) }} />
                    <input className="input flex-1" placeholder="URL or link" value={a.url} onChange={e => { const n=[...attachments]; n[i]={...n[i],url:e.target.value}; setAttachments(n) }} />
                    <button className="text-red-400 hover:text-red-600 px-2" onClick={() => setAttachments(attachments.filter((_,j)=>j!==i))}>✕</button>
                  </div>
                ))}
                <button className="text-xs text-emerald-600 hover:underline" onClick={() => setAttachments([...attachments, {type:'link',label:'',url:''}])}>+ Add Link</button>
              </div>
            </div>
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
              <div className="flex gap-2">
                <div className="flex-1"><label className="label">Variants to Generate</label>
                  <select className="input" value={variantCount} onChange={e=>setVariantCount(+e.target.value)}>
                    {[1,3,5,7,10].map(n=><option key={n} value={n}>{n} variant{n>1?'s':''}</option>)}
                  </select>
                </div>
                <div className="flex-1"><label className="label">AI Focus / Instructions</label>
                  <input className="input" value={aiPrompt} onChange={e=>setAiPrompt(e.target.value)} placeholder="e.g. Focus on ROI, mention 60% time saving..." />
                </div>
              </div>
              <Btn variant="secondary" size="sm" onClick={generateVariants} disabled={genLoading}>
                {genLoading ? <><RefreshCw size={12} className="animate-spin" /> Generating...</> : <><Zap size={12} /> Generate {variantCount} Variants</>}
              </Btn>
              {variants.length > 0 && (
                <div className="bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2 text-xs text-emerald-700 font-medium">
                  ✓ {variants.length} variants ready — will rotate randomly during campaign
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-3">
              <div><label className="label">Subject Line</label>
                <input className="input" value={customSubj} onChange={e=>setCustomSubj(e.target.value)} placeholder="Quick idea for [Company]" />
              </div>
              <div>
                <label className="label">Email Body</label>
                <RichEditor
                  value={customBody}
                  onChange={html => setCustomBody(htmlToPlain(html))}
                  placeholder={"Hi [Name],\n\n...\n\nBest regards,\nPawan Kumar\nEnginerds Tech Solution"}
                  minHeight={160}
                />
              </div>
              <div className="flex gap-2 flex-wrap">
                {['[Name]','[Company]','[Role]'].map(v => (
                  <button key={v} className="text-xs bg-slate-100 hover:bg-slate-200 text-slate-600 px-2 py-1 rounded-md transition-colors"
                    onClick={() => setCustomBody(b => b + v)}>+{v}</button>
                ))}
              </div>
            </div>
          )}

          {/* Variant Preview */}
          {(variants.length > 0 || mode === 'custom') && (
            <div className="mt-4">
              <div className="flex items-center justify-between mb-2">
                <label className="label mb-0">Preview {variants.length > 1 ? `(Variant ${variantIdx+1}/${variants.length})` : ''}</label>
                {variants.length > 1 && (
                  <div className="flex gap-1">
                    <button className="p-1 rounded hover:bg-slate-100" onClick={()=>setVariantIdx(i=>Math.max(0,i-1))}><ChevronLeft size={14}/></button>
                    <button className="p-1 rounded hover:bg-slate-100" onClick={()=>setVariantIdx(i=>Math.min(variants.length-1,i+1))}><ChevronRight size={14}/></button>
                  </div>
                )}
              </div>
              <div className="bg-slate-50 border border-slate-200 rounded-lg overflow-hidden">
                <div className="px-3 py-2 border-b border-slate-200 bg-white">
                  <p className="text-xs font-mono text-slate-500">Subject: <span className="text-slate-800 font-semibold">{mode==='custom' ? customSubj : currentVariant.subject}</span></p>
                </div>
                <div className="p-3 text-sm text-slate-700 whitespace-pre-wrap max-h-52 overflow-y-auto leading-relaxed">
                  {mode==='custom' ? customBody : currentVariant.body}
                  {buildAttachmentText() && <span className="text-blue-600">{buildAttachmentText()}</span>}
                </div>
              </div>
              {variants.length > 0 && (
                <button className="text-xs text-slate-400 hover:text-slate-600 mt-1" onClick={()=>{ const v=variants[variantIdx]; if(v){ setCustomSubj(v.subject); setCustomBody(v.body); setMode('custom') }}}>
                  ✏ Edit this variant in Custom mode
                </button>
              )}
            </div>
          )}
        </Card>
      </div>

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
