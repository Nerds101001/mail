import { useState, useEffect, useRef } from 'react'
import { PageHeader, Btn, Card, toast } from '../components/ui'
import { Paperclip, Upload, Trash2, Download, FileText, Image, Film, Archive } from 'lucide-react'

function fileIcon(ct = '') {
  if (ct.startsWith('image/'))       return <Image size={16} className="text-blue-500" />
  if (ct.startsWith('video/'))       return <Film size={16} className="text-purple-500" />
  if (ct.includes('pdf'))            return <FileText size={16} className="text-red-500" />
  if (ct.includes('zip') || ct.includes('rar') || ct.includes('tar')) return <Archive size={16} className="text-amber-500" />
  return <FileText size={16} className="text-slate-400" />
}

function fmtSize(bytes) {
  if (!bytes) return '—'
  if (bytes < 1024)       return `${bytes} B`
  if (bytes < 1024*1024)  return `${(bytes/1024).toFixed(1)} KB`
  return `${(bytes/1024/1024).toFixed(2)} MB`
}

function fmtDate(ts) {
  if (!ts) return '—'
  return new Date(parseInt(ts)).toLocaleDateString('en-GB', { day:'2-digit', month:'short', year:'numeric' })
}

export default function AttachmentManager() {
  const [attachments, setAttachments] = useState([])
  const [loading, setLoading]         = useState(true)
  const [uploading, setUploading]     = useState(false)
  const fileInputRef = useRef(null)

  useEffect(() => { loadAttachments() }, [])

  async function loadAttachments() {
    setLoading(true)
    try {
      const res = await fetch('/api/attachments?type=list')
      if (res.ok) {
        const d = await res.json()
        setAttachments(d.attachments || [])
      }
    } catch (e) { toast('Could not load attachments', 'error') }
    setLoading(false)
  }

  async function handleFileSelect(e) {
    const files = Array.from(e.target.files)
    if (!files.length) return
    setUploading(true)
    let uploaded = 0
    for (const file of files) {
      try {
        // 4 MB hard limit (base64 overhead → ~3 MB raw)
        if (file.size > 4 * 1024 * 1024) {
          toast(`${file.name}: too large (max 4 MB)`, 'error')
          continue
        }
        const data = await toBase64(file)
        const res  = await fetch('/api/attachments?type=upload', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({
            name:        file.name,
            contentType: file.type || 'application/octet-stream',
            size:        file.size,
            data,
          })
        })
        if (!res.ok) throw new Error((await res.json()).error || 'Upload failed')
        uploaded++
        toast(`${file.name} uploaded ✓`, 'success')
      } catch (err) {
        toast(`${file.name}: ${err.message}`, 'error')
      }
    }
    if (uploaded) await loadAttachments()
    setUploading(false)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  function toBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload  = () => resolve(reader.result.split(',')[1]) // strip data:...;base64, prefix
      reader.onerror = reject
      reader.readAsDataURL(file)
    })
  }

  async function deleteAttachment(id, name) {
    if (!confirm(`Delete "${name}"?\nThis cannot be undone. Existing emails with this attachment link will get a 404.`)) return
    try {
      const res = await fetch(`/api/attachments?id=${id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('Delete failed')
      setAttachments(prev => prev.filter(a => a.id !== id))
      toast(`"${name}" deleted`, 'success')
    } catch (e) { toast('Could not delete', 'error') }
  }

  return (
    <div>
      <PageHeader
        title="Attachments"
        subtitle="Upload files once — attach to any campaign. Every download is tracked."
      >
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.png,.jpg,.jpeg,.gif,.zip,.txt,.csv"
          onChange={handleFileSelect}
        />
        <Btn variant="primary" onClick={() => fileInputRef.current?.click()} disabled={uploading}>
          <Upload size={14} />
          {uploading ? 'Uploading...' : 'Upload Files'}
        </Btn>
      </PageHeader>

      {loading ? (
        <div className="card p-16 text-center text-sm text-slate-400">Loading...</div>
      ) : attachments.length === 0 ? (
        <Card className="p-16 text-center">
          <Paperclip size={32} className="mx-auto text-slate-300 mb-3" />
          <p className="text-sm font-semibold text-slate-500">No attachments yet</p>
          <p className="text-xs text-slate-400 mt-1">Upload files to attach them to campaigns</p>
          <Btn variant="primary" className="mt-4" onClick={() => fileInputRef.current?.click()}>
            <Upload size={14} /> Upload your first file
          </Btn>
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50 text-xs font-bold text-slate-500 uppercase tracking-wider">
                <th className="text-left px-5 py-3">File</th>
                <th className="text-left px-4 py-3">Type</th>
                <th className="text-right px-4 py-3">Size</th>
                <th className="text-right px-4 py-3">Downloads</th>
                <th className="text-left px-4 py-3">Uploaded</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {attachments.map(a => (
                <tr key={a.id} className="border-b border-slate-50 hover:bg-slate-50 transition-colors">
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-2">
                      {fileIcon(a.content_type)}
                      <span className="font-medium text-slate-800">{a.original_name}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-400 font-mono">{a.content_type?.split('/')[1] || '—'}</td>
                  <td className="px-4 py-3 text-right text-xs text-slate-500">{fmtSize(a.size)}</td>
                  <td className="px-4 py-3 text-right">
                    <span className={`font-bold text-sm ${a.download_count > 0 ? 'text-emerald-600' : 'text-slate-400'}`}>
                      {a.download_count || 0}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-400">{fmtDate(a.uploaded_at)}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1 justify-end">
                      <a
                        href={`/api/attachments?type=download&id=${a.id}`}
                        target="_blank"
                        rel="noreferrer"
                        className="p-1.5 text-slate-400 hover:text-blue-500 hover:bg-blue-50 rounded-lg transition-colors"
                        title="Download"
                      >
                        <Download size={14} />
                      </a>
                      <button
                        onClick={() => deleteAttachment(a.id, a.original_name)}
                        className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                        title="Delete"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="px-5 py-3 border-t border-slate-100 bg-slate-50 text-xs text-slate-400 flex items-center justify-between">
            <span>{attachments.length} file{attachments.length !== 1 ? 's' : ''} stored</span>
            <span>Max file size: 4 MB · Supported: PDF, Word, Excel, PowerPoint, images, ZIP</span>
          </div>
        </Card>
      )}
    </div>
  )
}
