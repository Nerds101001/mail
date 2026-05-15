// RichEditor.jsx — Rich text editor with full toolbar
// value / onChange work with RAW HTML strings.
// Use htmlToPlain() when you need plain text for email sending.
// Use plainToHtml() to seed the editor from a plain-text string.

import { useRef, useEffect, useState } from 'react'
import {
  Bold, Italic, Underline, Strikethrough,
  List, ListOrdered, Link, AlignLeft,
} from 'lucide-react'

// ─── Helpers (exported for callers) ──────────────────────────────────────────

/** Convert plain text (newlines) → HTML paragraphs for seeding the editor */
export function plainToHtml(text) {
  if (!text) return ''
  return text
    .split(/\n{2,}/)
    .map(p => `<p>${p.replace(/\n/g, '<br>')}</p>`)
    .join('')
}

/** Convert rich HTML → plain text for email sending / deliverability checks */
export function htmlToPlain(html) {
  if (!html) return ''
  return html
    .replace(/<li[^>]*>/gi, '• ')
    .replace(/<\/li>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<\/(ul|ol)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

// ─── Colour palette (email-safe, visible on white) ───────────────────────────
const COLOURS = [
  '#111827', // near-black
  '#dc2626', // red
  '#d97706', // amber
  '#16a34a', // green
  '#2563eb', // blue
  '#7c3aed', // violet
  '#db2777', // pink
  '#6b7280', // grey
]

// ─── Component ───────────────────────────────────────────────────────────────
export default function RichEditor({
  value,          // HTML string
  onChange,       // (html: string) => void
  placeholder = 'Write your email…',
  minHeight = 160,
}) {
  const editorRef  = useRef(null)
  const isFocused  = useRef(false)
  const [showColours, setShowColours] = useState(false)

  // Sync external value into DOM only when editor is NOT focused.
  // This lets AI-generated content update the editor without clobbering the
  // user's cursor / selection while they are typing.
  useEffect(() => {
    if (!editorRef.current || isFocused.current) return
    if (editorRef.current.innerHTML !== (value || '')) {
      editorRef.current.innerHTML = value || ''
    }
  }, [value])

  // ── Toolbar helpers ────────────────────────────────────────────────────────
  function exec(cmd, arg = null) {
    editorRef.current?.focus()
    document.execCommand(cmd, false, arg)
    emitChange()
  }

  function emitChange() {
    onChange?.(editorRef.current?.innerHTML ?? '')
  }

  function insertLink() {
    const url = prompt('Enter URL:', 'https://')
    if (url) exec('createLink', url)
  }

  function applyColour(hex) {
    editorRef.current?.focus()
    document.execCommand('foreColor', false, hex)
    emitChange()
    setShowColours(false)
  }

  // ── Toolbar button ─────────────────────────────────────────────────────────
  const TB = ({ onClick, title, children }) => (
    <button
      type="button"
      title={title}
      onMouseDown={e => { e.preventDefault(); onClick() }}
      className="p-1.5 rounded hover:bg-slate-200 active:bg-slate-300 transition-colors text-slate-600"
    >
      {children}
    </button>
  )

  const Sep = () => <div className="w-px h-4 bg-slate-300 mx-0.5 self-center flex-shrink-0" />

  return (
    <div className="border border-slate-200 rounded-lg overflow-visible focus-within:ring-2 focus-within:ring-emerald-500 focus-within:border-transparent transition-all">

      {/* ── Toolbar ── */}
      <div className="flex items-center gap-0.5 px-2 py-1.5 bg-slate-50 border-b border-slate-200 flex-wrap relative">

        {/* Format */}
        <TB onClick={() => exec('bold')}          title="Bold (Ctrl+B)">        <Bold size={14} /></TB>
        <TB onClick={() => exec('italic')}        title="Italic (Ctrl+I)">      <Italic size={14} /></TB>
        <TB onClick={() => exec('underline')}     title="Underline (Ctrl+U)">   <Underline size={14} /></TB>
        <TB onClick={() => exec('strikeThrough')} title="Strikethrough">        <Strikethrough size={14} /></TB>

        <Sep />

        {/* Lists */}
        <TB onClick={() => exec('insertUnorderedList')} title="Bullet list">  <List size={14} /></TB>
        <TB onClick={() => exec('insertOrderedList')}   title="Numbered list"><ListOrdered size={14} /></TB>

        <Sep />

        {/* Font size */}
        <select
          className="text-xs border-0 bg-transparent text-slate-600 focus:outline-none cursor-pointer py-0.5"
          onChange={e => exec('fontSize', e.target.value)}
          defaultValue="3"
          title="Font size"
          onMouseDown={e => e.stopPropagation()}
        >
          <option value="1">Small</option>
          <option value="3">Normal</option>
          <option value="4">Large</option>
          <option value="5">X-Large</option>
        </select>

        <Sep />

        {/* Colour picker — palette pops up above toolbar */}
        <div className="relative">
          <button
            type="button"
            title="Text colour"
            onMouseDown={e => { e.preventDefault(); setShowColours(v => !v) }}
            className="p-1.5 rounded hover:bg-slate-200 transition-colors text-slate-600 flex items-center gap-1 text-xs font-bold"
          >
            A<span className="w-2 h-1 rounded-sm" style={{ background: 'linear-gradient(90deg,#dc2626,#2563eb,#16a34a)' }} />
          </button>
          {showColours && (
            <div className="absolute bottom-full left-0 mb-1 flex gap-1 p-1.5 bg-white border border-slate-200 rounded-lg shadow-lg z-50">
              {COLOURS.map(c => (
                <button
                  key={c}
                  type="button"
                  onMouseDown={e => { e.preventDefault(); applyColour(c) }}
                  className="w-5 h-5 rounded border border-slate-300 hover:scale-110 transition-transform flex-shrink-0"
                  style={{ backgroundColor: c }}
                  title={c}
                />
              ))}
            </div>
          )}
        </div>

        <Sep />

        {/* Link */}
        <TB onClick={insertLink} title="Insert link"><Link size={14} /></TB>

        <Sep />

        {/* Clear formatting */}
        <TB onClick={() => exec('removeFormat')} title="Clear formatting">
          <span className="text-xs font-mono line-through">Tx</span>
        </TB>
      </div>

      {/* ── Editable area ── */}
      <div
        ref={editorRef}
        contentEditable
        suppressContentEditableWarning
        onFocus={() => { isFocused.current = true }}
        onBlur={() => { isFocused.current = false; emitChange() }}
        onInput={emitChange}
        onKeyDown={() => { isFocused.current = true }}
        data-placeholder={placeholder}
        className="px-3 py-2.5 text-sm text-slate-900 focus:outline-none bg-white rounded-b-lg"
        style={{ minHeight, lineHeight: '1.7', fontFamily: '-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif' }}
      />

      <style>{`
        [contenteditable]:empty:before {
          content: attr(data-placeholder);
          color: #94a3b8;
          pointer-events: none;
        }
        [contenteditable] p  { margin: 0 0 10px 0; }
        [contenteditable] ul { margin: 0 0 10px 0; padding-left: 22px; list-style-type: disc; }
        [contenteditable] ol { margin: 0 0 10px 0; padding-left: 22px; list-style-type: decimal; }
        [contenteditable] li { margin: 0 0 3px 0; }
        [contenteditable] a  { color: #1a73e8; text-decoration: underline; }
        [contenteditable] b, [contenteditable] strong { font-weight: 700; }
        [contenteditable] i, [contenteditable] em     { font-style: italic; }
      `}</style>
    </div>
  )
}
