// campaignRunner.js — module-level singleton
// Lives outside React — survives component unmounts during SPA navigation.
// Campaign.jsx kicks it off, Layout.jsx subscribes for the floating banner,
// CampaignHistory.jsx subscribes for live progress on the RUNNING row.
//
// ── How tracking works ────────────────────────────────────────────────────────
// 1. At campaign START, every target lead is pre-inserted into campaign_leads
//    with status='PENDING'. This happens BEFORE any email is sent.
// 2. After each email send, the corresponding PENDING row is updated to
//    SENT / FAILED / BOUNCED / SKIPPED — immediately, not in batches.
// 3. On RESUME (pause/crash/refresh), the runner queries campaign_leads for
//    status='PENDING' rows. No target list is ever stored in schedule_config.
// ─────────────────────────────────────────────────────────────────────────────

const _state = {
  status:       'IDLE',   // IDLE | RUNNING | PAUSED | DONE
  campaignId:   null,
  campaignName: '',
  total:        0,
  sent:         0,
  failed:       0,
  skipped:      0,
  pending:      0,
  currentLead:  '',
  progress:     0,
  log:          [],
  pausedAt:     null,
  capPause:     false,    // true = paused because all senders hit daily cap
  batchPause:   false,    // true = paused because batch limit was reached
  _abortFlag:   false,
  _subscribers: new Set(),
}

function _snap() {
  return {
    status:       _state.status,
    campaignId:   _state.campaignId,
    campaignName: _state.campaignName,
    total:        _state.total,
    sent:         _state.sent,
    failed:       _state.failed,
    skipped:      _state.skipped,
    pending:      _state.pending,
    currentLead:  _state.currentLead,
    progress:     _state.progress,
    log:          [..._state.log],
    pausedAt:     _state.pausedAt,
    capPause:     _state.capPause,
    batchPause:   _state.batchPause,
  }
}

function _notify() {
  const s = _snap()
  _state._subscribers.forEach(fn => { try { fn(s) } catch {} })
}

export function getState() { return _snap() }

export function subscribe(fn) {
  _state._subscribers.add(fn)
  fn(_snap())                      // fire immediately with current state
  return () => _state._subscribers.delete(fn)
}

/** Signal the running loop to stop after the current send */
export function pause() {
  if (_state.status === 'RUNNING') _state._abortFlag = true
}

/** Mark banner dismissed so it hides after DONE */
export function dismiss() {
  _state.status = 'IDLE'
  _notify()
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function _addLog(msg, type = 'info') {
  const colors = { success: 'text-emerald-600', error: 'text-red-500', info: 'text-blue-500', warn: 'text-amber-500' }
  _state.log = [{ msg, color: colors[type] || colors.info, time: new Date().toLocaleTimeString() }, ..._state.log].slice(0, 150)
}

function _getContent(lead, config, index) {
  const nameToken    = lead.name    || 'there'
  const companyToken = lead.company || 'your company'
  const sub = s => (s || '')
    .replace(/\[Name\]/gi,    nameToken)
    .replace(/\[Company\]/gi, companyToken)
    .replace(/\[Role\]/gi,    lead.role || '')
    .replace(/their company/gi, companyToken)

  function injectNotes(body) {
    if (!config.usePersonalization || !lead.notes?.trim()) return body
    const hook = `Given that ${companyToken} ${lead.notes.trim().replace(/^(is |are |has |have )/i, '')},`
    return body.replace(/^(Hi [^\n,]+,\n\n)/i, `$1${hook} `)
  }

  if (config.mode === 'custom') {
    return { subject: sub(config.customSubj), body: injectNotes(sub(config.customBody)) + (config.attachmentText || '') }
  }
  if (config.variants?.length > 0) {
    const v = config.variants[index % config.variants.length]
    return { subject: sub(v.subject), body: injectNotes(sub(v.body)) + (config.attachmentText || '') }
  }
  return {
    subject: `Question for ${lead.company || 'your business'}`,
    body: injectNotes(`Hi ${lead.name || 'there'},\n\nI noticed ${lead.company || 'your business'} and thought we could help with your tech operations.\n\nBest regards,\nEnginerds Tech Solution`) + (config.attachmentText || ''),
  }
}

/**
 * Returns a round-robin profile from those NOT in exhaustedIds.
 * Returns null when every profile has hit its server-side daily limit.
 */
function _getAvailableProfile(senderProfiles, exhaustedIds, slot) {
  const available = senderProfiles.filter(p => !exhaustedIds.has(p.id))
  return available.length === 0 ? null : available[slot % available.length]
}

async function _sendOne(lead, subject, body, profile, campaignId, config) {
  try {
    const endpoint = profile.type === 'gmail' ? '/api/send-email' : '/api/send-smtp'
    const payload = {
      leadId:     lead.id,
      to:         lead.email,
      subject,
      body,
      senderName: config.senderName,
      replyTo:    config.replyTo,
      campaignId,
      attachments: config.selectedAtts || [],
    }
    if (profile.type === 'smtp')  payload.smtpConfig = profile
    if (profile.type === 'gmail') {
      payload.gmailUser = profile.user
      if (profile.alias) payload.fromEmail = profile.alias
    }
    const res  = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
    const data = await res.json().catch(() => ({}))
    if (data.rateLimited) return { ok: false, rateLimited: true }
    if (data.bounced)     return { ok: false, bounced: true }
    if (data.skipped)     return { ok: false, skipped: true }
    return { ok: res.ok }
  } catch { return { ok: false } }
}

async function _patchCampaign(campaignId, updates, token) {
  try {
    await fetch(`/api/crm?type=campaigns&id=${campaignId}`, {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body:    JSON.stringify(updates),
    })
  } catch(e) { console.warn('[Runner] patchCampaign failed:', e.message) }
}

// ─── Batch-insert leads (used for pre-inserting PENDING rows) ─────────────────
async function _saveLeads(campaignId, leads, token) {
  if (!leads.length) return
  // Send in batches of 100 to avoid large request bodies
  for (let i = 0; i < leads.length; i += 100) {
    const batch = leads.slice(i, i + 100)
    try {
      await fetch('/api/campaigns', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body:    JSON.stringify({ id: campaignId, leads_only: true, leads: batch }),
      })
    } catch(e) { console.warn('[Runner] saveLeads batch failed:', e.message) }
  }
}

// ─── Update a single lead's status after send (PENDING → SENT/FAILED/etc) ────
async function _markLeadSent(campaignId, lead, token) {
  try {
    await fetch(`/api/crm?type=campaigns&id=${campaignId}`, {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body:    JSON.stringify({
        update_lead: {
          leadId:       lead.id,
          status:       lead.status,
          subject:      lead.subject      || '',
          body:         lead.body         || '',
          variantIndex: lead.variantIndex || 0,
          sentAt:       lead.sentAt       || Date.now(),
        },
      }),
    })
  } catch(e) { console.warn('[Runner] markLeadSent failed:', e.message) }
}

// ─── Fetch PENDING leads from campaign_leads (used on resume) ─────────────────
async function _fetchPendingLeads(campaignId, token) {
  try {
    const res = await fetch(`/api/crm?type=campaigns&id=${campaignId}&pending=true`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!res.ok) return []
    const data = await res.json()
    return data.pending_leads || []
  } catch(e) { console.warn('[Runner] fetchPendingLeads failed:', e.message); return [] }
}

// ─── Fetch full lead objects from the CRM store by IDs (used for hydration) ──
async function _fetchLeadsByIds(ids, token) {
  if (!ids?.length) return []
  try {
    const leads = []
    for (let i = 0; i < ids.length; i += 200) {
      const batch = ids.slice(i, i + 200)
      const res = await fetch(`/api/crm?type=leads_by_ids&ids=${batch.join(',')}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) continue
      const data = await res.json()
      leads.push(...(Array.isArray(data) ? data : []))
    }
    return leads
  } catch(e) { console.warn('[Runner] fetchLeadsByIds failed:', e.message); return [] }
}

// ─── Pause handler ────────────────────────────────────────────────────────────
// All already-sent leads are updated in DB (per-lead updates in the loop).
// Remaining leads are still PENDING in campaign_leads — no need to store IDs.

async function _handlePause(fromIndex, config, reason) {
  const pendingCount = config.targets.length - fromIndex

  _state.status   = 'PAUSED'
  _state.pending  = pendingCount
  _state.pausedAt = Date.now()
  _state.capPause = reason === 'cap'
  _state.batchPause = reason === 'batch'

  const msg = reason === 'cap'
    ? `🚫 All senders hit daily limit — ${pendingCount} leads pending.`
    : reason === 'batch'
    ? `⏸ Batch of ${fromIndex} sent — ${pendingCount} leads still queued. Resume to send next batch.`
    : `⏸ Paused — ${pendingCount} leads pending.`
  _addLog(msg, 'warn')
  _notify()

  // Store send config only — no lead lists needed (pending leads are in DB as PENDING rows)
  await _patchCampaign(config.campaignId, {
    status:        'PAUSED',
    total_sent:    _state.sent,
    total_failed:  _state.failed,
    total_skipped: _state.skipped,
    schedule_config: {
      paused_at:     _state.pausedAt,
      pending_count: pendingCount,
      cap_pause:     reason === 'cap',
      batch_pause:   reason === 'batch',
      resume_config: {
        senderProfiles:     config.senderProfiles,
        variants:           config.variants,
        mode:               config.mode,
        customSubj:         config.customSubj,
        customBody:         config.customBody,
        cfg:                { ...(config.cfg || {}), batch: config.batchSize || config.cfg?.batch },
        selectedAtts:       config.selectedAtts,
        usePersonalization: config.usePersonalization,
        attachmentText:     config.attachmentText,
        senderName:         config.senderName,
        replyTo:            config.replyTo,
      },
    },
  }, config.token)

  _notify()
}

// ─── Main run loop ────────────────────────────────────────────────────────────

export async function start(config) {
  /**
   * config shape:
   *   campaignId, campaignName, targets[], senderProfiles[], variants[],
   *   mode, customSubj, customBody,
   *   cfg: { rate, batch? }
   *   senderName, replyTo,
   *   selectedAtts[], usePersonalization, attachmentText,
   *   token,
   *   preInsertLeads?: boolean  ← true for new campaigns; false for resumes
   *   batchSize?: number        ← max emails to send per run; pauses after
   *   resumeOffset?: { sent, failed, skipped }
   */
  _state.status       = 'RUNNING'
  _state.campaignId   = config.campaignId
  _state.campaignName = config.campaignName
  const priorSent    = config.resumeOffset?.sent    || 0
  const priorFailed  = config.resumeOffset?.failed  || 0
  const priorSkipped = config.resumeOffset?.skipped || 0
  _state.total        = config.targets.length + priorSent + priorFailed + priorSkipped
  _state.sent         = priorSent
  _state.failed       = priorFailed
  _state.skipped      = priorSkipped
  _state.pending      = config.targets.length
  _state.currentLead  = ''
  _state.progress     = _state.total > 0 ? Math.round(((priorSent + priorFailed + priorSkipped) / _state.total) * 100) : 0
  _state.log          = []
  _state.pausedAt     = null
  _state.capPause     = false
  _state.batchPause   = false
  _state._abortFlag   = false
  _notify()

  // ── Pre-insert all leads as PENDING (new campaigns only, not resumes) ────────
  // This writes every target lead to campaign_leads with status='PENDING' before
  // any email is sent. On resume, the runner queries these PENDING rows — no need
  // to store target lists in schedule_config.
  if (config.preInsertLeads && config.targets.length > 0) {
    _addLog(`📋 Logging ${config.targets.length} leads in database…`, 'info')
    _notify()
    const pendingRows = config.targets.map(l => ({
      id:           l.id,
      name:         l.name         || '',
      email:        l.email        || '',
      company:      l.company      || '',
      status:       'PENDING',
      subject:      '',
      body:         '',
      variantIndex: 0,
      sentAt:       null,
    }))
    await _saveLeads(config.campaignId, pendingRows, config.token)
    _addLog(`✓ All leads queued — starting to send…`, 'info')
    _notify()
  }

  // ── Batch size: how many to send this run ─────────────────────────────────
  // If batchSize < targets.length, we send batchSize leads then PAUSE so the
  // remaining PENDING rows can be picked up by the next resume.
  const batchSize = (config.batchSize && config.batchSize < config.targets.length)
    ? config.batchSize
    : config.targets.length

  const exhaustedProfiles = new Set()

  let i = 0
  while (i < batchSize) {
    // ── Manual pause ──
    if (_state._abortFlag) {
      await _handlePause(i, config, 'manual')
      return
    }

    const l = config.targets[i]
    _state.currentLead = l.name || l.email
    _state.progress    = Math.round(((priorSent + priorFailed + priorSkipped + i + 1) / _state.total) * 100)
    _notify()

    // ── Pick a sender that hasn't hit its daily limit yet ──
    const profile = _getAvailableProfile(config.senderProfiles, exhaustedProfiles, i)
    if (!profile) {
      await _handlePause(i, config, 'cap')
      return
    }

    const vData  = _getContent(l, config, i)
    const varIdx = i % (config.variants?.length || 1)
    const result = await _sendOne(l, vData.subject, vData.body, profile, config.campaignId, config)

    // ── Sender hit its daily limit — mark exhausted, retry same lead ──
    if (result.rateLimited) {
      _addLog(`🚫 ${profile.name} hit daily limit — switching to next sender`, 'warn')
      exhaustedProfiles.add(profile.id)
      _notify()
      continue
    }

    const sentAt = Date.now()
    let leadStatus
    if (result.ok) {
      _addLog(`✓ ${l.name || l.email} → ${profile.name} (v${varIdx + 1})`, 'success')
      _state.sent++
      leadStatus = 'SENT'
    } else if (result.bounced) {
      _addLog(`⚡ BOUNCED: ${l.email}`, 'warn')
      _state.failed++
      leadStatus = 'BOUNCED'
    } else if (result.skipped) {
      _state.skipped++
      leadStatus = 'SKIPPED'
    } else {
      _addLog(`✗ Failed: ${l.email}`, 'error')
      _state.failed++
      leadStatus = 'FAILED'
    }
    _state.pending = Math.max(0, config.targets.length - i - 1)
    _notify()

    // ── Update lead in DB + honor rate-limit delay in parallel ────────────────
    // The DB update runs concurrently with the rate-limit sleep so it adds zero
    // wall-clock time when a delay is configured (typical case).
    const updatePromise = _markLeadSent(config.campaignId, {
      id: l.id, status: leadStatus, subject: vData.subject,
      body: vData.body, variantIndex: varIdx, sentAt,
    }, config.token)

    if (i < batchSize - 1 && config.cfg?.rate > 0) {
      // Parallel: both must finish before the next send
      await Promise.all([
        updatePromise,
        new Promise(r => setTimeout(r, config.cfg.rate * 1000)),
      ])
    } else {
      await updatePromise   // last lead or no rate limit — just wait for DB update
    }

    i++
  }

  // ── Batch limit reached — more PENDING leads remain in DB ─────────────────
  if (batchSize < config.targets.length) {
    await _handlePause(batchSize, config, 'batch')
    return
  }

  // ── Completed ──────────────────────────────────────────────────────────────
  _state.status      = 'DONE'
  _state.progress    = 100
  _state.pending     = 0
  _state.currentLead = ''
  _addLog(`✅ Done — ${_state.sent} sent, ${_state.failed} failed, ${_state.skipped} skipped`, 'success')
  _notify()

  await _patchCampaign(config.campaignId, {
    status:        'COMPLETED',
    total_sent:    _state.sent,
    total_failed:  _state.failed,
    total_skipped: _state.skipped,
    // Keep schedule_config — needed if user wants to requeue unsent leads later
  }, config.token)
  _notify()
}

// ─── Resume ───────────────────────────────────────────────────────────────────

export async function resume(campaign, token, fallbackProfiles = []) {
  /**
   * Works for manual/cap pauses AND interrupted (crash/page-refresh) campaigns.
   * Fetches status='PENDING' rows from campaign_leads — no target list in DB needed.
   * Then hydrates full lead data (notes, role, etc.) from the CRM store for
   * personalization.
   *
   * fallbackProfiles — active sender profiles from the UI, used when the campaign's
   * schedule_config has no senderProfiles saved (e.g. old campaigns completed before
   * the resume_config architecture was added).
   */
  const sc = campaign.schedule_config || {}
  const rc = sc.resume_config || {}

  // ── Fetch pending leads from campaign_leads table ────────────────────────────
  _addLog(`🔍 Loading pending leads…`, 'info')
  _notify()

  const pendingRows = await _fetchPendingLeads(campaign.id, token)

  if (!pendingRows.length) {
    _state.status = 'IDLE'
    _notify()
    throw new Error('No pending leads found — this campaign may already be complete')
  }

  _addLog(`📋 Found ${pendingRows.length} pending leads`, 'info')
  _notify()

  // ── Hydrate with full CRM data for personalization ────────────────────────────
  // campaign_leads only stores name/email/company; CRM store has notes/role/etc.
  const leadIds  = pendingRows.map(r => r.lead_id)
  const fullLeads = await _fetchLeadsByIds(leadIds, token)
  const leadMap  = {}
  fullLeads.forEach(l => { leadMap[String(l.id)] = l })

  const targets = pendingRows.map(r => {
    const full = leadMap[String(r.lead_id)] || {}
    return {
      id:       r.lead_id,
      email:    r.lead_email   || full.email    || '',
      name:     r.lead_name    || full.name     || '',
      company:  r.lead_company || full.company  || '',
      notes:    full.notes     || '',
      role:     full.role      || '',
      category: full.category  || '',
      tags:     full.tags      || [],
      group:    full.group     || '',
    }
  })

  await _patchCampaign(campaign.id, { status: 'RUNNING' }, token)

  // Resolve sender profiles: prefer saved resume_config, fall back to UI's active profiles
  const senderProfiles = (rc.senderProfiles?.length ? rc.senderProfiles : fallbackProfiles)
  if (!senderProfiles.length) {
    _state.status = 'IDLE'
    _notify()
    throw new Error('No sender profiles found. Go to Settings → Email Accounts and add at least one active sender.')
  }
  if (!rc.senderProfiles?.length && fallbackProfiles.length) {
    _addLog(`⚠ No saved sender config — using ${fallbackProfiles.length} active profile(s) from Settings`, 'warn')
    _notify()
  }

  // Restore batchSize from saved cfg so each resume sends the same batch limit
  const savedBatch = rc.cfg?.batch
  _addLog(savedBatch ? `📦 Batch size: ${savedBatch} per run` : `📦 No batch limit`, 'info')
  _notify()

  // Use campaign-level variants as fallback if resume_config has none
  const variants = rc.variants?.length ? rc.variants : (campaign.variants || [])
  if (variants.length) {
    _addLog(`📧 Using ${variants.length} email variant(s)`, 'info')
  } else {
    _addLog(`⚠ No email variants found — will use default template`, 'warn')
  }
  _notify()

  await start({
    campaignId:         campaign.id,
    campaignName:       campaign.name,
    targets,
    senderProfiles,
    variants,
    mode:               rc.mode               || (variants.length ? 'ai' : 'custom'),
    customSubj:         rc.customSubj         || '',
    customBody:         rc.customBody         || '',
    cfg:                rc.cfg                || { rate: 2 },
    senderName:         rc.senderName         || campaign.sender || '',
    replyTo:            rc.replyTo            || '',
    selectedAtts:       rc.selectedAtts       || [],
    usePersonalization: rc.usePersonalization || false,
    attachmentText:     rc.attachmentText     || '',
    token,
    preInsertLeads: false,   // ← PENDING rows already exist from initial insert
    batchSize:      savedBatch || undefined,  // send next N then pause again
    resumeOffset: {
      sent:    campaign.total_sent    || 0,
      failed:  campaign.total_failed  || 0,
      skipped: campaign.total_skipped || 0,
    },
  })
}
