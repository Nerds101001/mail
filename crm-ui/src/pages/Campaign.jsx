import { useState, useRef, useEffect } from 'react'
import { useCRM } from '../store'
import { Btn, Card, PageHeader, toast } from '../components/ui'
import RichEditor, { htmlToPlain } from '../components/RichEditor'
import { Play, Zap, RefreshCw, ChevronLeft, ChevronRight, Plus, X, Calendar, Pencil, Check } from 'lucide-react'

// Build a clean signature string from a "Name - Company" display name
function buildSignature(senderDisplayName) {
  if (!senderDisplayName) return 'Best,\nPawan Kumar\nEnginerds Tech Solution'
  const parts = senderDisplayName.split(/\s*[-–—]\s*/)
  const name    = parts[0]?.trim() || senderDisplayName
  const company = parts[1]?.trim() || ''
  return company ? `Best,\n${name}\n${company}` : `Best,\n${name}`
}

export default function Campaign() {
  const { leads, setLeads, profiles, settings, logActivity, viewAs } = useCRM()
  const vaParam = () => viewAs ? `&viewAs=${encodeURIComponent(viewAs)}` : ''
  const [mode, setMode]       = useState('ai')
  const [cfg, setCfg]         = useState({ batch:30, rate:2, target:'valid', filterVal:'', sender:'Pawan Kumar - Enginerds Tech Solution', replyTo:'contact@enginerds.in' })

  // Get unique groups for dropdown
  const uniqueGroups = [...new Set(leads.map(l => l.group).filter(Boolean))].sort()

  // Campaign Brief — the AI brain context
  const [brief, setBrief] = useState({
    product:      '',
    industries:   '',
    problems:     '',
    solutions:    '',
    technologies: '',
  })

  const [aiPrompt, setAiPrompt]         = useState('')
  const [contentPurpose, setContentPurpose] = useState('email_sales')
  const [minWords, setMinWords]         = useState(150)
  const [variantCount, setVariantCount] = useState(5)
  const [variants, setVariants]         = useState([])
  const [variantIdx, setVariantIdx]     = useState(0)
  const [editingVariant, setEditingVariant] = useState(false)
  const [customSubj, setCustomSubj]     = useState('')
  const [customBody, setCustomBody]     = useState('')

  // Link attachments (legacy — appear as plain text in email body)
  const [attachments, setAttachments]   = useState([{ type:'link', label:'', url:'' }])

  // File attachments (stored on server — appear as tracked download links)
  const [fileAttachments, setFileAttachments]       = useState([])
  const [selectedAttachments, setSelectedAttachments] = useState([])
  const [attachmentLoading, setAttachmentLoading]   = useState(false)

  const [running, setRunning]           = useState(false)
  const [progress, setProgress]         = useState(0)
  const [status, setStatus]             = useState('Ready to launch')
  const [log, setLog]                   = useState([])
  const [genLoading, setGenLoading]                   = useState(false)
  const [delivScore, setDelivScore]                   = useState(null)
  const [delivLoading, setDelivLoading]               = useState(false)
  const [campaignName, setCampaignName]               = useState(`Campaign ${new Date().toLocaleDateString('en-GB')}`)
  const [usePersonalization, setUsePersonalization]   = useState(false)
  const bodyRef = useRef(null)

  const authHeader = () => ({ Authorization: `Bearer ${localStorage.getItem('crm_token') || ''}` })

  useEffect(() => { loadFileAttachments() }, [viewAs]) // eslint-disable-line

  async function loadFileAttachments() {
    try {
      const res = await fetch(`/api/attachments?type=list${vaParam()}`, { headers: authHeader() })
      const data = await res.json()
      setFileAttachments(data.attachments || [])
    } catch (error) {
      console.error('Failed to load attachments:', error)
    }
  }

  async function uploadAttachmentFromUrl(url, label) {
    if (!url || !label) {
      toast('Please provide both URL and label', 'error')
      return
    }

    setAttachmentLoading(true)
    try {
      const res = await fetch('/api/attachments?type=upload-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeader() },
        body: JSON.stringify({ url, label })
      })

      const data = await res.json()
      if (!res.ok) throw new Error(data.error)

      toast(`Attachment "${label}" uploaded successfully`, 'success')
      await loadFileAttachments()

    } catch (error) {
      toast(`Upload failed: ${error.message}`, 'error')
    }
    setAttachmentLoading(false)
  }

  async function deleteFileAttachment(attachmentId) {
    if (!confirm('Delete this attachment?')) return

    try {
      const res = await fetch(`/api/attachments?id=${attachmentId}`, {
        method: 'DELETE',
        headers: authHeader()
      })

      if (!res.ok) throw new Error('Delete failed')

      toast('Attachment deleted', 'success')
      setSelectedAttachments(prev => prev.filter(id => id !== attachmentId))
      await loadFileAttachments()

    } catch (error) {
      toast(`Delete failed: ${error.message}`, 'error')
    }
  }

  // Follow-up mode — detect ?followup=campId in URL
  const [followupIds, setFollowupIds] = useState(null)
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
  const [scheduleTime, setScheduleTime]     = useState('')
  const [schedSaving, setSchedSaving]       = useState(false)

  const activeProfiles = profiles.filter(p => p.active)
  const [selectedSenders, setSelectedSenders] = useState(new Set(profiles.filter(p=>p.active).map(p=>p.user||p.email||'')))

  const currentVariant = variants[variantIdx] || { subject: 'Subject will appear here', body: 'Fill the Campaign Brief and click Generate Variants...' }

  function getTargets() {
    if (followupIds) return leads.filter(l => followupIds.has(l.id))
    const fv = cfg.filterVal.trim().toLowerCase()
    if (cfg.target === 'all')      return leads.slice()
    if (cfg.target === 'valid')    return leads.filter(l => l.status === 'VALID')
    if (cfg.target === 'followup') return leads.filter(l => l.status === 'FOLLOW-UP')
    if (cfg.target === 'hot')      return leads.filter(l => l.pipelineStage === 'HOT' || (l.opens >= 2 || l.clicks >= 1))
    if (cfg.target === 'category') return leads.filter(l => (l.category||'').toLowerCase() === fv)
    if (cfg.target === 'tag')      return leads.filter(l => (l.tags||[]).some(t => t.toLowerCase() === fv))
    if (cfg.target === 'group')    return leads.filter(l => (l.group||'').toLowerCase() === fv)
    return []
  }

  function buildAttachmentText() {
    const linkAttachments = attachments.filter(a => a.url && a.label)
    if (linkAttachments.length === 0) return ''
    return '\n\n' + linkAttachments.map(a => `📎 ${a.label}: ${a.url}`).join('\n')
  }

  async function getContent(lead, variantPool, index = 0) {
    const nameToken    = lead.name    || 'there'   // "Hi there," when name is unknown
    const companyToken = lead.company || 'your company'
    const sub = (s) => (s || '')
      .replace(/\[Name\]/gi,    nameToken)
      .replace(/\[Company\]/gi, companyToken)
      .replace(/\[Role\]/gi,    lead.role    || '')
      .replace(/their company/gi, companyToken)

    function injectNotes(body, lead) {
      if (!usePersonalization) return body
      if (!lead.notes || !lead.notes.trim()) return body
      const hook = `Given that ${lead.company || 'your company'} ${lead.notes.trim().replace(/^(is |are |has |have )/i, '')},`
      return body.replace(
        /^(Hi [^\n,]+,\n\n)/i,
        `$1${hook} `
      )
    }

    if (mode === 'custom') {
      return { subject: sub(customSubj), body: injectNotes(sub(customBody), lead) + buildAttachmentText() }
    }
    if (variantPool && variantPool.length > 0) {
      const v = variantPool[index % variantPool.length]
      return { subject: sub(v.subject), body: injectNotes(sub(v.body), lead) + buildAttachmentText() }
    }
    return {
      subject: `Question for ${lead.company || 'your business'}`,
      body: injectNotes(`Hi ${lead.name || 'there'},\n\nI noticed ${lead.company||'your business'} and thought we could help with your tech operations.\n\nBest regards,\nPawan Kumar\nEnginerds Tech Solution`, lead) + buildAttachmentText()
    }
  }

  const PURPOSE_LABELS = {
    email_sales:    'a cold sales pitch email',
    email_followup: 'a follow-up email (the recipient may have seen a previous email — reference that naturally)',
    email_intro:    'an introduction email establishing first contact, no hard sell',
    email_demo:     'an email requesting a product demo or short discovery call',
    linkedin:       'a LinkedIn InMail or connection message — keep it concise and professional, under 300 characters',
    whatsapp:       'a WhatsApp business message — conversational, friendly tone, under 200 words',
    custom:         'content exactly as described in the extra instructions below',
  }

  async function generateVariants() {
    if (!settings.openaiKey) { toast('Set NVIDIA API key in Settings first', 'error'); return }
    if (!brief.product.trim()) { toast('Fill in the Product/Service field in Campaign Brief', 'error'); return }
    setGenLoading(true)

    // Build the full prompt incorporating purpose + min word count + user instructions
    const purposeLabel = PURPOSE_LABELS[contentPurpose] || 'a sales email'
    const wordInstruction = minWords > 0 ? `The body must be at least ${minWords} words.` : ''
    const fullPrompt = [
      `Write ${purposeLabel}.`,
      wordInstruction,
      aiPrompt,
    ].filter(Boolean).join(' ')

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
          customPrompt: fullPrompt,
          count:        variantCount,
          brief,
        })
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'AI generation failed')
      const v = data.variants || [{ subject: data.subject, body: data.body }]
      const real = v.filter(x => !x.fallback)
      setVariants(v)
      setVariantIdx(0)
      setEditingVariant(false)
      if (data.failedCount > 0) {
        toast(`⚠ ${data.failedCount}/${v.length} variants failed AI — using templates. Error: ${data.firstError || 'unknown'}`, 'error')
      } else {
        toast(`Generated ${real.length} AI variants ✓`, 'success')
      }
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
      // Build {id, name} objects from selected attachment IDs
      const selectedAtts = fileAttachments
        .filter(a => selectedAttachments.includes(a.id))
        .map(a => ({ id: a.id, name: a.label }))
      const payload = {
        leadId: lead.id,
        to: lead.email,
        subject,
        body,
        senderName: cfg.sender,
        replyTo: cfg.replyTo,
        campaignId,
        attachments: selectedAtts
      }
      if (profile.type === 'smtp') payload.smtpConfig = profile
      if (profile.type === 'gmail') {
        payload.gmailUser = profile.user                    // OAuth token lookup key
        if (profile.alias) payload.fromEmail = profile.alias // "Send mail as" alias
      }
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

    const checkSubject = mode === 'custom' ? customSubj : (currentVariant.subject || '')
    const checkBody    = mode === 'custom' ? customBody  : (currentVariant.body    || '')
    if (checkSubject || checkBody) {
      try {
        const dr = await fetch('/api/ops?type=deliverability', {
          method: 'POST', headers: {'Content-Type':'application/json'},
          body: JSON.stringify({ subject: checkSubject, body: checkBody })
        })
        const ds = await dr.json()
        setDelivScore(ds)
        const failed = ds.checks.filter(c => !c.pass)
        if (ds.score < 5) {
          toast(`⛔ Score ${ds.score}/10 — fix issues before sending (see score panel)`, 'error')
          return
        }
        if (ds.score < 7) {
          const ok = window.confirm(`⚠ Deliverability score is ${ds.score}/10.\n\nIssues:\n${failed.map(c=>'• '+c.label).join('\n')}\n\nSend anyway?`)
          if (!ok) return
        }
      } catch { /* non-blocking */ }
    }

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
        if (idx !== -1) updatedLeads[idx] = { ...updatedLeads[idx], status:'SENT', lastSent:new Date().toISOString(), pipelineStage: (updatedLeads[idx].pipelineStage === 'COLD' || !updatedLeads[idx].pipelineStage) ? 'CONTACTED' : updatedLeads[idx].pipelineStage }
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
      variants,
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

  async function scheduleCampaign() {
    if (!scheduleTime) { toast('Pick a date and time first', 'error'); return }
    const scheduledAt = new Date(scheduleTime).getTime()
    if (scheduledAt <= Date.now()) { toast('Schedule time must be in the future', 'error'); return }

    const senderProfiles = activeProfiles.filter(p => selectedSenders.has(p.user || p.email || ''))
    if (!senderProfiles.length) { toast('Select at least one sender account', 'error'); return }

    const campId = `camp_${Date.now()}`
    setSchedSaving(true)
    try {
      const res = await fetch('/api/campaigns', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', ...authHeader() },
        body: JSON.stringify({
          id:           campId,
          name:         campaignName,
          target:       cfg.target,
          sender:       cfg.sender,
          brief,
          variants,
          stats:        { sent: 0, failed: 0, skipped: 0 },
          status:       'SCHEDULED',
          scheduled_at: scheduledAt,
          schedule_config: {
            cfg,
            variants,
            selectedSenders:    [...selectedSenders],
            selectedAttachments,
            usePersonalization,
          },
        }),
      })
      if (!res.ok) throw new Error('Save failed')
      toast(`✅ Campaign scheduled for ${new Date(scheduledAt).toLocaleString()} — saved to Campaign History`, 'success')
      setTimeout(() => { window.location.href = '/cam-history' }, 1500)
    } catch(err) {
      toast('Could not schedule: ' + err.message, 'error')
    }
    setSchedSaving(false)
  }

  return (
    <div className="space-y-6">
      <PageHeader title="AI Campaign" subtitle="Send personalized sales emails at scale">
        <div className="flex items-center gap-2 flex-wrap">
          <input type="datetime-local" className="input text-xs py-1.5" value={scheduleTime} onChange={e=>setScheduleTime(e.target.value)} disabled={running||schedSaving} title="Schedule campaign for later" />
          <Btn variant="secondary" onClick={scheduleCampaign} disabled={running||schedSaving||!scheduleTime}>
            {schedSaving ? '⏳ Saving...' : <><Calendar size={13}/> Schedule</>}
          </Btn>
          <Btn variant="secondary" onClick={checkDeliverability} disabled={delivLoading||running}>
            {delivLoading ? '...' : '🎯 Check Score'}
          </Btn>
          <Btn variant="primary" onClick={runCampaign} disabled={running||schedSaving}>
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

      {/* Campaign Brief */}
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
                <option value="group">Specific Group</option>
              </select>
            </div>
            {cfg.target === 'group' && (
              <div>
                <label className="label">Group Name</label>
                <select className="input" value={cfg.filterVal} onChange={e=>setCfg({...cfg,filterVal:e.target.value})}>
                  <option value="">Select a group...</option>
                  {uniqueGroups.map(group => (
                    <option key={group} value={group}>{group}</option>
                  ))}
                </select>
              </div>
            )}
            <div><label className="label">Sender Display Name</label><input className="input" value={cfg.sender} onChange={e=>setCfg({...cfg,sender:e.target.value})} /></div>
            <div><label className="label">Reply-To Email</label><input className="input" value={cfg.replyTo} onChange={e=>setCfg({...cfg,replyTo:e.target.value})} /></div>

            {/* Personalization toggle */}
            <div className="flex items-center justify-between p-3 bg-slate-50 rounded-lg border border-slate-200">
              <div>
                <p className="text-xs font-semibold text-slate-700">AI Personalization</p>
                <p className="text-[10px] text-slate-400 mt-0.5">{usePersonalization ? 'Lead notes injected into each email' : 'Standard variant rotation (faster)'}</p>
              </div>
              <button
                onClick={() => setUsePersonalization(p => !p)}
                className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${usePersonalization ? 'bg-emerald-500' : 'bg-slate-300'}`}
              >
                <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${usePersonalization ? 'translate-x-4' : 'translate-x-0.5'}`} />
              </button>
            </div>

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

            {/* Attachment quick-select in config (shows when files exist) */}
            {fileAttachments.length > 0 && (
              <div>
                <label className="label">Email Attachments</label>
                <div className="p-3 bg-slate-50 rounded-lg border border-slate-200">
                  <div className="text-xs text-slate-600 mb-2">
                    Select which files to attach to this campaign's emails:
                  </div>
                  <div className="space-y-1.5">
                    {fileAttachments.map(att => (
                      <label key={att.id} className="flex items-center gap-2 text-xs cursor-pointer">
                        <input
                          type="checkbox"
                          checked={selectedAttachments.includes(att.id)}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setSelectedAttachments(prev => [...prev, att.id])
                            } else {
                              setSelectedAttachments(prev => prev.filter(id => id !== att.id))
                            }
                          }}
                          className="rounded border-gray-300 text-emerald-600 focus:ring-emerald-500"
                        />
                        <span className="font-medium text-slate-700">{att.label}</span>
                        <span className="text-slate-400">({(att.size / 1024).toFixed(1)}KB)</span>
                        <span className="ml-auto text-[10px] bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded">
                          {(att.content_type || '').split('/')[1]?.toUpperCase() || 'FILE'}
                        </span>
                      </label>
                    ))}
                  </div>
                  <div className="flex gap-2 mt-2 pt-2 border-t border-slate-200">
                    <button
                      onClick={() => setSelectedAttachments(fileAttachments.map(a => a.id))}
                      className="text-xs text-emerald-600 hover:text-emerald-700"
                    >
                      Select All
                    </button>
                    <button
                      onClick={() => setSelectedAttachments([])}
                      className="text-xs text-slate-500 hover:text-slate-700"
                    >
                      Clear All
                    </button>
                    <span className="ml-auto text-xs text-slate-500">
                      {selectedAttachments.length} selected
                    </span>
                  </div>
                </div>
                <p className="text-[10px] text-slate-400 mt-1.5">
                  Only selected files will be attached to emails. Upload more files in the Attachments section below.
                </p>
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
              {/* Row 1 — Purpose + Min Words */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">Content Purpose</label>
                  <select className="input" value={contentPurpose} onChange={e => setContentPurpose(e.target.value)}>
                    <option value="email_sales">📧 Sales Pitch Email</option>
                    <option value="email_followup">🔄 Follow-up Email</option>
                    <option value="email_intro">👋 Introduction Email</option>
                    <option value="email_demo">📅 Demo Request Email</option>
                    <option value="linkedin">💼 LinkedIn Message</option>
                    <option value="whatsapp">💬 WhatsApp Message</option>
                    <option value="custom">✏️ Custom (use instructions)</option>
                  </select>
                </div>
                <div>
                  <label className="label">Min. Words in Body</label>
                  <input
                    className="input"
                    type="number"
                    min="0"
                    max="2000"
                    step="50"
                    value={minWords}
                    onChange={e => setMinWords(+e.target.value)}
                    placeholder="e.g. 150"
                  />
                </div>
              </div>

              {/* Row 2 — Variants + Extra Instructions */}
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

              {/* AI Prompt Preview */}
              {brief.product && (
                <div className="text-[10px] text-slate-400 bg-slate-50 rounded-lg px-3 py-2 border border-slate-100 leading-relaxed">
                  <span className="font-semibold text-slate-500">AI will generate: </span>
                  Write {PURPOSE_LABELS[contentPurpose]}.
                  {minWords > 0 && <> Body min <strong>{minWords} words</strong>.</>}
                  {aiPrompt && <> {aiPrompt}.</>}
                  {' '}Product: <strong>{brief.product}</strong>.
                  {brief.industries && <> Industries: {brief.industries}.</>}
                </div>
              )}

              <Btn variant="secondary" size="sm" onClick={generateVariants} disabled={genLoading} className="w-full justify-center">
                {genLoading ? <RefreshCw size={12} className="animate-spin" /> : <Zap size={12} />}
                {genLoading ? 'Generating...' : `Generate ${variantCount} ${contentPurpose === 'linkedin' ? 'LinkedIn' : contentPurpose === 'whatsapp' ? 'WhatsApp' : 'Email'} Variants`}
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

          {/* Preview / Edit */}
          {(variants.length > 0 || mode === 'custom') && (
            <div className="mt-4 border-t pt-4">
              <div className="flex items-center justify-between mb-2">
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                  {editingVariant && mode === 'ai' ? 'Editing Variant' : 'Preview'}
                </label>
                <div className="flex gap-1 items-center">
                  {variants.length > 1 && (
                    <>
                      <button
                        onClick={() => { setVariantIdx(i => Math.max(0, i-1)); setEditingVariant(false) }}
                        className="p-1 hover:bg-slate-100 rounded"
                      ><ChevronLeft size={14}/></button>
                      <span className="text-[10px] py-1 text-slate-500">Variant {variantIdx+1}/{variants.length}</span>
                      <button
                        onClick={() => { setVariantIdx(i => Math.min(variants.length-1, i+1)); setEditingVariant(false) }}
                        className="p-1 hover:bg-slate-100 rounded"
                      ><ChevronRight size={14}/></button>
                    </>
                  )}
                  {mode === 'ai' && variants.length > 0 && (
                    <button
                      onClick={() => setEditingVariant(v => !v)}
                      title={editingVariant ? 'Done editing' : 'Edit this variant'}
                      className={`flex items-center gap-1 ml-1 px-2 py-1 rounded-lg text-[10px] font-semibold transition-colors ${
                        editingVariant
                          ? 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200'
                          : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                      }`}
                    >
                      {editingVariant ? <><Check size={11}/> Done</> : <><Pencil size={11}/> Edit</>}
                    </button>
                  )}
                </div>
              </div>

              {editingVariant && mode === 'ai' ? (
                // Editable mode — plain textarea keeps \n intact, no HTML conversion
                <div className="space-y-2">
                  <div>
                    <label className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide mb-1 block">Subject Line</label>
                    <input
                      className="w-full text-sm font-semibold border border-blue-300 rounded-lg px-3 py-2.5 bg-white focus:outline-none focus:ring-2 focus:ring-blue-400/30"
                      value={currentVariant.subject}
                      onChange={e => setVariants(vs => vs.map((v, i) => i === variantIdx ? { ...v, subject: e.target.value } : v))}
                      placeholder="Subject line..."
                    />
                  </div>
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide">Email Body</label>
                      {/* Signature selector */}
                      <div className="flex items-center gap-1.5">
                        <span className="text-[10px] text-slate-400">Signature:</span>
                        <select
                          className="text-[10px] border border-slate-200 rounded-md px-1.5 py-0.5 bg-white text-slate-600 hover:border-slate-300"
                          defaultValue=""
                          onChange={e => {
                            if (!e.target.value) return
                            const sig = e.target.value
                            setVariants(vs => vs.map((v, i) => {
                              if (i !== variantIdx) return v
                              // Replace existing signature block or append
                              const body = v.body.replace(/\n+Best,[\s\S]*$/i, '').trimEnd()
                              return { ...v, body: body + '\n\n' + sig }
                            }))
                            e.target.value = ''
                          }}
                        >
                          <option value="">— Insert signature —</option>
                          <option value={buildSignature(cfg.sender)}>{cfg.sender || 'Default Sender'}</option>
                          {activeProfiles.map(p => {
                            const sig = buildSignature(p.name || p.user || '')
                            return <option key={p.id} value={sig}>{p.name || p.user}</option>
                          })}
                        </select>
                      </div>
                    </div>
                    <textarea
                      rows={12}
                      className="w-full text-sm border border-blue-300 rounded-lg px-3 py-2.5 bg-white focus:outline-none focus:ring-2 focus:ring-blue-400/30 resize-y leading-relaxed"
                      value={currentVariant.body}
                      onChange={e => setVariants(vs => vs.map((v, i) => i === variantIdx ? { ...v, body: e.target.value } : v))}
                      placeholder="Email body..."
                    />
                  </div>
                  <p className="text-[10px] text-slate-400">✏️ Changes are live — this exact content will be sent.</p>
                </div>
              ) : (
                // Read-only preview — rendered as formatted email
                <div className="bg-white rounded-xl border border-slate-200 overflow-hidden max-h-80 overflow-y-auto shadow-sm">
                  {/* Email header bar */}
                  <div className="bg-slate-50 border-b border-slate-200 px-4 py-2.5 flex items-center gap-2">
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">Subject:</span>
                    <span className="text-sm font-semibold text-slate-800 truncate">
                      {mode === 'custom' ? customSubj : currentVariant.subject}
                    </span>
                    {(mode === 'ai' ? currentVariant.approach : null) && (
                      <span className="ml-auto text-[9px] bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full font-semibold whitespace-nowrap flex-shrink-0">
                        {currentVariant.approach}
                      </span>
                    )}
                  </div>
                  {/* Email body rendered as paragraphs */}
                  <div className="px-4 py-3 text-sm text-slate-700 leading-relaxed space-y-3 font-sans">
                    {(mode === 'custom' ? customBody : currentVariant.body)
                      .split(/\n{2,}/)
                      .map((para, idx) => (
                        <p key={idx} className="m-0">
                          {para.split('\n').map((line, li) => (
                            <span key={li}>
                              {line}
                              {li < para.split('\n').length - 1 && <br/>}
                            </span>
                          ))}
                        </p>
                      ))
                    }
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ─── ATTACHMENTS ─────────────────────────────────────────────── */}
          <div className="mt-4 border-t pt-4">
            <div className="flex items-center justify-between mb-4">
              <label className="text-sm font-bold text-slate-900">Email Attachments</label>
              <span className="text-xs text-slate-500">Manage files and links to include in emails</span>
            </div>

            {/* ── File Attachments (Recommended) ─────────────────────────── */}
            <div className="mb-6 p-4 bg-emerald-50 border border-emerald-200 rounded-lg">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <h4 className="text-sm font-semibold text-emerald-800">📎 File Attachments (Recommended)</h4>
                  <p className="text-xs text-emerald-600">Upload files once, attach to all emails automatically</p>
                </div>
                <div className="text-xs font-bold text-emerald-700 bg-emerald-100 px-2 py-1 rounded">
                  {fileAttachments.length} files stored
                </div>
              </div>

              {/* Upload Interface */}
              <div className="bg-white p-3 rounded border border-emerald-200 mb-3">
                <div className="text-xs text-slate-600 mb-2">
                  <strong>💡 Tip:</strong> Supports Google Drive, Dropbox, OneDrive sharing links, or direct download URLs
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                  <input
                    className="input text-sm"
                    placeholder="File label (e.g., Product Brochure)"
                    id="file-attachment-label"
                  />
                  <input
                    className="input text-sm"
                    placeholder="https://drive.google.com/file/d/... or direct URL"
                    id="file-attachment-url"
                  />
                  <button
                    onClick={() => {
                      const label = document.getElementById('file-attachment-label').value.trim()
                      const url = document.getElementById('file-attachment-url').value.trim()
                      if (label && url) {
                        uploadAttachmentFromUrl(url, label)
                        document.getElementById('file-attachment-label').value = ''
                        document.getElementById('file-attachment-url').value = ''
                      } else {
                        toast('Please enter both label and URL', 'error')
                      }
                    }}
                    disabled={attachmentLoading}
                    className="px-4 py-2 bg-emerald-600 text-white text-sm rounded hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                  >
                    {attachmentLoading ? (
                      <>
                        <RefreshCw size={14} className="animate-spin" />
                        Uploading...
                      </>
                    ) : (
                      <>
                        <Plus size={14} />
                        Upload File
                      </>
                    )}
                  </button>
                </div>

                {/* Quick Test Buttons */}
                <div className="mt-3 pt-3 border-t border-emerald-100">
                  <div className="text-xs text-slate-600 mb-2">🧪 <strong>Quick Test:</strong></div>
                  <div className="flex gap-2 flex-wrap">
                    <button
                      onClick={() => {
                        document.getElementById('file-attachment-label').value = 'Sample PDF'
                        document.getElementById('file-attachment-url').value = 'https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf'
                      }}
                      className="px-2 py-1 bg-blue-100 text-blue-700 text-xs rounded hover:bg-blue-200"
                    >
                      📄 Sample PDF
                    </button>
                    <button
                      onClick={() => {
                        document.getElementById('file-attachment-label').value = 'Sample Image'
                        document.getElementById('file-attachment-url').value = 'https://file-examples.com/storage/fe68c8a7c69bd447d7770f6/2017/10/file_example_JPG_100kB.jpg'
                      }}
                      className="px-2 py-1 bg-purple-100 text-purple-700 text-xs rounded hover:bg-purple-200"
                    >
                      🖼️ Sample Image
                    </button>
                    <button
                      onClick={loadFileAttachments}
                      className="px-2 py-1 bg-gray-100 text-gray-700 text-xs rounded hover:bg-gray-200"
                    >
                      🔄 Refresh List
                    </button>
                  </div>
                </div>
              </div>

              {/* Attachment Selection */}
              {fileAttachments.length > 0 && (
                <div className="bg-white p-3 rounded border border-emerald-200 mb-3">
                  <div className="text-sm font-medium text-emerald-800 mb-2">
                    📋 Select Attachments for This Campaign
                  </div>
                  <div className="text-xs text-emerald-600 mb-3">
                    Choose which files to include in this specific campaign
                  </div>
                  <div className="space-y-2">
                    <div className="text-xs font-medium text-slate-700">Available Files:</div>
                    {fileAttachments.map(att => (
                      <label key={att.id} className="flex items-center gap-3 p-2 bg-slate-50 rounded border cursor-pointer hover:bg-slate-100">
                        <input
                          type="checkbox"
                          checked={selectedAttachments.includes(att.id)}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setSelectedAttachments(prev => [...prev, att.id])
                            } else {
                              setSelectedAttachments(prev => prev.filter(id => id !== att.id))
                            }
                          }}
                          className="rounded border-gray-300 text-emerald-600 focus:ring-emerald-500"
                        />
                        <div className="flex-1">
                          <div className="font-medium text-slate-800 text-sm">{att.label}</div>
                          <div className="text-slate-500 text-xs">
                            {att.original_name} • {(att.size / 1024).toFixed(1)}KB
                          </div>
                        </div>
                        <div className="text-xs text-slate-400">
                          {selectedAttachments.includes(att.id) ? '✅ Selected' : '⬜ Not selected'}
                        </div>
                      </label>
                    ))}
                  </div>
                  <div className="flex gap-2 mt-3 pt-3 border-t border-emerald-100">
                    <button
                      onClick={() => setSelectedAttachments(fileAttachments.map(a => a.id))}
                      className="px-3 py-1 bg-emerald-100 text-emerald-700 text-xs rounded hover:bg-emerald-200"
                    >
                      ✅ Select All
                    </button>
                    <button
                      onClick={() => setSelectedAttachments([])}
                      className="px-3 py-1 bg-slate-100 text-slate-700 text-xs rounded hover:bg-slate-200"
                    >
                      ❌ Clear All
                    </button>
                    <div className="ml-auto text-xs text-emerald-700 font-medium">
                      {selectedAttachments.length} of {fileAttachments.length} selected
                    </div>
                  </div>
                </div>
              )}

              {/* Stored File List */}
              {fileAttachments.length > 0 ? (
                <div className="space-y-2">
                  <div className="text-xs font-medium text-slate-700 mb-2">Stored Files:</div>
                  {fileAttachments.map(att => (
                    <div key={att.id} className="flex items-center justify-between p-3 bg-white border border-slate-200 rounded-lg">
                      <div className="flex-1">
                        <div className="font-medium text-slate-800 text-sm">{att.label}</div>
                        <div className="text-slate-500 text-xs mt-1">
                          📄 {att.original_name} • {(att.size / 1024).toFixed(1)}KB • {att.content_type}
                        </div>
                        <div className="text-slate-400 text-xs">
                          Uploaded: {new Date(parseInt(att.uploaded_at)).toLocaleDateString()}
                        </div>
                      </div>
                      <div className="flex gap-2 ml-4">
                        <a
                          href={`/api/attachments?type=download&id=${att.id}`}
                          className="px-3 py-1 bg-blue-500 text-white text-xs rounded hover:bg-blue-600 flex items-center gap-1"
                          target="_blank"
                          rel="noopener noreferrer"
                          title="View/Download file"
                        >
                          👁️ View
                        </a>
                        <button
                          onClick={() => deleteFileAttachment(att.id)}
                          className="px-3 py-1 bg-red-500 text-white text-xs rounded hover:bg-red-600 flex items-center gap-1"
                          title="Delete file"
                        >
                          🗑️ Delete
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-6 text-slate-500">
                  <div className="text-2xl mb-2">📎</div>
                  <div className="text-sm">No files uploaded yet</div>
                  <div className="text-xs">Upload files to attach them to all campaign emails</div>
                </div>
              )}
            </div>

            {/* ── Link Attachments (Legacy) ───────────────────────────────── */}
            <div className="p-4 bg-amber-50 border border-amber-200 rounded-lg">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <h4 className="text-sm font-semibold text-amber-800">🔗 Link Attachments (Legacy)</h4>
                  <p className="text-xs text-amber-600">Links will appear in email body (not recommended)</p>
                </div>
                <button
                  onClick={() => setAttachments([...attachments, { type:'link', label:'', url:'' }])}
                  className="px-3 py-1 bg-amber-600 text-white text-xs rounded hover:bg-amber-700 flex items-center gap-1"
                >
                  <Plus size={12}/>
                  Add Link
                </button>
              </div>

              {attachments.length > 0 ? (
                <div className="space-y-2">
                  {attachments.map((a, i) => (
                    <div key={i} className="flex gap-2 p-2 bg-white border border-amber-200 rounded">
                      <input
                        className="input text-xs flex-1"
                        placeholder="Link label"
                        value={a.label}
                        onChange={e => { const n=[...attachments]; n[i]={...n[i],label:e.target.value}; setAttachments(n) }}
                      />
                      <input
                        className="input text-xs flex-1"
                        placeholder="https://..."
                        value={a.url}
                        onChange={e => { const n=[...attachments]; n[i]={...n[i],url:e.target.value}; setAttachments(n) }}
                      />
                      <button
                        onClick={() => setAttachments(attachments.filter((_,j) => j !== i))}
                        className="px-2 py-1 bg-red-500 text-white text-xs rounded hover:bg-red-600"
                        title="Remove link"
                      >
                        <X size={12}/>
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-4 text-amber-600 text-sm">
                  No link attachments added
                </div>
              )}
            </div>

            {/* Summary */}
            {(selectedAttachments.length > 0 || attachments.some(a => a.url && a.label)) && (
              <div className="mt-4 p-3 bg-slate-100 border border-slate-200 rounded-lg">
                <div className="text-xs font-medium text-slate-700 mb-1">📋 Campaign Summary:</div>
                <div className="text-xs text-slate-600">
                  • {selectedAttachments.length} file(s) will be attached to emails<br/>
                  • {attachments.filter(a => a.url && a.label).length} link(s) will appear in email body
                </div>
                {selectedAttachments.length > 0 && (
                  <div className="text-xs text-emerald-700 mt-2">
                    <strong>Selected files:</strong> {fileAttachments.filter(a => selectedAttachments.includes(a.id)).map(a => a.label).join(', ')}
                  </div>
                )}
              </div>
            )}
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
