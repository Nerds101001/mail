// RichEditor.jsx — Simple rich text editor with toolbar
// Uses contenteditable div + execCommand for formatting
// Returns HTML via onChange(html)

import { useRef, useEffect } from 'react'
import { Bold, Italic, Underline, AlignLeft, Link } from 'lucide-react'

export default function RichEditor({ value, onChange, placeholder = 'Write your email...', minHeight = 160 }) {
  const ref = useRef(null)

  // Sync external value changes (e.g. when AI generates content)
  useEffect(() => {
    if (!ref.current) return
    // Only update if content actually changed to avoid cursor jump
    const current = ref.current.innerHTML
    // Convert plain text with \n to HTML paragraphs
    const asHtml = value
      ? value.split('\n\n').map(p => `<p>${p.replace(/\n/g, '<br>')}</p>`).join('')
      : ''
    if (current !== asHtml && asHtml !== current) {
      ref.current.innerHTML = asHtml
    }
  }, [value])

  function exec(cmd, val = null) {
    ref.current?.focus()
    document.execCommand(cmd, false, val)
    handleChange()
  }

  function handleChange() {
    if (onChange && ref.current) {
      // Convert HTML back to plain text with newlines for email sending
      const html = ref.current.innerHTML
      onChange(html)
    }
  }

  function insertLink() {
    const url = prompt('Enter URL:', 'https://')
    if (url) exec('createLink', url)
  }

  const ToolBtn = ({ onClick, title, children, active }) => (
    <button
      type="button"
      title={title}
      onMouseDown={e => { e.preventDefault(); onClick() }}
      className={`p-1.5 rounded hover:bg-slate-200 transition-colors ${active ? 'bg-slate-200 text-slate-900' : 'text-slate-600'}`}
    >
      {children}
    </button>
  )

  return (
    <div className="border border-slate-200 rounded-lg overflow-hidden focus-within:ring-2 focus-within:ring-emerald-500 focus-within:border-transparent transition-all">
      {/* Toolbar */}
      <div className="flex items-center gap-0.5 px-2 py-1.5 bg-slate-50 border-b border-slate-200 flex-wrap">
        <ToolBtn onClick={() => exec('bold')} title="Bold (Ctrl+B)"><Bold size={14} /></ToolBtn>
        <ToolBtn onClick={() => exec('italic')} title="Italic (Ctrl+I)"><Italic size={14} /></ToolBtn>
        <ToolBtn onClick={() => exec('underline')} title="Underline (Ctrl+U)"><Underline size={14} /></ToolBtn>
        <div className="w-px h-4 bg-slate-300 mx-1" />
        <select
          className="text-xs border-0 bg-transparent text-slate-600 focus:outline-none cursor-pointer"
          onChange={e => exec('fontSize', e.target.value)}
          defaultValue="3"
          title="Font Size"
        >
          <option value="1">Small</option>
          <option value="3">Normal</option>
          <option value="4">Large</option>
          <option value="5">X-Large</option>
        </select>
        <div className="w-px h-4 bg-slate-300 mx-1" />
        <ToolBtn onClick={insertLink} title="Insert Link"><Link size={14} /></ToolBtn>
        <div className="w-px h-4 bg-slate-300 mx-1" />
        <ToolBtn onClick={() => exec('removeFormat')} title="Clear Formatting">
          <span className="text-xs font-mono">Tx</span>
        </ToolBtn>
      </div>

      {/* Editor */}
      <div
        ref={ref}
        contentEditable
        suppressContentEditableWarning
        onInput={handleChange}
        onBlur={handleChange}
        data-placeholder={placeholder}
        className="px-3 py-2.5 text-sm text-slate-900 focus:outline-none bg-white"
        style={{
          minHeight,
          lineHeight: '1.7',
          fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
        }}
      />

      <style>{`
        [contenteditable]:empty:before {
          content: attr(data-placeholder);
          color: #94a3b8;
          pointer-events: none;
        }
        [contenteditable] p { margin: 0 0 12px 0; }
        [contenteditable] a { color: #1a73e8; text-decoration: underline; }
      `}</style>
    </div>
  )
}

// Helper: convert rich HTML to plain text for email sending
export function htmlToPlain(html) {
  if (!html) return ''
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}
