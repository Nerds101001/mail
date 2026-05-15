// campaignRunner.js — module-level singleton
// Lives outside React — survives component unmounts during SPA navigation.
// Campaign.jsx kicks it off, Layout.jsx subscribes for the floating banner,
// CampaignHistory.jsx subscribes for live progress on the RUNNING row.

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

async function _saveLeads(campaignId, leads, token) {
  if (!leads.length) return
  // Batch leads in groups of 50 to avoid oversized requests
  for (let i = 0; i < leads.length; i += 50) {
    const batch = leads.slice(i, i + 50)
    try {
      await fetch('/api/campaigns', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body:    JSON.stringify({ id: campaignId, leads_only: true, leads: batch }),
      })
    } catch(e) { console.warn('[Runner] saveLeads batch failed:', e.message) }
  }
}

// ─── Fetch leads by IDs from the CRM store (used on resume) ─────────────────
async function _fetchLeadsByIds(ids, token) {
  if (!ids?.length) return []
  try {
    // Batch in groups of 200 to stay well under URL length limits
    const leads = []
    for (let i = 0; i < ids.length; i += 200) {
      const batch = ids.slice(i, i + 200)
      const res = await fetch(`/api/crm?type=leads_by_ids&ids=${batch.join(',')}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) { console.warn('[Runner] leads_by_ids batch failed:', res.status); continue }
      const data = await res.json()
      leads.push(...(Array.isArray(data) ? data : []))
    }
    return leads
  } catch(e) {
    console.warn('[Runner] _fetchLeadsByIds failed:', e.message)
    return []
  }
}

// ─── Pause handler ────────────────────────────────────────────────────────────

async function _handlePause(fromIndex, config, doneLeads, reason) {
  // Store only lead IDs for remaining targets — full objects bloat the PATCH body
  // (can be 200+ KB for 1000 leads and triggers nginx 413 errors).
  // On resume, _fetchLeadsByIds re-hydrates leads from the CRM store.
  const remainingIds = config.targets.slice(fromIndex).map(l => l.id)
  const pendingCount = remainingIds.length

  _state.status   = 'PAUSED'
  _state.pending  = pendingCount
  _state.pausedAt = Date.now()
  _state.capPause = reason === 'cap'

  const msg = reason === 'cap'
    ? `🚫 All senders hit daily limit — ${pendingCount} leads pending. Resume in 24h.`
    : `⏸ Paused manually — ${pendingCount} leads pending. Resume in 24h.`
  _addLog(msg, 'warn')
  _notify()

  // Only save completed (SENT/FAILED/BOUNCED) leads — NOT pending.
  // Pending leads are stored in schedule_config.resume_config.targets_remaining.
  // Saving PENDING rows here would create duplicates when resume completes and
  // re-inserts the same leads as SENT.
  await _saveLeads(config.campaignId, doneLeads, config.token)

  // Patch campaign with PAUSED status + resume config (compact IDs only for leads)
  await _patchCampaign(config.campaignId, {
    status:        'PAUSED',
    total_sent:    _state.sent,
    total_failed:  _state.failed,
    total_skipped: _state.skipped,
    schedule_config: {
      paused_at:     _state.pausedAt,
      pending_count: remainingIds.length,
      cap_pause:     reason === 'cap',
      resume_config: {
        remaining_lead_ids: remainingIds,    // ← compact: IDs only (not full objects)
        senderProfiles:    config.senderProfiles,
        variants:          config.variants,
        mode:              config.mode,
        customSubj:        config.customSubj,
        customBody:        config.customBody,
        cfg:               config.cfg,
        selectedAtts:      config.selectedAtts,
        usePersonalization: config.usePersonalization,
        attachmentText:    config.attachmentText,
        senderName:        config.senderName,
        replyTo:           config.replyTo,
      },
    },
  }, config.token)

  _notify()
}

// ─── Checkpoint (save progress to DB every N leads) ──────────────────────────
// Flushes the in-memory doneLeads buffer to DB and updates targets_remaining so
// the campaign is resumable after a page refresh / network drop.

const CHECKPOINT_EVERY = 10   // save to DB after every 10 sends

async function _checkpoint(nextIndex, config, batch) {
  // 1. Save the just-completed batch of leads
  if (batch.length) await _saveLeads(config.campaignId, batch, config.token)

  // 2. Compute remaining lead IDs (compact — avoids nginx 413 on large campaigns)
  const remainingIds = config.targets.slice(nextIndex).map(l => l.id)

  // 3. Update DB: current stats + compact resume_config
  await _patchCampaign(config.campaignId, {
    total_sent:    _state.sent,
    total_failed:  _state.failed,
    total_skipped: _state.skipped,
    schedule_config: {
      resume_config: {
        remaining_lead_ids: remainingIds,    // ← IDs only, full data fetched on resume
        senderProfiles:    config.senderProfiles,
        variants:          config.variants,
        mode:              config.mode,
        customSubj:        config.customSubj,
        customBody:        config.customBody,
        cfg:               config.cfg,
        selectedAtts:      config.selectedAtts,
        usePersonalization: config.usePersonalization,
        attachmentText:    config.attachmentText,
        senderName:        config.senderName,
        replyTo:           config.replyTo,
      },
    },
  }, config.token)
}

// ─── Main run loop ────────────────────────────────────────────────────────────

export async function start(config) {
  /**
   * config shape:
   *   campaignId, campaignName, targets[], senderProfiles[], variants[],
   *   mode, customSubj, customBody,
   *   cfg: { rate }
   *   senderName, replyTo,
   *   selectedAtts[], usePersonalization, attachmentText,
   *   token,
   *   resumeOffset?: { sent, failed, skipped }  ← carries over stats from a previous
   *                                                 partial run (crash recovery / resume)
   */
  _state.status       = 'RUNNING'
  _state.campaignId   = config.campaignId
  _state.campaignName = config.campaignName
  // For resumes: total includes leads already sent in prior runs so progress is accurate
  const priorSent    = config.resumeOffset?.sent    || 0
  const priorFailed  = config.resumeOffset?.failed  || 0
  const priorSkipped = config.resumeOffset?.skipped || 0
  _state.total        = config.targets.length + priorSent + priorFailed + priorSkipped
  _state.sent         = priorSent
  _state.failed       = priorFailed
  _state.skipped      = priorSkipped
  _state.pending      = 0
  _state.currentLead  = ''
  _state.progress     = _state.total > 0 ? Math.round(((priorSent + priorFailed + priorSkipped) / _state.total) * 100) : 0
  _state.log          = []
  _state.pausedAt     = null
  _state.capPause     = false
  _state._abortFlag   = false
  _notify()

  const doneLeads = []          // buffer — flushed every CHECKPOINT_EVERY leads
  const exhaustedProfiles = new Set()

  let i = 0
  while (i < config.targets.length) {
    // ── Manual pause ──
    if (_state._abortFlag) {
      await _handlePause(i, config, doneLeads, 'manual')
      return
    }

    const l = config.targets[i]
    _state.currentLead = l.name || l.email
    _state.progress    = Math.round(((priorSent + priorFailed + priorSkipped + i + 1) / _state.total) * 100)
    _notify()

    // ── Pick a sender that hasn't hit its daily limit yet ──
    const profile = _getAvailableProfile(config.senderProfiles, exhaustedProfiles, i)
    if (!profile) {
      await _handlePause(i, config, doneLeads, 'cap')
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
    if (result.ok) {
      _addLog(`✓ ${l.name || l.email} → ${profile.name} (v${varIdx + 1})`, 'success')
      _state.sent++
      doneLeads.push({ id: l.id, name: l.name || '', email: l.email, company: l.company || '', status: 'SENT',    subject: vData.subject, body: vData.body, variantIndex: varIdx, sentAt })
    } else if (result.bounced) {
      _addLog(`⚡ BOUNCED: ${l.email}`, 'warn')
      _state.failed++
      doneLeads.push({ id: l.id, name: l.name || '', email: l.email, company: l.company || '', status: 'BOUNCED', subject: vData.subject, body: vData.body, variantIndex: varIdx, sentAt })
    } else if (result.skipped) {
      _state.skipped++
      doneLeads.push({ id: l.id, name: l.name || '', email: l.email, company: l.company || '', status: 'SKIPPED', subject: vData.subject, body: vData.body, variantIndex: varIdx, sentAt })
    } else {
      _addLog(`✗ Failed: ${l.email}`, 'error')
      _state.failed++
      doneLeads.push({ id: l.id, name: l.name || '', email: l.email, company: l.company || '', status: 'FAILED',  subject: vData.subject, body: vData.body, variantIndex: varIdx, sentAt })
    }
    _notify()

    // ── Checkpoint every CHECKPOINT_EVERY leads ──
    // Drains the buffer to DB so progress survives a page refresh or network drop.
    if (doneLeads.length >= CHECKPOINT_EVERY) {
      const batch = doneLeads.splice(0)   // drain buffer in-place
      await _checkpoint(i + 1, config, batch).catch(e => console.warn('[Runner] checkpoint failed:', e.message))
    }

    if (i < config.targets.length - 1 && config.cfg?.rate > 0) {
      await new Promise(r => setTimeout(r, config.cfg.rate * 1000))
    }
    i++
  }

  // ── Completed — flush any remaining buffered leads ──
  _state.status      = 'DONE'
  _state.progress    = 100
  _state.currentLead = ''
  _addLog(`✅ Done — ${_state.sent} sent, ${_state.failed} failed, ${_state.skipped} skipped`, 'success')
  _notify()

  await _saveLeads(config.campaignId, doneLeads, config.token)
  await _patchCampaign(config.campaignId, {
    status:        'COMPLETED',
    total_sent:    _state.sent,
    total_failed:  _state.failed,
    total_skipped: _state.skipped,
    schedule_config: {},   // clear resume config — campaign is done
  }, config.token)
  _notify()
}

// ─── Resume ───────────────────────────────────────────────────────────────────

export async function resume(campaign, token) {
  /**
   * campaign = full campaign object from DB.
   * Works for both manual/cap pauses AND interrupted (crashed) campaigns.
   * Supports two resume_config formats:
   *   - Legacy: targets_remaining (full lead objects) — kept for backward compat
   *   - Compact: remaining_lead_ids (just IDs) — fetched from CRM store on resume
   */
  const sc = campaign.schedule_config || {}
  const rc = sc.resume_config || {}

  // ── Resolve targets ──────────────────────────────────────────────────────────
  let targets = []

  if (rc.targets_remaining?.length) {
    // Legacy format — full lead objects already in the DB record
    targets = rc.targets_remaining
  } else if (rc.remaining_lead_ids?.length) {
    // Compact format — fetch full lead data from CRM store by IDs
    console.log(`[Runner] Fetching ${rc.remaining_lead_ids.length} leads by ID for resume…`)
    targets = await _fetchLeadsByIds(rc.remaining_lead_ids, token)
    if (!targets.length) {
      console.warn('[Runner] resume: fetchLeadsByIds returned no leads')
      throw new Error('Could not load leads for this campaign — they may have been deleted')
    }
    console.log(`[Runner] Loaded ${targets.length} leads for resume`)
  }

  if (!targets.length) {
    console.warn('[Runner] resume called but no targets found in resume_config')
    return
  }

  await _patchCampaign(campaign.id, { status: 'RUNNING' }, token)

  const config = {
    campaignId:        campaign.id,
    campaignName:      campaign.name,
    targets,
    senderProfiles:    rc.senderProfiles    || [],
    variants:          rc.variants          || [],
    mode:              rc.mode              || 'ai',
    customSubj:        rc.customSubj        || '',
    customBody:        rc.customBody        || '',
    cfg:               rc.cfg               || { rate: 2 },
    senderName:        rc.senderName        || '',
    replyTo:           rc.replyTo           || '',
    selectedAtts:      rc.selectedAtts      || [],
    usePersonalization: rc.usePersonalization || false,
    attachmentText:    rc.attachmentText    || '',
    token,
    // Carry forward stats so progress bar and final totals accumulate correctly
    resumeOffset: {
      sent:    campaign.total_sent    || 0,
      failed:  campaign.total_failed  || 0,
      skipped: campaign.total_skipped || 0,
    },
  }

  await start(config)
}
