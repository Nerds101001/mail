import { useState, useEffect, useRef } from 'react'
import { useCRM } from '../store'
import { Card, Btn, Input, PageHeader, toast } from '../components/ui'
import { Plus, Trash2, Zap, Mail, Download, AlertTriangle, RefreshCw, Clock } from 'lucide-react'

// Token expiry countdown — updates every 30s
function TokenTimer({ expiresAt }) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30000)
    return () => clearInterval(t)
  }, [])

  if (!expiresAt || expiresAt === 0) return null
  const msLeft = expiresAt - now
  const expired = msLeft <= 0

  if (expired) {
    return (
      <span className="flex items-center gap-1 text-[10px] font-medium text-red-600 bg-red-50 px-2 py-0.5 rounded-full border border-red-200">
        <Clock size={9} /> Token expired — Re-sync needed
      </span>
    )
  }

  const mins  = Math.floor(msLeft / 60000)
  const hours = Math.floor(mins / 60)
  const label = hours > 0 ? `${hours}h ${mins % 60}m` : `${mins}m`
  const urgent = mins < 15
  const warn   = mins < 60

  return (
    <span className={`flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full border ${
      urgent ? 'text-red-600 bg-red-50 border-red-200' :
      warn   ? 'text-amber-600 bg-amber-50 border-amber-200' :
               'text-emerald-600 bg-emerald-50 border-emerald-200'
    }`}>
      <Clock size={9} /> {urgent ? '⚠ ' : ''}Token expires in {label}
    </span>
  )
}

export default function Settings() {
  const { settings, setSettings, profiles, setProfiles, leads, clients, deals, activity, pushToRedis, gmailStatus } = useCRM()
  const [apiKey,    setApiKey]    = useState('')        // blank = no change; filled = update
  const [keyDirty,  setKeyDirty]  = useState(false)    // true once admin has typed a new key
  const [smtpOpen, setSmtpOpen] = useState(false)
  const [smtp, setSmtp]       = useState({ name:'', host:'', port:'465', user:'', pass:'', secure:true, dailyCap:50 })
  const [testing, setTesting] = useState(false)
  const [smtpUsage, setSmtpUsage] = useState(null)
  const [usageLoading, setUsageLoading] = useState(false)

  // Multi-Gmail account state
  const [gmailAccounts, setGmailAccounts] = useState([])
  const [gmailLoading, setGmailLoading]   = useState(false)

  const crmToken = () => localStorage.getItem('crm_token') || ''

  // Admin check — read the role stored at login (same as Layout.jsx)
  const isAdmin = localStorage.getItem('crm_role') === 'admin'

  const loadSmtpUsage = async () => {
    setUsageLoading(true)
    try {
      const r = await fetch('/api/ops?type=smtp-usage', {
        headers: { Authorization: `Bearer ${crmToken()}` }
      })
      if (r.ok) {
        const d = await r.json()
        console.log('📊 SMTP Usage Data:', d)
        console.log('📊 Profiles count:', d.profiles?.length || 0)
        if (d.profiles?.length > 0) {
          console.log('📊 First profile:', d.profiles[0])
        }
        setSmtpUsage(d)
      } else {
        console.warn('smtp usage API error:', r.status, r.statusText)
      }
    } catch(e) { console.warn('smtp usage failed', e) }
    setUsageLoading(false)
  }

  const loadGmailAccounts = async () => {
    setGmailLoading(true)
    try {
      const r = await fetch('/api/gmail?type=status', {
        headers: { Authorization: `Bearer ${crmToken()}` }
      })
      if (r.ok) {
        const d = await r.json()
        setGmailAccounts(d.accounts || [])
      }
    } catch(e) { console.warn('gmail status failed', e) }
    setGmailLoading(false)
  }

  const getResetTime = () => {
    const now = new Date()
    const tomorrow = new Date(now)
    tomorrow.setDate(tomorrow.getDate() + 1)
    tomorrow.setHours(0, 0, 0, 0)
    const hoursLeft = Math.ceil((tomorrow - now) / (1000 * 60 * 60))
    return `Resets in ${hoursLeft}h`
  }

  useEffect(() => { loadGmailAccounts(); loadSmtpUsage() }, [])
  useEffect(() => { loadSmtpUsage() }, [profiles])

  // Sync key presence indicator whenever settings arrive from server
  // We never pre-fill the input — just track whether a key is already saved
  const keyAlreadySaved = !!(settings.openaiKey)

  async function disconnectGmail(email) {
    if (!confirm(`Disconnect ${email} from sending?`)) return
    try {
      await fetch('/api/gmail?type=disconnect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${crmToken()}` },
        body: JSON.stringify({ email })
      })
      // Remove from local profiles store
      setProfiles(profiles.filter(p => !(p.type === 'gmail' && p.user === email)))
      pushToRedis()
      await loadGmailAccounts()
      toast(`Disconnected ${email}`, 'success')
    } catch(e) { toast('Disconnect failed: ' + e.message, 'error') }
  }

  function toggleGmailActive(email) {
    setProfiles(profiles.map(p => p.type === 'gmail' && p.user === email ? { ...p, active: !p.active } : p))
    pushToRedis()
    setGmailAccounts(prev => prev.map(a => a.user === email ? { ...a, active: !a.active } : a))
  }

  function setGmailAlias(gmailUser, alias) {
    setProfiles(profiles.map(p =>
      p.type === 'gmail' && p.user === gmailUser ? { ...p, alias: alias.trim() } : p
    ))
    pushToRedis()
    toast('Send-as alias saved ✓', 'success')
  }

  // Build Gmail connect URL with the current user's token so OAuth callback saves to the right user
  const gmailConnectUrl = `/api/gmail?type=auth&token=${encodeURIComponent(crmToken())}`

  function saveKey() {
    if (!apiKey.trim()) { toast('Paste a key first', 'error'); return }
    setSettings({ ...settings, openaiKey: apiKey.trim() })
    pushToRedis()
    setApiKey('')       // clear field — key is now in DB, no need to show it
    setKeyDirty(false)
    toast('API key saved to database ✓', 'success')
  }

  async function addSmtp() {
    if (!smtp.name || !smtp.host || !smtp.user || !smtp.pass) { toast('All fields required', 'error'); return }
    const profile = { id:'profile_'+Date.now(), type:'smtp', active:true, ...smtp, dailyCap: parseInt(smtp.dailyCap) || 50 }
    const updatedProfiles = [...profiles, profile]
    setProfiles(updatedProfiles)
    // Save immediately — debounced pushToRedis() risks being overwritten by
    // loadFromRedis() (called on Dashboard mount) before the 500ms timer fires
    await fetch('/api/crm?type=save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${crmToken()}` },
      body: JSON.stringify({
        leads, clients, deals,
        profiles: updatedProfiles,
        settings,
        activity: (activity || []).slice(-200),
      }),
    }).catch(e => console.warn('SMTP profile save failed', e))
    toast('SMTP profile saved ✓', 'success')
    setSmtp({ name:'', host:'', port:'465', user:'', pass:'', secure:true, dailyCap:50 })
    setSmtpOpen(false)
  }

  async function testSmtp() {
    const testTo = prompt('Send test to:', smtp.user); if (!testTo) return
    setTesting(true)
    try {
      const res = await fetch('/api/send-smtp', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ leadId:'test', to:testTo, subject:'✅ SMTP Test — Enginerds CRM', body:'SMTP connection working!', senderName:smtp.name, smtpConfig:smtp }) })
      const data = await res.json()
      if (res.ok) toast('Test email sent!', 'success')
      else throw new Error(data.error)
    } catch(e) { toast('Test failed: '+e.message, 'error') }
    setTesting(false)
  }

  function toggleProfile(id) {
    setProfiles(profiles.map(p => p.id === id ? { ...p, active: !p.active } : p))
    pushToRedis()
  }

  function deleteProfile(id) {
    if (!confirm('Delete this profile?')) return
    setProfiles(profiles.filter(p => p.id !== id))
    pushToRedis()
  }

  function exportCSV() {
    const h = ['Name','Email','Company','Phone','PipelineStage','Status','Category','Priority','Score','Opens','Clicks','LastSent']
    const rows = leads.map(l => [l.name,l.email,l.company,l.phone||'',l.pipelineStage||'COLD',l.status,l.category,(l.tags||[]).join(';'),l.priority,l.score,l.opens,l.clicks,l.lastSent].map(v=>`"${v||''}"`).join(','))
    const blob = new Blob([[h.join(','),...rows].join('\n')], { type:'text/csv' })
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'leads.csv'; a.click()
  }

  function exportJSON() {
    const blob = new Blob([JSON.stringify({ leads, clients, deals }, null, 2)], { type:'application/json' })
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'crm-export.json'; a.click()
  }

  function clearAll() {
    if (!confirm('Clear ALL data? This cannot be undone.')) return
    // handled in parent — just clear localStorage
    localStorage.clear()
    window.location.reload()
  }

  return (
    <div>
      <PageHeader title="Settings & Config" />
      <div className="space-y-6">

        {/* Gmail Accounts */}
        <Card className="p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
              <Mail size={16} className="text-red-500" /> Gmail Accounts
              <span className="text-xs font-normal text-slate-400 ml-1">({gmailAccounts.length} connected)</span>
            </h3>
            <div className="flex items-center gap-2">
              <button onClick={loadGmailAccounts} disabled={gmailLoading} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400 transition-colors" title="Refresh">
                <RefreshCw size={13} className={gmailLoading ? 'animate-spin' : ''} />
              </button>
              <a
                href={gmailConnectUrl}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-white border border-slate-200 hover:border-slate-300 rounded-lg text-slate-700 transition-colors"
              >
                <svg width="13" height="13" viewBox="0 0 24 24"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>
                Connect Gmail Account
              </a>
            </div>
          </div>

          {gmailAccounts.length === 0 ? (
            <div className="text-center py-6 text-sm text-slate-400 border border-dashed border-slate-200 rounded-xl">
              <Mail size={24} className="mx-auto mb-2 text-slate-300" />
              No Gmail accounts connected yet.<br />
              <span className="text-xs">Click "Connect Gmail Account" to add one.</span>
            </div>
          ) : (
            <div className="space-y-2">
              {gmailAccounts.map((acc, i) => {
                const profileEntry = profiles.find(p => p.type === 'gmail' && p.user === acc.user)
                const isActive = profileEntry ? profileEntry.active : acc.active
                const currentAlias = profileEntry?.alias || ''
                // Debug matching logic
                const gmailUsageMatch = smtpUsage?.profiles?.find(p => p.email === acc.user)
                if (i === 0) {
                  console.log('🧪 Gmail Account Debug:', { acc_user: acc.user, has_smtpUsage: !!smtpUsage, profiles_count: smtpUsage?.profiles?.length, gmailUsageMatch })
                }
                return (
                  <div key={acc.user || i} className={`rounded-xl border transition-colors ${isActive ? 'bg-emerald-50 border-emerald-200' : 'bg-slate-50 border-slate-200'}`}>
                    {/* Top row */}
                    <div className="flex items-center gap-3 p-3">
                      <input
                        type="checkbox"
                        className="rounded"
                        checked={!!isActive}
                        onChange={() => toggleGmailActive(acc.user)}
                        title="Enable/disable for round-robin"
                      />
                      <svg width="16" height="16" viewBox="0 0 24 24" className="flex-shrink-0"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-slate-800 truncate">{acc.name || acc.email} <span className="text-xs text-slate-400 font-normal">(GMAIL)</span></p>
                        <p className="text-xs text-slate-500 font-mono truncate">OAuth: {acc.user || acc.email}</p>
                        <div className="mt-1">
                          <TokenTimer expiresAt={acc.expiresAt} />
                        </div>
                      </div>
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium flex-shrink-0 ${isActive ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
                        {isActive ? 'Active' : 'Disabled'}
                      </span>
                      {gmailUsageMatch ? (
                        <span className="text-xs text-slate-600 flex-shrink-0 bg-blue-50 px-2.5 py-1 rounded-full border border-blue-100 font-medium">
                          {gmailUsageMatch.sent}/{gmailUsageMatch.limit} · {getResetTime()}
                        </span>
                      ) : (
                        <span className="text-xs text-slate-400 flex-shrink-0 bg-slate-50 px-2.5 py-1 rounded-full border border-slate-100">
                          Cap: {acc.dailyCap || 500}/day
                        </span>
                      )}
                      {/* Re-sync: re-run OAuth for this specific account to get fresh tokens */}
                      <a
                        href={`/api/gmail?type=auth&token=${encodeURIComponent(crmToken())}&login_hint=${encodeURIComponent(acc.user || acc.email || '')}`}
                        className={`p-1.5 rounded-lg transition-colors flex-shrink-0 flex items-center gap-1 text-[11px] font-medium border ${
                          acc.tokenExpired
                            ? 'bg-red-50 border-red-200 text-red-600 hover:bg-red-100'
                            : 'bg-blue-50 border-blue-200 text-blue-600 hover:bg-blue-100'
                        }`}
                        title="Re-sync token — re-authorize this Gmail account to get a fresh token"
                      >
                        <RefreshCw size={11} /> Re-sync
                      </a>
                      <button
                        className="p-1.5 rounded-lg hover:bg-red-50 text-red-400 transition-colors flex-shrink-0"
                        onClick={() => disconnectGmail(acc.user || acc.email)}
                        title="Disconnect"
                      ><Trash2 size={13} /></button>
                    </div>
                    {/* Alias row */}
                    <div className="px-3 pb-3 flex items-center gap-2">
                      <span className="text-xs text-slate-500 whitespace-nowrap">Send as (From):</span>
                      <input
                        type="email"
                        className="flex-1 text-xs border border-slate-200 rounded-lg px-2.5 py-1.5 bg-white focus:outline-none focus:ring-1 focus:ring-emerald-400 focus:border-emerald-400 placeholder-slate-300"
                        placeholder={`e.g. admin@enginerds.in  (leave blank to send as ${acc.user || acc.email})`}
                        defaultValue={currentAlias}
                        onBlur={e => { if (e.target.value.trim() !== currentAlias) setGmailAlias(acc.user, e.target.value) }}
                        onKeyDown={e => { if (e.key === 'Enter') { e.target.blur() } }}
                      />
                      {currentAlias && (
                        <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full whitespace-nowrap font-medium">
                          → {currentAlias}
                        </span>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
          <p className="text-xs text-slate-400 mt-3">Active accounts participate in round-robin sending. You can connect as many Gmail accounts as you need.</p>
        </Card>

        {/* NVIDIA AI — admin only */}
        {isAdmin && (
          <Card className="p-5">
            <h3 className="text-sm font-bold text-slate-900 mb-1 flex items-center gap-2">
              <Zap size={16} className="text-emerald-500" /> NVIDIA NIM AI
              <span className="text-xs font-normal text-slate-400 ml-1">shared across all users</span>
            </h3>

            {/* Key status banner */}
            {keyAlreadySaved && !keyDirty && (
              <div className="flex items-center gap-2 mb-3 px-3 py-2 bg-emerald-50 border border-emerald-200 rounded-lg text-xs text-emerald-700">
                <span className="w-2 h-2 bg-emerald-500 rounded-full flex-shrink-0" />
                API key is configured and active — all users can generate AI emails.
                <button
                  className="ml-auto text-emerald-600 underline underline-offset-2 hover:text-emerald-800"
                  onClick={() => setKeyDirty(true)}
                >
                  Update key
                </button>
              </div>
            )}

            {/* Input only shown when no key exists OR admin clicks "Update key" */}
            {(!keyAlreadySaved || keyDirty) && (
              <div className="space-y-3">
                <div className="flex gap-3">
                  <input
                    className="input flex-1"
                    type="password"
                    value={apiKey}
                    onChange={e => setApiKey(e.target.value)}
                    placeholder={keyAlreadySaved ? 'Paste new key to replace the current one' : 'nvapi-...'}
                    autoFocus={keyDirty}
                  />
                  <Btn variant="primary" onClick={saveKey} disabled={!apiKey.trim()}>Save Key</Btn>
                  {keyDirty && (
                    <Btn variant="secondary" onClick={() => { setApiKey(''); setKeyDirty(false) }}>Cancel</Btn>
                  )}
                </div>
                <p className="text-xs text-slate-400">
                  NVIDIA NIM (Llama 3.3 70B) · Key stored once in the database, shared with all users ·{' '}
                  <a href="https://build.nvidia.com" target="_blank" rel="noreferrer" className="text-emerald-600 underline">build.nvidia.com</a>
                </p>
              </div>
            )}

            {/* Test button — always visible to admin when a key exists */}
            {keyAlreadySaved && (
              <div className="mt-3">
                <Btn variant="secondary" size="sm" disabled={testing} onClick={async () => {
                  setTesting(true)
                  try {
                    const res = await fetch('/api/ops?type=test-nvidia', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ apiKey: settings.openaiKey })
                    })
                    const data = await res.json()
                    if (data.ok) toast(`✅ NVIDIA key valid — reply: "${data.reply}"`, 'success')
                    else toast(`❌ Key failed: ${data.error}`, 'error')
                  } catch(e) { toast('Test failed: ' + e.message, 'error') }
                  setTesting(false)
                }}>
                  {testing ? '...' : '🧪 Test Key'}
                </Btn>
              </div>
            )}
          </Card>
        )}

        {/* Sender Profiles */}
        <Card className="p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-bold text-slate-900">Sender Profiles</h3>
            <div className="flex gap-2">
              <Btn variant="secondary" size="sm" onClick={() => setSmtpOpen(!smtpOpen)}><Plus size={13} /> Add SMTP</Btn>
              <a href={gmailConnectUrl} className="btn-secondary text-xs px-3 py-1.5 flex items-center gap-1.5">+ Connect Gmail</a>
            </div>
          </div>

          {smtpOpen && (
            <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 mb-4 space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Input label="Profile Name" value={smtp.name} onChange={e=>setSmtp({...smtp,name:e.target.value})} placeholder="Work Email" />
                <Input label="SMTP Host" value={smtp.host} onChange={e=>setSmtp({...smtp,host:e.target.value})} placeholder="smtp.gmail.com" />
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <Input label="Port" value={smtp.port} onChange={e=>setSmtp({...smtp,port:e.target.value})} />
                <Input label="Email / User" type="email" value={smtp.user} onChange={e=>setSmtp({...smtp,user:e.target.value})} placeholder="me@company.com" />
                <Input label="Password" type="password" value={smtp.pass} onChange={e=>setSmtp({...smtp,pass:e.target.value})} />
                <Input label="Daily Cap" type="number" value={smtp.dailyCap} onChange={e=>setSmtp({...smtp,dailyCap:e.target.value})} title="Max emails per day from this account (warmup limit)" />
              </div>
              <div className="flex items-center justify-between">
                <label className="flex items-center gap-2 text-sm text-slate-600 cursor-pointer">
                  <input type="checkbox" checked={smtp.secure} onChange={e=>setSmtp({...smtp,secure:e.target.checked})} className="rounded" />
                  SSL/TLS
                </label>
                <div className="flex gap-2">
                  <Btn variant="secondary" size="sm" onClick={testSmtp} disabled={testing}>{testing ? 'Testing...' : '⚡ Test'}</Btn>
                  <Btn variant="primary" size="sm" onClick={addSmtp}>Save Profile</Btn>
                </div>
              </div>
            </div>
          )}

          {/* SMTP Usage Summary */}
          {smtpUsage && smtpUsage.total && smtpUsage.profiles.length > 0 && (
            <div className="mb-4 p-4 bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-200 rounded-xl">
              <div className="flex items-center justify-between mb-3">
                <p className="text-sm font-semibold text-slate-900">Today's Email Usage</p>
                <span className="text-xs text-slate-500">{new Date().toLocaleDateString()}</span>
              </div>

              {/* Total usage bar */}
              <div className="mb-4">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-medium text-slate-700">Total Capacity</span>
                  <span className="text-sm font-bold text-slate-900">{smtpUsage.total.sent} / {smtpUsage.total.limit}</span>
                </div>
                <div className="w-full bg-slate-200 rounded-full h-2.5 overflow-hidden">
                  <div
                    className={`h-2.5 rounded-full transition-all ${
                      smtpUsage.total.percentage >= 90 ? 'bg-red-500' :
                      smtpUsage.total.percentage >= 70 ? 'bg-amber-500' :
                      'bg-emerald-500'
                    }`}
                    style={{ width: `${Math.min(100, smtpUsage.total.percentage)}%` }}
                  />
                </div>
                <p className="text-xs text-slate-600 mt-1">{smtpUsage.total.percentage}% used · {smtpUsage.total.remaining} remaining</p>
              </div>

              {/* Per-profile breakdown */}
              {smtpUsage.profiles.length > 1 && (
                <div className="space-y-2 border-t border-blue-100 pt-3">
                  {smtpUsage.profiles.map(p => (
                    <div key={p.id} className="flex items-center justify-between text-xs">
                      <span className="text-slate-700 font-medium">{p.name}</span>
                      <span className="text-slate-600">{p.sent} / {p.limit}</span>
                      <div className="w-24 bg-slate-200 rounded-full h-1.5 overflow-hidden">
                        <div
                          className={`h-1.5 rounded-full ${
                            p.percentage >= 90 ? 'bg-red-500' :
                            p.percentage >= 70 ? 'bg-amber-500' :
                            'bg-emerald-500'
                          }`}
                          style={{ width: `${Math.min(100, p.percentage)}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {profiles.length === 0 ? (
            <div className="text-center py-8 text-sm text-slate-400 border border-dashed border-slate-200 rounded-xl">No profiles added yet</div>
          ) : (
            <div className="space-y-2">
              {profiles.map(p => (
                <div key={p.id} className="flex items-center gap-3 p-3 bg-slate-50 border border-slate-200 rounded-xl hover:border-slate-300 transition-colors">
                  <input type="checkbox" className="rounded" checked={p.active} onChange={() => toggleProfile(p.id)} />
                  <div className="flex-1">
                    <p className="text-sm font-semibold text-slate-800">{p.name} <span className="text-xs text-slate-400 font-normal">({p.type.toUpperCase()})</span></p>
                    <p className="text-xs text-emerald-600 font-mono">{p.user || p.email}</p>
                  </div>
                  <button className="p-1.5 rounded-lg hover:bg-red-50 text-red-400 transition-colors" onClick={() => deleteProfile(p.id)}><Trash2 size={13} /></button>
                </div>
              ))}
            </div>
          )}
        </Card>

        {/* Data Management — admin only */}
        {isAdmin && (
          <Card className="p-5">
            <h3 className="text-sm font-bold text-slate-900 mb-4 flex items-center gap-2"><Download size={16} className="text-slate-500" /> Data Management</h3>
            <div className="flex gap-3 flex-wrap">
              <Btn variant="secondary" onClick={exportCSV}><Download size={13} /> Export Leads CSV</Btn>
              <Btn variant="secondary" onClick={exportJSON}><Download size={13} /> Export JSON</Btn>
              <Btn variant="danger" onClick={clearAll}><AlertTriangle size={13} /> Clear All Data</Btn>
            </div>
          </Card>
        )}

        {/* Deployment Info */}
        <Card className="p-5">
          <h3 className="text-sm font-bold text-slate-900 mb-3">Deployment Info</h3>
          <div className="bg-slate-50 rounded-lg p-3 font-mono text-xs text-slate-600 space-y-1">
            <div>App URL: <span className="text-emerald-600">{window.location.origin}</span></div>
            <div>Gmail: <span className="text-slate-800">{gmailStatus.connected ? gmailStatus.email : 'Not connected'}</span></div>
          </div>
        </Card>
      </div>
    </div>
  )
}
