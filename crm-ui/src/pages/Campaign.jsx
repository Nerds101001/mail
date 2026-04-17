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
  const [campaignName, setCampaignName] = useState(`Campaign ${new Date().toLocaleDateString('en-GB')}`)
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

  function buildAttachmentText() {
    const valid = attachments.filter(a => a.url && a.label)
    if (!valid.length) return ''
    return '\n\n' + valid.map(a => `📎 ${a.label}: ${a.url}`).join('\n')
  }

  async function getContent(lead, variantPool) {
    if (mode === 'custom') {
      const r = s => s.replace(/\[Name\]/g, lead.name||'').replace(/\[Company\]/g, lead.company||'').replace(/\[Role\]/g, lead.role||'')
      return { subject: r(customSubj), body: r(customBody) + buildAttachmentText() }
    }
    if (variantPool && variantPool.length > 0) {
      const v = variantPool[Math.floor(Math.random() * variantPool.length)]
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
    if (!settings.openaiKey) { toast('Set NVIDIA API key in Settings', 'error'); return }
    setGenLoading(true)
    try {
      const res = await fetch('/api/generate-ai', { method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ name:'[Name]', company:'[Company]', role:'[Role]', category: cfg.filterVal || 'Business', apiKey:settings.openaiKey, customPrompt:aiPrompt, count: variantCount }) })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'AI generation failed')
      const v = data.variants || [{ subject: data.subject, body: data.body }]
      setVariants(v)
      setVariantIdx(0)
      toast(`Generated ${v.length} variants ✓`, 'success')
    } catch(e) { 
      toast('Generation failed: '+e.message, 'error')
    }
    setGenLoading(false)
  }

  async function sendOne(lead, subject, body, profile, campaignId) {
    try {
      const endpoint = profile.type === 'gmail' ? '/api/send-email' : '/api/send-smtp'
      const payload = { leadId:lead.id, to:lead.email, subject, body, senderName:cfg.sender, replyTo:cfg.replyTo, campaignId }
      if (profile.type === 'smtp') payload.smtpConfig = profile
      if (profile.type === 'gmail') payload.gmailUser = profile.user
      const res = await fetch(endpoint, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(payload) })
      return res.ok
    } catch(e) { return false }
  }

  function addLog(msg, type='info') {
    const colors = { success:'text-emerald-600', error:'text-red-500', info:'text-blue-500', warn:'text-amber-500' }
    setLog(prev => [{ msg, color: colors[type], time: new Date().toLocaleTimeString() }, ...prev].slice(0, 50))
  }

  async function saveDraft() {
    const targets = getTargets().slice(0, cfg.batch)
    const campaignData = {
      name: campaignName,
      target: cfg.target,
      sender: cfg.sender,
      status: 'DRAFT',
      leads: targets.map(l => ({ id: l.id, name: l.name, email: l.email, company: l.company, status: 'DRAFT' })),
      stats: { sent: 0, failed: 0, skipped: 0 }
    }
    try {
      const res = await fetch('/api/campaigns', { method:'POST', headers:{'Content-Type':'application/json', 'Authorization': `Bearer ${localStorage.getItem('crm_token')}`}, body: JSON.stringify(campaignData) })
      if (res.ok) toast('Draft saved to History ✓', 'success')
      else toast('Failed to save draft', 'error')
    } catch(e) { toast('Error saving draft', 'error') }
  }

  async function runCampaign() {
    const senderProfiles = activeProfiles.filter(p => selectedSenders.has(p.user||p.email||''))
    const targets = getTargets().slice(0, cfg.batch)
    if (!senderProfiles.length || !targets.length) { toast('Missing senders or leads', 'error'); return }

    setRunning(true); setLog([]); setProgress(0)
    const campaignId = `camp_${Date.now()}`
    let processed = 0
    const updatedLeads = [...leads]

    for (let i = 0; i < targets.length; i++) {
        const l = targets[i]; setStatus(`Processing: ${l.name}`); setProgress(Math.round(((i+1)/targets.length)*100))
        const profile = senderProfiles[i % senderProfiles.length]
        const { subject, body } = await getContent(l, variants)
        const ok = await sendOne(l, subject, body, profile, campaignId)
        if (ok) {
            addLog(`✓ Sent to ${l.name}`, 'success'); processed++
            const idx = updatedLeads.findIndex(x=>x.id===l.id)
            if(idx!==-1) updatedLeads[idx] = {...updatedLeads[idx], status:'SENT', lastSent:new Date().toISOString()}
        } else { addLog(`✗ Failed for ${l.name}`, 'error') }
        if (i < targets.length-1 && cfg.rate > 0) await new Promise(r=>setTimeout(r, cfg.rate*1000))
    }

    setLeads(updatedLeads)
    const campaignData = {
        id: campaignId, name: campaignName, target: cfg.target, sender: cfg.sender, stats: { sent: processed, failed: targets.length-processed, skipped: 0 },
        leads: targets.map(l => ({ id: l.id, name: l.name, email: l.email, company: l.company, status: 'SENT' }))
    }
    await fetch('/api/campaigns', { method:'POST', headers:{'Content-Type':'application/json', 'Authorization': `Bearer ${localStorage.getItem('crm_token')}`}, body: JSON.stringify(campaignData) })

    setRunning(false); setStatus(`Done — ${processed} sent`); toast(`Campaign complete`, 'success')
  }

  return (
    <div className="space-y-6">
      <PageHeader title="AI Campaign" subtitle="Send personalized emails at scale">
        <div className="flex gap-2">
            <Btn variant="secondary" onClick={saveDraft} disabled={running}><PenLine size={14} /> Save Draft</Btn>
            <Btn variant="primary" onClick={runCampaign} disabled={running}><Play size={14} /> {running ? 'Running...' : 'Run Campaign'}</Btn>
        </div>
      </PageHeader>

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

      <div className="grid grid-cols-2 gap-6">
        <Card className="p-5">
          <h3 className="text-sm font-bold text-slate-900 mb-4">Campaign Config</h3>
          <div className="space-y-4">
            <div>
              <label className="label">Campaign Name</label>
              <input className="input" value={campaignName} onChange={e=>setCampaignName(e.target.value)} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><label className="label">Batch Limit</label><input className="input" type="number" value={cfg.batch} onChange={e=>setCfg({...cfg,batch:+e.target.value})} /></div>
              <div><label className="label">Rate (secs)</label><input className="input" type="number" value={cfg.rate} onChange={e=>setCfg({...cfg,rate:+e.target.value})} /></div>
            </div>
            <div>
              <label className="label">Target Group</label>
              <select className="input" value={cfg.target} onChange={e=>setCfg({...cfg,target:e.target.value})}>
                <option value="valid">VALID Only</option><option value="all">All Contacts</option><option value="hot">HOT Leads</option>
              </select>
            </div>
            <div><label className="label">Sender Name</label><input className="input" value={cfg.sender} onChange={e=>setCfg({...cfg,sender:e.target.value})} /></div>
            <div><label className="label">Reply-to Email</label><input className="input" value={cfg.replyTo} onChange={e=>setCfg({...cfg,replyTo:e.target.value})} /></div>
          </div>
        </Card>

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
                <div><label className="label">Variants</label>
                    <select className="input" value={variantCount} onChange={e=>setVariantCount(+e.target.value)}>{[1,3,5,10].map(n=><option key={n} value={n}>{n}</option>)}</select>
                </div>
                <div><label className="label">AI Focus</label><input className="input" value={aiPrompt} onChange={e=>setAiPrompt(e.target.value)} placeholder="e.g. Focus on ROI" /></div>
              </div>
              <Btn variant="secondary" size="sm" onClick={generateVariants} disabled={genLoading}>
                {genLoading ? <RefreshCw size={12} className="animate-spin" /> : <Zap size={12} />} Generate Variants
              </Btn>
            </div>
          ) : (
            <div className="space-y-3">
                <input className="input" placeholder="Subject" value={customSubj} onChange={e=>setCustomSubj(e.target.value)} />
                <RichEditor value={customBody} onChange={h=>setCustomBody(htmlToPlain(h))} minHeight={150} />
            </div>
          )}

          {(variants.length > 0 || mode === 'custom') && (
            <div className="mt-6 border-t pt-4">
                <div className="flex items-center justify-between mb-2">
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Preview</label>
                    {variants.length > 1 && (
                        <div className="flex gap-1">
                            <button onClick={()=>setVariantIdx(i=>Math.max(0,i-1))} className="p-1 hover:bg-slate-100 rounded"><ChevronLeft size={14}/></button>
                            <span className="text-[10px] py-1">{variantIdx+1}/{variants.length}</span>
                            <button onClick={()=>setVariantIdx(i=>Math.min(variants.length-1,i+1))} className="p-1 hover:bg-slate-100 rounded"><ChevronRight size={14}/></button>
                        </div>
                    )}
                </div>
                <div className="bg-slate-50 rounded-lg p-3 text-sm border border-slate-200">
                    <p className="font-bold text-slate-900 border-b pb-1 mb-2">Sub: {mode==='custom'?customSubj:currentVariant.subject}</p>
                    <p className="whitespace-pre-wrap text-slate-600 leading-relaxed">{mode==='custom'?customBody:currentVariant.body}</p>
                </div>
            </div>
          )}
        </Card>
      </div>

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
