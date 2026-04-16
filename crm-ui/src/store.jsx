// Global state — simple React context + localStorage
import { createContext, useContext, useState, useEffect, useCallback } from 'react'

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
  const [saveTimer,  setSaveTimer]  = useState(null)

  // Persist to localStorage
  useEffect(() => { localStorage.setItem('crm_leads',    JSON.stringify(leads))    }, [leads])
  useEffect(() => { localStorage.setItem('crm_clients',  JSON.stringify(clients))  }, [clients])
  useEffect(() => { localStorage.setItem('crm_deals',    JSON.stringify(deals))    }, [deals])
  useEffect(() => { localStorage.setItem('crm_profiles', JSON.stringify(profiles)) }, [profiles])
  useEffect(() => { localStorage.setItem('crm_settings', JSON.stringify(settings)) }, [settings])
  useEffect(() => { localStorage.setItem('crm_activity', JSON.stringify(activity.slice(-200))) }, [activity])

  const pushToRedis = useCallback(() => {
    if (saveTimer) clearTimeout(saveTimer)
    const t = setTimeout(async () => {
      try {
        await fetch('/api/crm?type=save', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ leads, clients, deals, profiles, settings, activity: activity.slice(-200) })
        })
      } catch(e) { console.warn('Redis sync failed') }
    }, 3000)
    setSaveTimer(t)
  }, [leads, clients, deals, profiles, settings, activity])

  const logActivity = useCallback((msg) => {
    setActivity(prev => [...prev, { time: Date.now(), msg }].slice(-200))
  }, [])

  const loadFromRedis = useCallback(async () => {
    try {
      const res = await fetch('/api/crm?type=load')
      if (!res.ok) return
      const data = await res.json()
      if (data.leads?.length)    setLeads(data.leads)
      if (data.clients?.length)  setClients(data.clients)
      if (data.deals?.length)    setDeals(data.deals)
      if (data.profiles?.length) setProfiles(data.profiles)
      if (Object.keys(data.settings||{}).length) {
        // Preserve openaiKey from localStorage — it's never saved to Redis for security
        const localKey = load('crm_settings', {}).openaiKey
        setSettings({ ...data.settings, ...(localKey ? { openaiKey: localKey } : {}) })
      }
      if (data.activity?.length) setActivity(data.activity)
    } catch(e) { console.warn('Redis load failed') }
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
      gmailStatus, setGmailStatus, logActivity, pushToRedis, loadFromRedis, checkGmailStatus
    }}>
      {children}
    </CRMContext.Provider>
  )
}

export const useCRM = () => useContext(CRMContext)
