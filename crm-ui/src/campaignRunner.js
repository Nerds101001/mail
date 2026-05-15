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

// ─── Pause handler ────────────────────────────────────────────────────────────

async function _handlePause(fromIndex, config, doneLeads, reason) {
  // Leads not yet sent — stored in resume config, NOT in campaign_leads
  // (saving them as PENDING would create duplicate rows when resume re-inserts them as SENT)
  const resumeTargets = config.targets.slice(fromIndex).map(l => ({
    id: l.id, email: l.email, name: l.name || '', company: l.company || '',
    notes: l.notes || '', role: l.role || '', category: l.category || '',
    tags: l.tags || [], group: l.group || '',
  }))
  const pendingCount = resumeTargets.length

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

  // Patch campaign with PAUSED status + resume config
  await _patchCampaign(config.campaignId, {
    status:        'PAUSED',
    total_sent:    _state.sent,
    total_failed:  _state.failed,
    total_skipped: _state.skipped,
    schedule_config: {
      paused_at:     _state.pausedAt,
      pending_count: resumeTargets.length,
      cap_pause:     reason === 'cap',
      resume_config: {
        targets_remaining: resumeTargets,
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

// ─── Main run loop ────────────────────────────────────────────────────────────

export async function start(config) {
  /**
   * config shape:
   *   campaignId, campaignName, targets[], senderProfiles[], variants[],
   *   mode, customSubj, customBody,
   *   cfg: { rate, senderName, replyTo }  ← kept for compat; also flat senderName/replyTo
   *   senderName, replyTo,
   *   selectedAtts[], usePersonalization, attachmentText,
   *   token
   */
  _state.status       = 'RUNNING'
  _state.campaignId   = config.campaignId
  _state.campaignName = config.campaignName
  _state.total        = config.targets.length
  _state.sent         = 0
  _state.failed       = 0
  _state.skipped      = 0
  _state.pending      = 0
  _state.currentLead  = ''
  _state.progress     = 0
  _state.log          = []
  _state.pausedAt     = null
  _state.capPause     = false
  _state._abortFlag   = false
  _notify()

  const doneLeads = []
  // Profiles that returned a server-side rate-limit error this run.
  // Cleared on each fresh start() call so resume picks up with a clean slate.
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
    _state.progress    = Math.round(((i + 1) / config.targets.length) * 100)
    _notify()

    // ── Pick a sender that hasn't hit its daily limit yet ──
    const profile = _getAvailableProfile(config.senderProfiles, exhaustedProfiles, i)
    if (!profile) {
      // Every sender returned a rate-limit error — pause until limits reset (24 h)
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
      continue   // i stays the same; next iteration picks a different profile
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

    if (i < config.targets.length - 1 && config.cfg?.rate > 0) {
      await new Promise(r => setTimeout(r, config.cfg.rate * 1000))
    }
    i++
  }

  // ── Completed ──
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
  }, config.token)
  _notify()
}

// ─── Resume ───────────────────────────────────────────────────────────────────

export async function resume(campaign, token) {
  /**
   * campaign = the full campaign object from DB (has schedule_config.resume_config)
   */
  const sc = campaign.schedule_config || {}
  const rc = sc.resume_config || {}

  if (!rc.targets_remaining?.length) {
    console.warn('[Runner] resume called but no targets_remaining found')
    return
  }

  // Mark RUNNING in DB immediately
  await _patchCampaign(campaign.id, { status: 'RUNNING' }, token)

  const config = {
    campaignId:        campaign.id,
    campaignName:      campaign.name,
    targets:           rc.targets_remaining,
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
  }

  await start(config)
}
