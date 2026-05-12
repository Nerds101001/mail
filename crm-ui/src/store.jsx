// Global state — simple React context + localStorage
import { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react'

const CRMContext = createContext(null)

const load = (key, fallback) => {
  try { return JSON.parse(localStorage.getItem(key)) || fallback } catch { return fallback }
}

export function CRMProvider({ children }) {
  const [leads,      setLeads]      = useState(() => load('crm_leads', []))
  const [clients,    setClients]    = useState(() => load('crm_clients', []))
  const [deals,      setDeals]      = useState(() => load('crm_deals', []))
  const [profiles,   setProfiles]   = useState(() => load('crm_profiles', []))
  const [settings,   setSettings]   = useState(() => load('crm_settings', {}))
  const [activity,   setActivity]   = useState(() => load('crm_activity', []))
  const [gmailStatus,setGmailStatus]= useState({ connected: false, email: null })
  const saveTimerRef = useRef(null)

  // Admin "view as user" — stored in localStorage, never touches another user's localStorage cache
  const viewAsRef = useRef(localStorage.getItem('crm_viewAs') || '')
  const [viewAs,   setViewAsState]  = useState(viewAsRef.current)
  const setViewAs = useCallback((userId) => {
    viewAsRef.current = userId
    setViewAsState(userId)
    if (userId) localStorage.setItem('crm_viewAs', userId)
    else localStorage.removeItem('crm_viewAs')
  }, [])

  // Refs so push/save callbacks always read the LATEST state (avoids stale closure bug)
  const leadsRef    = useRef(leads)
  const clientsRef  = useRef(clients)
  const dealsRef    = useRef(deals)
  const profilesRef = useRef(profiles)
  const settingsRef = useRef(settings)
  const activityRef = useRef(activity)

  // Keep refs in sync with state
  useEffect(() => { leadsRef.current    = leads;    localStorage.setItem('crm_leads',    JSON.stringify(leads))    }, [leads])
  useEffect(() => { clientsRef.current  = clients;  localStorage.setItem('crm_clients',  JSON.stringify(clients))  }, [clients])
  useEffect(() => { dealsRef.current    = deals;    localStorage.setItem('crm_deals',    JSON.stringify(deals))    }, [deals])
  useEffect(() => { profilesRef.current = profiles; localStorage.setItem('crm_profiles', JSON.stringify(profiles)) }, [profiles])
  useEffect(() => { settingsRef.current = settings; localStorage.setItem('crm_settings', JSON.stringify(settings)) }, [settings])
  useEffect(() => { activityRef.current = activity; localStorage.setItem('crm_activity', JSON.stringify(activity.slice(-200))) }, [activity])

  // Helper: build the payload from refs (always current)
  function buildPayload() {
    return {
      leads:    leadsRef.current,
      clients:  clientsRef.current,
      deals:    dealsRef.current,
      profiles: profilesRef.current,
      settings: settingsRef.current,
      activity: activityRef.current.slice(-200),
    }
  }

  const pushToRedis = useCallback(() => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(async () => {
      try {
        const token = localStorage.getItem('crm_token') || ''
        await fetch('/api/crm?type=save', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
          body: JSON.stringify(buildPayload())
        })
        console.log('✅ Data saved to database')
      } catch(e) { console.warn('❌ Database sync failed:', e) }
    }, 500)
  }, []) // no deps — reads from refs, always current

  // Immediate save without debounce - for critical operations
  const saveNow = useCallback(async () => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    try {
      const token = localStorage.getItem('crm_token') || ''
      await fetch('/api/crm?type=save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify(buildPayload())
      })
      console.log('✅ Data saved immediately to database')
    } catch(e) { console.warn('❌ Database sync failed:', e) }
  }, []) // no deps — reads from refs, always current

  // Save with explicit new leads array — bypasses all state/ref timing issues.
  // Use this whenever you call setLeads() and need the save to reflect the NEW data immediately.
  const saveLeads = useCallback(async (newLeads) => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    // Update ref and localStorage right now, before the useEffect fires
    leadsRef.current = newLeads
    localStorage.setItem('crm_leads', JSON.stringify(newLeads))
    try {
      const token = localStorage.getItem('crm_token') || ''
      await fetch('/api/crm?type=save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({
          leads:    newLeads,
          clients:  clientsRef.current,
          deals:    dealsRef.current,
          profiles: profilesRef.current,
          settings: settingsRef.current,
          activity: activityRef.current.slice(-200),
        })
      })
      console.log('✅ Leads saved to database')
    } catch(e) { console.warn('❌ Database sync failed:', e) }
  }, []) // no deps — newLeads passed explicitly, rest read from refs

  const logActivity = useCallback((msg) => {
    setActivity(prev => [...prev, { time: Date.now(), msg }].slice(-200))
  }, [])

  const loadFromRedis = useCallback(async (overrideViewAs) => {
    try {
      const token = localStorage.getItem('crm_token') || ''
      // overrideViewAs lets callers pass the value directly (avoids async state lag)
      const va    = overrideViewAs !== undefined ? overrideViewAs : viewAsRef.current
      const url   = va ? `/api/crm?type=load&viewAs=${encodeURIComponent(va)}` : '/api/crm?type=load'
      const res   = await fetch(url, { headers: { 'Authorization': `Bearer ${token}` } })
      if (!res.ok) return
      const data = await res.json()

      // Always overwrite from server — never fall back to localStorage.
      // localStorage is only the initial render cache; server is always authoritative.
      setLeads(data.leads    || [])
      setClients(data.clients || [])
      setDeals(data.deals    || [])
      setProfiles(data.profiles || [])
      if (Object.keys(data.settings || {}).length) {
        // Server returns the shared key from crm:apikey — use it.
        // Only fall back to localStorage if the server didn't return one (e.g. first-run).
        const localKey = load('crm_settings', {}).openaiKey
        const key = data.settings.openaiKey || localKey
        setSettings({ ...data.settings, ...(key ? { openaiKey: key } : {}) })
      }
      if (data.activity?.length) setActivity(data.activity)

      console.log('✅ Data loaded from database:', { leads: data.leads?.length || 0, clients: data.clients?.length || 0, deals: data.deals?.length || 0, viewAs: va || 'self' })
    } catch(e) { console.warn('❌ Database load failed:', e) }
  }, [])

  const checkGmailStatus = useCallback(async () => {
    try {
      const r = await fetch('/api/ops?type=gmail-status')
      if (r.ok) setGmailStatus(await r.json())
    } catch(e) { setGmailStatus({ connected: false, email: null }) }
  }, [])

  return (
    <CRMContext.Provider value={{
      leads, setLeads, clients, setClients, deals, setDeals,
      profiles, setProfiles, settings, setSettings, activity, setActivity,
      gmailStatus, setGmailStatus, logActivity, pushToRedis, saveNow, saveLeads, loadFromRedis, checkGmailStatus,
      viewAs, setViewAs,
    }}>
      {children}
    </CRMContext.Provider>
  )
}

export const useCRM = () => useContext(CRMContext)
