import { useState, useRef, useEffect } from 'react'
import { useCRM } from '../store'
import { Btn, Card, PageHeader, toast } from '../components/ui'
import RichEditor, { htmlToPlain } from '../components/RichEditor'
import { Play, Zap, RefreshCw, ChevronLeft, ChevronRight, Plus, X, Calendar } from 'lucide-react'

export default function Campaign() {
  const { leads, setLeads, profiles, settings, logActivity } = useCRM()
  const [mode, setMode]       = useState('ai')
  const [cfg, setCfg]         = useState({ batch:30, rate:2, target:'valid', filterVal:'', sender:'Pawan Kumar - Enginerds Tech Solution', replyTo:'contact@enginerds.in' })

  // Campaign Brief — the AI brain context
  const [brief, setBrief] = useState({
    product:      '',
    industries:   '',
    problems:     '',
    solutions:    '',
    technologies: '',
  })

  const [aiPrompt, setAiPrompt]         = useState('')
  const [variantCount, setVariantCount] = useState(5)
  const [variants, setVariants]         = useState([])
  const [variantIdx, setVariantIdx]     = useState(0)
  const [customSubj, setCustomSubj]     = useState('')
  const [customBody, setCustomBody]     = useState('')
  const [attachments, setAttachments]   = useState([{ type:'link', label:'', url:'' }])
  const [running, setRunning]           = useState(false)
  const [progress, setProgress]         = useState(0)
  const [status, setStatus]             = useState('Ready to launch')
  const [log, setLog]                   = useState([])
  const [genLoading, setGenLoading]     = useState(false)
  const [delivScore, setDelivScore]     = useState(null) // { score, rating, checks }
  const [delivLoading, setDelivLoading] = useState(false)
  const [campaignName, setCampaignName] = useState(`Campaign ${new Date().toLocaleDateString('en-GB')}`)
  const bodyRef = useRef(null)

  // Follow-up mode — detect ?followup=campId in URL
  const [followupIds, setFollowupIds] = useState(null) // Set of lead IDs to target
  const [followupInfo, setFollowupInfo] = useState('')
  useEffect(() => {
    const sp = new URLSearchParams(window.location.search)
    const fid = sp.get('followup')
    if (fid) {
      fetch(`/api/campaigns?id=${fid}`)
        .then(r => r.json())
        .then(d => {
          const zeroOpen = d.leads?.filter(l => !l.opens || l.opens === 0).map(l => l.lead_id) || []
          setFollowupIds(new Set(zeroOpen))
          setFollowupInfo(`Follow-up mode: ${zeroOpen.length} zero-open leads from "${d.name}"`)
          toast(`Follow-up: targeting ${zeroOpen.length} non-openers`, 'info')
        })
        .catch(() => {})
    }
  }, [])

  // Scheduling state
  const [scheduleTime, setScheduleTime] = useState('')
  const [scheduled, setScheduled]       = useState(false)
  const scheduleTimerRef = useRef(null)

  const activeProfiles = profiles.filter(p => p.active)
  const [selectedSenders, setSelectedSenders] = useState(new Set(profiles.filter(p=>p.active).map(p=>p.user||p.email||'')))

  const currentVariant = variants[variantIdx] || { subject: 'Subject will appear here', body: 'Fill the Campaign Brief and click Generate Variants...' }

  function getTargets() {
    // Follow-up mode overrides the target filter
    if (followupIds) return leads.filter(l => followupIds.has(l.id))
    const fv = cfg.filterVal.trim().toLowerCase()
    if (cfg.target === 'all')      return leads.slice()
    if (cfg.target === 'valid')    return leads.filter(l => l.status === 'VALID')
    if (cfg.target === 'followup') return leads.filter(l => l.status === 'FOLLOW-UP')
    if (cfg.target === 'hot')      return leads.filter(l => l.pipelineStage === 'HOT' || (l.opens >= 2 || l.clicks >= 1))
    if (cfg.target === 'category') return leads.filter(l => (l.category||'').toLowerCase() === fv)
    if (cfg.target === 'tag')      return leads.filter(l => (l.tags||[]).some(t => t.toLowerCase() === fv))
    return []
  }

  function buildAttachmentText() {
    const valid = attachments.filter(a => a.url && a.label)
    if (!valid.length) return ''
    return '\n\n' + valid.map(a => `📎 ${a.label}: ${a.url}`).join('\n')
  }

  async function getContent(lead, variantPool, index = 0) {
    if (mode === 'custom') {
      const r = s => s.replace(/\[Name\]/g, lead.name||'').replace(/\[Company\]/g, lead.company||'').replace(/\[Role\]/g, lead.role||'')
      return { subject: r(customSubj), body: r(customBody) + buildAttachmentText() }
    }
    if (variantPool && variantPool.length > 0) {
      const v = variantPool[index % variantPool.length]
      const personalize = s => s
        .replace(/\[Name\]/g, lead.name||'').replace(/\[Company\]/g, lead.company||'')
        .replace(/\[Role\]/g, lead.role||'').replace(/their company/gi, lead.company||'your company')
      return { subject: personalize(v.subject), body: personalize(v.body) + buildAttachmentText() }
    }
    return {
      subject: `Question for ${lead.company||'your business'}`,
      body: `Hi ${lead.name},\n\nI noticed ${lead.company||'your business'} and thought we could help with your tech operations.\n\nBest regards,\nPawan Kumar\nEnginerds Tech Solution` + buildAttachmentText()
    }
  }

  async function generateVariants() {
    if (!settings.openaiKey) { toast('Set NVIDIA API key in Settings first', 'error'); return }
    if (!brief.product.trim()) { toast('Fill in the Product/Service field in Campaign Brief', 'error'); return }
    setGenLoading(true)
    try {
      const res = await fetch('/api/ops?type=generate-ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name:         '[Name]',
          company:      '[Company]',
          role:         '[Role]',
          category:     cfg.filterVal || brief.industries || 'Business',
          apiKey:       settings.openaiKey,
          customPrompt: aiPrompt,
          count:        variantCount,
          brief,
        })
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'AI generation failed')
      const v = data.variants || [{ subject: data.subject, body: data.body }]
      setVariants(v)
      setVariantIdx(0)
      toast(`Generated ${v.length} variants ✓`, 'success')
    } catch(e) {
      toast('Generation failed: ' + e.message, 'error')
    }
    setGenLoading(false)
  }

  async function checkDeliverability() {
    const subject = mode === 'custom' ? customSubj : (currentVariant.subject || '')
    const body    = mode === 'custom' ? customBody  : (currentVariant.body    || '')
    if (!subject && !body) { toast('Generate or write an email first', 'info'); return }
    setDelivLoading(true)
    try {
      const res = await fetch('/api/ops?type=deliverability', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subject, body })
      })
      const data = await res.json()
      setDelivScore(data)
    } catch(e) { toast('Check failed: ' + e.message, 'error') }
    setDelivLoading(false)
  }

  async function sendOne(lead, subject, body, profile, campaignId) {
    try {
      const endpoint = profile.type === 'gmail' ? '/api/send-email' : '/api/send-smtp'
      const payload = { leadId:lead.id, to:lead.email, subject, body, senderName:cfg.sender, replyTo:cfg.replyTo, campaignId }
      if (profile.type === 'smtp') payload.smtpConfig = profile
      if (profile.type === 'gmail') payload.gmailUser = profile.user
      const res = await fetch(endpoint, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(payload) })
      const data = await res.json().catch(() => ({}))
      if (data.bounced) return { ok: false, bounced: true }
      if (data.skipped) return { ok: false, skipped: true }
      return { ok: res.ok }
    } catch(e) { return { ok: false } }
  }

  function addLog(msg, type='info') {
    const colors = { success:'text-emerald-600', error:'text-red-500', info:'text-blue-500', warn:'text-amber-500' }
    setLog(prev => [{ msg, color: colors[type], time: new Date().toLocaleTimeString() }, ...prev].slice(0, 50))
  }

  async function runCampaign() {
    const senderProfiles = activeProfiles.filter(p => selectedSenders.has(p.user||p.email||''))
    const targets = getTargets().slice(0, cfg.batch)
    if (!senderProfiles.length || !targets.length) { toast('Missing senders or leads', 'error'); return }

    setRunning(true); setLog([]); setProgress(0)
    const campaignId = `camp_${Date.now()}`
    let processed = 0
    const updatedLeads = [...leads]
    const campaignDataLeads = []

    const today = new Date().toISOString().split('T')[0]
    for (let i = 0; i < targets.length; i++) {
      const l = targets[i]
      setStatus(`Processing: ${l.name}`)
      setProgress(Math.round(((i + 1) / targets.length) * 100))

      const profile    = senderProfiles[i % senderProfiles.length]
      const vPool      = variants.length > 0 ? variants : null
      const vData      = await getContent(l, vPool, i)
      const { subject, body } = vData
      const varIdx     = i % (variants.length || 1)

      // Daily send cap check
      const capKey   = `warmup:${profile.id}:${today}`
      const sentToday = parseInt(localStorage.getItem(capKey) || '0')
      const dailyCap  = profile.dailyCap || 50
      if (sentToday >= dailyCap) {
        addLog(`⚠ Daily cap (${dailyCap}) hit for ${profile.name} — skipping ${l.name}`, 'warn')
        campaignDataLeads.push({ id:l.id, name:l.name, email:l.email, company:l.company, status:'SKIPPED', subject:'', body:'', variantIndex:varIdx })
        continue
      }

      const result = await sendOne(l, subject, body, profile, campaignId)
      if (result.ok) {
        addLog(`✓ Sent to ${l.name} via ${profile.user||profile.name} (variant ${varIdx + 1})`, 'success')
        processed++
        localStorage.setItem(capKey, String(sentToday + 1))
        const idx = updatedLeads.findIndex(x => x.id === l.id)
        if (idx !== -1) updatedLeads[idx] = { ...updatedLeads[idx], status:'SENT', lastSent:new Date().toISOString() }
        campaignDataLeads.push({ id:l.id, name:l.name, email:l.email, company:l.company, status:'SENT', subject, body, variantIndex: varIdx })
      } else if (result.bounced) {
        addLog(`⚡ BOUNCED: ${l.name} <${l.email}>`, 'warn')
        const idx = updatedLeads.findIndex(x => x.id === l.id)
        if (idx !== -1) updatedLeads[idx] = { ...updatedLeads[idx], status:'BOUNCED' }
        campaignDataLeads.push({ id:l.id, name:l.name, email:l.email, company:l.company, status:'BOUNCED', subject, body, variantIndex: varIdx })
      } else {
        addLog(`✗ Failed for ${l.name}`, 'error')
        campaignDataLeads.push({ id:l.id, name:l.name, email:l.email, company:l.company, status:'FAILED', subject, body, variantIndex: varIdx })
      }

      if (i < targets.length - 1 && cfg.rate > 0) await new Promise(r => setTimeout(r, cfg.rate * 1000))
    }

    setLeads(updatedLeads)

    const campaignData = {
      id:       campaignId,
      name:     campaignName,
      target:   cfg.target,
      sender:   cfg.sender,
      brief,
      variants, // store full variant pool for AI training
      stats:    { sent: processed, failed: targets.length - processed, skipped: 0 },
      leads:    campaignDataLeads,
    }
    await fetch('/api/campaigns', {
      method: 'POST',
      headers: { 'Content-Type':'application/json', 'Authorization': `Bearer ${localStorage.getItem('crm_token')}` },
      body: JSON.stringify(campaignData)
    })

    setRunning(false)
    setStatus(`Done — ${processed} sent`)
    toast(`Campaign complete — ${processed}/${targets.length} sent`, 'success')
  }

  function scheduleCampaign() {
    if (!scheduleTime) { toast('Pick a date and time first', 'error'); return }
    const ms = new Date(scheduleTime).getTime() - Date.now()
    if (ms < 0) { toast('Schedule time must be in the future', 'error'); return }
    scheduleTimerRef.current = setTimeout(() => { runCampaign(); setScheduled(false) }, ms)
    setScheduled(true)
    toast(`Scheduled for ${new Date(scheduleTime).toLocaleString()} — keep this tab open`, 'success')
  }

  function cancelSchedule() {
    if (scheduleTimerRef.current) clearTimeout(scheduleTimerRef.current)
    setScheduled(false)
    toast('Schedule cancelled', 'info')
  }

  return (
    <div className="space-y-6">
      <PageHeader title="AI Campaign" subtitle="Send personalized sales emails at scale">
        <div className="flex items-center gap-2 flex-wrap">
          <input type="datetime-local" className="input text-xs py-1.5" value={scheduleTime} onChange={e=>setScheduleTime(e.target.value)} disabled={scheduled||running} title="Schedule campaign for later" />
          {!scheduled
            ? <Btn variant="secondary" onClick={scheduleCampaign} disabled={running||!scheduleTime}><Calendar size={13}/> Schedule</Btn>
            : <Btn variant="danger" size="sm" onClick={cancelSchedule}>✕ Cancel Schedule</Btn>
          }
          <Btn variant="secondary" onClick={checkDeliverability} disabled={delivLoading||running}>
            {delivLoading ? '...' : '🎯 Check Score'}
          </Btn>
          <Btn variant="primary" onClick={runCampaign} disabled={running||scheduled}>
            <Play size={14} /> {running ? 'Running...' : 'Run Campaign'}
          </Btn>
        </div>
      </PageHeader>

      {delivScore && (
        <div className={`rounded-xl border p-4 ${delivScore.score >= 8 ? 'bg-emerald-50 border-emerald-200' : delivScore.score >= 6 ? 'bg-amber-50 border-amber-200' : 'bg-red-50 border-red-200'}`}>
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-3">
              <span className="text-2xl font-black">{delivScore.score}/10</span>
              <div>
                <div className={`font-bold text-sm ${delivScore.score >= 8 ? 'text-emerald-700' : delivScore.score >= 6 ? 'text-amber-700' : 'text-red-700'}`}>
                  Deliverability: {delivScore.rating}
                </div>
                <div className="text-xs text-slate-500">{delivScore.wordCount} words</div>
              </div>
            </div>
            <button onClick={() => setDelivScore(null)} className="text-slate-400 hover:text-slate-600 text-lg">✕</button>
          </div>
          <div className="grid grid-cols-1 gap-1">
            {delivScore.checks.map((c, i) => (
              <div key={i} className={`flex items-start gap-2 text-xs py-1 ${c.pass ? 'text-emerald-700' : 'text-red-700'}`}>
                <span className="flex-shrink-0 mt-0.5">{c.pass ? '✅' : '❌'}</span>
                <span>{c.label}{c.impact < 0 ? ` (${c.impact})` : ''}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {followupInfo && (
        <div className="bg-blue-50 border border-blue-200 rounded-xl px-4 py-3 text-sm text-blue-800 flex items-center gap-2">
          <span>↩</span>
          <span className="font-medium">{followupInfo}</span>
          <button className="ml-auto text-blue-400 hover:text-blue-600" onClick={() => { setFollowupIds(null); setFollowupInfo(''); window.history.replaceState({}, '', '/campaign') }}>✕ Clear</button>
        </div>
      )}

      {scheduled && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-sm text-amber-800 flex items-center gap-2">
          <Calendar size={14} />
          <span>Campaign scheduled for <strong>{new Date(scheduleTime).toLocaleString()}</strong> — keep this browser tab open</span>
        </div>
      )}

      {(running || progress > 0) && (
        <Card className="p-4 border-emerald-100 bg-emerald-50/30">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-emerald-800">{status}</span>
            <span className="text-sm font-bold text-emerald-600">{progress}%</span>
          </div>
          <div className="h-2 bg-white rounded-full overflow-hidden border border-emerald-100">
            <div className="h-full bg-emerald-500 rounded-full transition-all duration-500" style={{ width: `${progress}%` }} />
          </div>
        </Card>
      )}

      {/* Campaign Brief — feeds the AI */}
      <Card className="p-5">
        <h3 className="text-sm font-bold text-slate-900 mb-1">Campaign Brief <span className="text-xs font-normal text-emerald-600 ml-2">— AI uses this to write sales emails</span></h3>
        <p className="text-xs text-slate-400 mb-4">Fill this in before generating variants. The more detail you give, the sharper the pitch.</p>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="label">Product / Service Name <span className="text-red-400">*</span></label>
            <input className="input" value={brief.product} onChange={e=>setBrief({...brief,product:e.target.value})} placeholder="e.g. Custom ERP Software, IT Outsourcing, Cloud Migration" />
          </div>
          <div>
            <label className="label">Target Industries</label>
            <input className="input" value={brief.industries} onChange={e=>setBrief({...brief,industries:e.target.value})} placeholder="e.g. Manufacturing, Healthcare, Retail, Logistics" />
          </div>
          <div>
            <label className="label">Problems We Solve</label>
            <textarea className="input resize-none" rows={2} value={brief.problems} onChange={e=>setBrief({...brief,problems:e.target.value})} placeholder="e.g. Manual data entry errors, delayed reports, no real-time inventory visibility" />
          </div>
          <div>
            <label className="label">Our Solutions</label>
            <textarea className="input resize-none" rows={2} value={brief.solutions} onChange={e=>setBrief({...brief,solutions:e.target.value})} placeholder="e.g. Automated workflows, live dashboards, 60% faster reporting" />
          </div>
          <div className="col-span-2">
            <label className="label">Key Technologies / USP</label>
            <input className="input" value={brief.technologies} onChange={e=>setBrief({...brief,technologies:e.target.value})} placeholder="e.g. React, Node.js, AWS, AI-powered analytics, 10+ years experience" />
          </div>
        </div>
      </Card>

      <div className="grid grid-cols-2 gap-6">
        {/* Config */}
        <Card className="p-5">
          <h3 className="text-sm font-bold text-slate-900 mb-4">Campaign Config</h3>
          <div className="space-y-4">
            <div>
              <label className="label">Campaign Name</label>
              <input className="input" value={campaignName} onChange={e=>setCampaignName(e.target.value)} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><label className="label">Batch Limit</label><input className="input" type="number" value={cfg.batch} onChange={e=>setCfg({...cfg,batch:+e.target.value})} /></div>
              <div><label className="label">Delay (secs)</label><input className="input" type="number" value={cfg.rate} onChange={e=>setCfg({...cfg,rate:+e.target.value})} /></div>
            </div>
            <div>
              <label className="label">Target Group</label>
              <select className="input" value={cfg.target} onChange={e=>setCfg({...cfg,target:e.target.value})}>
                <option value="valid">VALID Only</option>
                <option value="all">All Contacts</option>
                <option value="hot">HOT Leads</option>
                <option value="followup">Follow-Up</option>
              </select>
            </div>
            <div><label className="label">Sender Display Name</label><input className="input" value={cfg.sender} onChange={e=>setCfg({...cfg,sender:e.target.value})} /></div>
            <div><label className="label">Reply-To Email</label><input className="input" value={cfg.replyTo} onChange={e=>setCfg({...cfg,replyTo:e.target.value})} /></div>

            {/* Sender round-robin */}
            {activeProfiles.length > 0 && (
              <div>
                <label className="label">Sender Accounts (round-robin)</label>
                <div className="space-y-1.5 mt-1">
                  {activeProfiles.map(p => {
                    const key = p.user||p.email||''
                    const checked = selectedSenders.has(key)
                    return (
                      <label key={p.id} className="flex items-center gap-2 text-xs cursor-pointer">
                        <input type="checkbox" checked={checked} onChange={() => {
                          const s = new Set(selectedSenders)
                          checked ? s.delete(key) : s.add(key)
                          setSelectedSenders(s)
                        }} className="rounded" />
                        <span className="font-medium text-slate-700">{p.name}</span>
                        <span className="text-slate-400 font-mono">{key}</span>
                        <span className="ml-auto text-[10px] bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded">{p.type.toUpperCase()}</span>
                      </label>
                    )
                  })}
                </div>
                <p className="text-[10px] text-slate-400 mt-1.5">Email 1 → account 1, Email 2 → account 2, and so on.</p>
              </div>
            )}
          </div>
        </Card>

        {/* Email Composer */}
        <Card className="p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-bold text-slate-900">Email Composer</h3>
            <div className="flex gap-1 bg-slate-100 rounded-lg p-1">
              <button onClick={() => setMode('ai')} className={`px-3 py-1 text-xs rounded-md ${mode==='ai'?'bg-white shadow text-emerald-600':'text-slate-500'}`}>AI</button>
              <button onClick={() => setMode('custom')} className={`px-3 py-1 text-xs rounded-md ${mode==='custom'?'bg-white shadow text-blue-600':'text-slate-500'}`}>Custom</button>
            </div>
          </div>

          {mode === 'ai' ? (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">Number of Variants</label>
                  <select className="input" value={variantCount} onChange={e=>setVariantCount(+e.target.value)}>
                    {[1,3,5,10,15].map(n=><option key={n} value={n}>{n} variants</option>)}
                  </select>
                </div>
                <div>
                  <label className="label">Extra Instructions</label>
                  <input className="input" value={aiPrompt} onChange={e=>setAiPrompt(e.target.value)} placeholder="e.g. Focus on cost savings" />
                </div>
              </div>
              <Btn variant="secondary" size="sm" onClick={generateVariants} disabled={genLoading} className="w-full justify-center">
                {genLoading ? <RefreshCw size={12} className="animate-spin" /> : <Zap size={12} />}
                {genLoading ? 'Generating...' : `Generate ${variantCount} Sales Pitch Variants`}
              </Btn>

              {variants.length > 0 && (
                <div className="mt-2 p-2 bg-emerald-50 rounded-lg border border-emerald-100 text-[11px] text-emerald-700">
                  ✓ {variants.length} variants ready — will rotate across all {getTargets().slice(0,cfg.batch).length} leads
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-3">
              <input className="input" placeholder="Subject" value={customSubj} onChange={e=>setCustomSubj(e.target.value)} />
              <RichEditor value={customBody} onChange={h=>setCustomBody(htmlToPlain(h))} minHeight={150} />
            </div>
          )}

          {/* Preview */}
          {(variants.length > 0 || mode === 'custom') && (
            <div className="mt-4 border-t pt-4">
              <div className="flex items-center justify-between mb-2">
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Preview</label>
                {variants.length > 1 && (
                  <div className="flex gap-1 items-center">
                    <button onClick={()=>setVariantIdx(i=>Math.max(0,i-1))} className="p-1 hover:bg-slate-100 rounded"><ChevronLeft size={14}/></button>
                    <span className="text-[10px] py-1 text-slate-500">Variant {variantIdx+1}/{variants.length}</span>
                    <button onClick={()=>setVariantIdx(i=>Math.min(variants.length-1,i+1))} className="p-1 hover:bg-slate-100 rounded"><ChevronRight size={14}/></button>
                  </div>
                )}
              </div>
              <div className="bg-slate-50 rounded-lg p-3 text-sm border border-slate-200 max-h-64 overflow-y-auto">
                <p className="font-bold text-slate-900 border-b pb-1 mb-2 text-xs">Subject: {mode==='custom'?customSubj:currentVariant.subject}</p>
                <p className="whitespace-pre-wrap text-slate-600 leading-relaxed text-xs">{mode==='custom'?customBody:currentVariant.body}</p>
              </div>
            </div>
          )}

          {/* Attachments */}
          <div className="mt-4 border-t pt-4">
            <div className="flex items-center justify-between mb-2">
              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Link Attachments</label>
              <button onClick={()=>setAttachments([...attachments,{type:'link',label:'',url:''}])} className="text-emerald-600 hover:text-emerald-700">
                <Plus size={13}/>
              </button>
            </div>
            {attachments.map((a,i)=>(
              <div key={i} className="flex gap-2 mb-2">
                <input className="input text-xs flex-1" placeholder="Label" value={a.label} onChange={e=>{const n=[...attachments];n[i]={...n[i],label:e.target.value};setAttachments(n)}} />
                <input className="input text-xs flex-1" placeholder="https://..." value={a.url} onChange={e=>{const n=[...attachments];n[i]={...n[i],url:e.target.value};setAttachments(n)}} />
                <button onClick={()=>setAttachments(attachments.filter((_,j)=>j!==i))} className="text-red-400 hover:text-red-600"><X size={13}/></button>
              </div>
            ))}
          </div>
        </Card>
      </div>

      {/* Live Log */}
      {log.length > 0 && (
        <Card className="p-5">
          <h3 className="text-sm font-bold text-slate-900 mb-3">Live Log</h3>
          <div className="space-y-1 font-mono text-[10px] max-h-40 overflow-y-auto">
            {log.map((l,i)=><div key={i} className={l.color}>[{l.time}] {l.msg}</div>)}
          </div>
        </Card>
      )}
    </div>
  )
}
