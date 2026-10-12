import { useState, useEffect, useRef } from 'react'
import { Card, Btn, toast } from './ui'
import { Upload, Trash2, RefreshCw, AlertTriangle, CheckCircle2, FileCode2 } from 'lucide-react'

// Email signature — upload an .html file (e.g. exported from your design tool or
// a signature generator). The server adds it to every email you send, right under
// the closing line ("Best,"), in campaigns, single sends and follow-ups.

const authHeader = () => ({ Authorization: `Bearer ${localStorage.getItem('crm_token') || ''}` })
const call = (method, body) => fetch('/api/ops?type=signature', {
  method,
  headers: { 'Content-Type': 'application/json', ...authHeader() },
  body: body ? JSON.stringify(body) : undefined,
})

// Mock email so you can see exactly where the signature lands. Rendered in a
// sandboxed frame: no scripts can run, and styles can't leak into the CRM.
function Preview({ html }) {
  const ref = useRef(null)
  const doc = `<!doctype html><html><head><meta charset="utf-8"></head>
<body style="margin:14px 16px;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.6;color:#000;background:#fff;">
<p style="margin:0 0 14px 0;">Hi Rahul,</p>
<p style="margin:0 0 14px 0;">I noticed your team is growing fast and wanted to share a quick idea.</p>
<p style="margin:0 0 14px 0;">Would you be open to a 15-minute call this week?</p>
<p style="margin:0 0 2px 0;">Best,</p>
<div style="margin:0 0 14px 0;">${html}</div>
</body></html>`
  return (
    <iframe
      ref={ref}
      title="Signature preview"
      sandbox="allow-same-origin"
      srcDoc={doc}
      className="w-full rounded-lg border border-slate-200 bg-white"
      style={{ height: 320 }}
      onLoad={e => {
        // fit to content once images have loaded (same-origin sandbox, scripts still disabled)
        try { e.target.style.height = Math.min(900, e.target.contentDocument.documentElement.scrollHeight + 6) + 'px' } catch { /* keep default */ }
      }}
    />
  )
}

export default function SignatureCard() {
  const [sig, setSig]           = useState(null)    // { html, fileName, updatedAt, enabled } | null
  const [loading, setLoading]   = useState(true)
  const [busy, setBusy]         = useState(false)
  const [warnings, setWarnings] = useState([])
  const [dragOver, setDragOver] = useState(false)
  const fileRef = useRef(null)

  useEffect(() => {
    (async () => {
      try {
        const d = await (await call('GET')).json()
        if (d.ok) setSig(d.signature)
      } catch { /* shows the empty state */ }
      setLoading(false)
    })()
  }, [])

  async function upload(file) {
    if (!file) return
    if (!/\.html?$/i.test(file.name)) { toast('Please choose an .html file', 'error'); return }
    if (file.size > 300 * 1024)       { toast('File is too large (max 300 KB)', 'error'); return }
    setBusy(true)
    try {
      const html = await file.text()
      const res  = await call('POST', { html, fileName: file.name })
      const d    = await res.json().catch(() => ({}))
      if (!res.ok || !d.ok) throw new Error(d.error || 'Upload failed')
      setSig(d.signature)
      setWarnings(d.warnings || [])
      toast('Signature saved. It will be added to every email you send.', 'success')
    } catch (e) { toast(e.message, 'error') }
    setBusy(false)
    if (fileRef.current) fileRef.current.value = ''
  }

  async function setEnabled(enabled) {
    setBusy(true)
    try {
      const d = await (await call('POST', { enabled })).json()
      if (!d.ok) throw new Error(d.error || 'Could not update')
      setSig(d.signature)
      toast(enabled ? 'Signature switched on' : 'Signature switched off. Emails go out without it.', 'info')
    } catch (e) { toast(e.message, 'error') }
    setBusy(false)
  }

  async function remove() {
    if (!window.confirm('Remove your uploaded signature?')) return
    setBusy(true)
    try {
      const d = await (await call('DELETE')).json()
      if (!d.ok) throw new Error(d.error || 'Could not remove')
      setSig(null); setWarnings([])
      toast('Signature removed', 'info')
    } catch (e) { toast(e.message, 'error') }
    setBusy(false)
  }

  const fileInput = (
    <input ref={fileRef} type="file" accept=".html,.htm,text/html" className="hidden"
           onChange={e => upload(e.target.files?.[0])} />
  )

  return (
    <Card className="p-5">
      <h3 className="text-sm font-bold text-slate-900 mb-1 flex items-center gap-2">
        <FileCode2 size={16} className="text-indigo-500" /> Email Signature
        <span className="text-xs font-normal text-slate-400 ml-1">added to every email you send</span>
      </h3>
      <p className="text-xs text-slate-500 mb-4">
        Upload your signature as an <b>.html</b> file. It is placed right under the closing line
        (&ldquo;Best,&rdquo;) in campaigns, single emails and follow-ups. The name lines the AI types under
        &ldquo;Best,&rdquo; are replaced, so you never get two signatures.
      </p>

      {loading ? (
        <p className="text-xs text-slate-400">Loading…</p>
      ) : !sig ? (
        <>
          {fileInput}
          <div
            onDragOver={e => { e.preventDefault(); setDragOver(true) }}
            onDragLeave={() => setDragOver(false)}
            onDrop={e => { e.preventDefault(); setDragOver(false); upload(e.dataTransfer.files?.[0]) }}
            onClick={() => !busy && fileRef.current?.click()}
            className={`cursor-pointer rounded-xl border-2 border-dashed px-4 py-8 text-center transition-colors ${dragOver ? 'border-indigo-400 bg-indigo-50' : 'border-slate-200 hover:border-indigo-300 hover:bg-slate-50'}`}
          >
            <Upload size={22} className="mx-auto text-slate-400 mb-2" />
            <p className="text-sm font-medium text-slate-700">{busy ? 'Uploading…' : 'Click to choose your signature .html file'}</p>
            <p className="text-xs text-slate-400 mt-1">or drag and drop it here · max 300 KB</p>
          </div>
          <p className="text-xs text-slate-400 mt-3">
            No file uploaded: Gmail senders use the signature set in Gmail (Settings → &ldquo;Send mail as&rdquo;), if one exists.
          </p>
        </>
      ) : (
        <div className="space-y-4">
          <div className={`flex flex-wrap items-center gap-2 px-3 py-2 rounded-lg border text-xs ${sig.enabled !== false ? 'bg-emerald-50 border-emerald-200 text-emerald-700' : 'bg-slate-50 border-slate-200 text-slate-500'}`}>
            <CheckCircle2 size={14} className="flex-shrink-0" />
            <span className="font-medium">
              {sig.enabled !== false ? 'Signature is on. It goes out with every email you send.' : 'Signature is switched off. Emails go out without it.'}
            </span>
            <span className="text-slate-400">· {sig.fileName}{sig.updatedAt ? ` · saved ${new Date(sig.updatedAt).toLocaleString('en-IN')}` : ''}</span>
          </div>

          {warnings.length > 0 && (
            <div className="px-3 py-2 rounded-lg border border-amber-200 bg-amber-50 text-xs text-amber-800 space-y-1">
              <p className="font-semibold flex items-center gap-1"><AlertTriangle size={13} /> Check these:</p>
              <ul className="list-disc pl-5 space-y-0.5">{warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
            </div>
          )}

          <div>
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">Preview: how it appears at the end of your emails</p>
            <Preview html={sig.html} />
          </div>

          {fileInput}
          <div className="flex flex-wrap items-center gap-2">
            <Btn variant="secondary" size="sm" disabled={busy} onClick={() => fileRef.current?.click()}>
              <RefreshCw size={12} className="inline mr-1" /> {busy ? 'Working…' : 'Replace file'}
            </Btn>
            <label className="flex items-center gap-2 text-xs text-slate-600 cursor-pointer select-none ml-1">
              <input type="checkbox" checked={sig.enabled !== false} disabled={busy} onChange={e => setEnabled(e.target.checked)} />
              Add to my emails
            </label>
            <Btn variant="danger" size="sm" className="ml-auto" disabled={busy} onClick={remove}>
              <Trash2 size={12} className="inline mr-1" /> Remove
            </Btn>
          </div>
        </div>
      )}
    </Card>
  )
}
