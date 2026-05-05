import { useState, useEffect } from 'react'
import { Card, PageHeader, toast } from '../components/ui'
import { Plus, RefreshCw, Download, Trash2, Upload } from 'lucide-react'

export default function AttachmentManager() {
  const [attachments, setAttachments] = useState([])
  const [loading, setLoading] = useState(false)
  const [uploadLoading, setUploadLoading] = useState(false)

  useEffect(() => {
    loadAttachments()
  }, [])

  async function loadAttachments() {
    setLoading(true)
    try {
      const res = await fetch('/api/attachments?type=list')
      const data = await res.json()
      setAttachments(data.attachments || [])
      console.log('Loaded attachments:', data.attachments)
    } catch (error) {
      console.error('Failed to load attachments:', error)
      toast('Failed to load attachments', 'error')
    }
    setLoading(false)
  }

  async function uploadFromUrl(url, label) {
    if (!url || !label) {
      toast('Please provide both URL and label', 'error')
      return
    }

    setUploadLoading(true)
    try {
      const res = await fetch('/api/attachments?type=upload-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, label })
      })
      
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      
      toast(`Attachment "${label}" uploaded successfully`, 'success')
      await loadAttachments() // Refresh list
      
    } catch (error) {
      console.error('Upload error:', error)
      toast(`Upload failed: ${error.message}`, 'error')
    }
    setUploadLoading(false)
  }

  async function deleteAttachment(id) {
    if (!confirm('Delete this attachment?')) return
    
    try {
      const res = await fetch(`/api/attachments?type=delete&id=${id}`, {
        method: 'DELETE'
      })
      
      if (!res.ok) throw new Error('Delete failed')
      
      toast('Attachment deleted', 'success')
      await loadAttachments() // Refresh list
      
    } catch (error) {
      console.error('Delete error:', error)
      toast(`Delete failed: ${error.message}`, 'error')
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Attachment Manager" subtitle="Upload and manage email attachments">
        <button 
          onClick={loadAttachments}
          disabled={loading}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
        >
          <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
          Refresh
        </button>
      </PageHeader>

      {/* Upload Section */}
      <Card className="p-6">
        <h3 className="text-lg font-semibold mb-4">Upload New Attachment</h3>
        
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Attachment Label
              </label>
              <input 
                type="text"
                id="upload-label"
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="e.g., Product Brochure, Price List"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                File URL
              </label>
              <input 
                type="url"
                id="upload-url"
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="https://drive.google.com/file/d/... or direct URL"
              />
            </div>
          </div>
          
          <div className="flex gap-2">
            <button 
              onClick={() => {
                const label = document.getElementById('upload-label').value.trim()
                const url = document.getElementById('upload-url').value.trim()
                if (label && url) {
                  uploadFromUrl(url, label)
                  document.getElementById('upload-label').value = ''
                  document.getElementById('upload-url').value = ''
                }
              }}
              disabled={uploadLoading}
              className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50"
            >
              {uploadLoading ? (
                <>
                  <RefreshCw size={16} className="animate-spin" />
                  Uploading...
                </>
              ) : (
                <>
                  <Upload size={16} />
                  Upload File
                </>
              )}
            </button>
            
            {/* Quick Test Buttons */}
            <button 
              onClick={() => {
                document.getElementById('upload-label').value = 'Sample PDF Document'
                document.getElementById('upload-url').value = 'https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf'
              }}
              className="px-3 py-2 bg-blue-100 text-blue-700 rounded hover:bg-blue-200"
            >
              📄 Test PDF
            </button>
            
            <button 
              onClick={() => {
                document.getElementById('upload-label').value = 'Sample Image'
                document.getElementById('upload-url').value = 'https://file-examples.com/storage/fe68c8a7c69bd447d7770f6/2017/10/file_example_JPG_100kB.jpg'
              }}
              className="px-3 py-2 bg-purple-100 text-purple-700 rounded hover:bg-purple-200"
            >
              🖼️ Test Image
            </button>
          </div>
          
          <div className="text-sm text-gray-600">
            <strong>Supported:</strong> Google Drive sharing links, Dropbox, OneDrive, or any direct download URL
          </div>
        </div>
      </Card>

      {/* Attachments List */}
      <Card className="p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold">Stored Attachments</h3>
          <span className="text-sm text-gray-500">
            {attachments.length} file{attachments.length !== 1 ? 's' : ''} stored
          </span>
        </div>

        {loading ? (
          <div className="text-center py-8">
            <RefreshCw size={24} className="animate-spin mx-auto mb-2" />
            <div>Loading attachments...</div>
          </div>
        ) : attachments.length > 0 ? (
          <div className="space-y-3">
            {attachments.map(att => (
              <div key={att.id} className="flex items-center justify-between p-4 border border-gray-200 rounded-lg">
                <div className="flex-1">
                  <div className="font-medium text-gray-900">{att.label}</div>
                  <div className="text-sm text-gray-500 mt-1">
                    📄 {att.originalName} • {(att.size / 1024).toFixed(1)}KB • {att.contentType}
                  </div>
                  <div className="text-xs text-gray-400 mt-1">
                    Uploaded: {new Date(att.uploadedAt).toLocaleString()}
                    {att.downloadCount > 0 && ` • Downloaded ${att.downloadCount} times`}
                  </div>
                </div>
                <div className="flex gap-2 ml-4">
                  <a 
                    href={`/api/attachments?type=download&id=${att.id}`}
                    className="flex items-center gap-1 px-3 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <Download size={14} />
                    View
                  </a>
                  <button 
                    onClick={() => deleteAttachment(att.id)}
                    className="flex items-center gap-1 px-3 py-2 bg-red-600 text-white rounded hover:bg-red-700"
                  >
                    <Trash2 size={14} />
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center py-12 text-gray-500">
            <div className="text-4xl mb-4">📎</div>
            <div className="text-lg mb-2">No attachments uploaded yet</div>
            <div className="text-sm">Upload files to use them in your email campaigns</div>
          </div>
        )}
      </Card>

      {/* API Test Section */}
      <Card className="p-6 bg-gray-50">
        <h3 className="text-lg font-semibold mb-4">🧪 API Test</h3>
        <div className="space-y-2">
          <button 
            onClick={async () => {
              try {
                const res = await fetch('/api/attachments?type=list')
                const data = await res.json()
                console.log('API Response:', data)
                toast(`API working! Found ${data.attachments?.length || 0} attachments`, 'success')
              } catch (error) {
                console.error('API Error:', error)
                toast('API Error: ' + error.message, 'error')
              }
            }}
            className="px-4 py-2 bg-gray-600 text-white rounded hover:bg-gray-700"
          >
            Test API Connection
          </button>
          <div className="text-sm text-gray-600">
            Check browser console for detailed API responses
          </div>
        </div>
      </Card>
    </div>
  )
}