// api/sse.js — Real-time Server-Sent Events broadcaster
// EC2 only — requires an always-on process (PM2). Impossible on Vercel serverless.
//
// Usage (server): const { emit } = require('./sse')
//                 emit('open_event', { leadId, opens, ... })
//
// Usage (client): const es = new EventSource('/api/sse')
//                 es.addEventListener('open_event', handler)

const clients = new Map()   // clientId → res
let _nextId = 1

// ── Express handler — keeps connection open ───────────────────────────────────
module.exports = function sseHandler(req, res) {
  if (req.method !== 'GET') return res.status(405).end()

  const id = _nextId++

  res.setHeader('Content-Type',  'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache, no-transform')
  res.setHeader('Connection',    'keep-alive')
  res.setHeader('X-Accel-Buffering', 'no')  // Disable Nginx response buffering
  res.flushHeaders()

  // Confirm connection to client
  res.write(`event: connected\ndata: ${JSON.stringify({ clientId: id })}\n\n`)
  clients.set(id, res)
  console.log(`📡 [SSE] +client ${id} — connected: ${clients.size}`)

  // Keep-alive ping every 25s — Nginx default proxy_read_timeout is 60s
  const ping = setInterval(() => {
    try { res.write(': ping\n\n') } catch { clearInterval(ping); clients.delete(id) }
  }, 25000)

  req.on('close', () => {
    clearInterval(ping)
    clients.delete(id)
    console.log(`📡 [SSE] -client ${id} — connected: ${clients.size}`)
  })
}

// ── Broadcast to all connected browsers ──────────────────────────────────────
module.exports.emit = function emit(eventName, data) {
  if (!clients.size) return
  const msg  = `event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`
  const dead = []
  clients.forEach((res, id) => {
    try { res.write(msg) }
    catch { dead.push(id) }
  })
  dead.forEach(id => clients.delete(id))
  if (dead.length) console.log(`📡 [SSE] Pruned ${dead.length} dead clients`)
}
