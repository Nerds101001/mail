// api/attachments.js — File attachment storage + tracked downloads
//
// Files are stored as base64 TEXT in Neon Postgres (no extra deps needed).
// When an email is sent, tracked download links are embedded in the body.
// Every time a recipient downloads the file, it records a "click" event in
// tracking_events — exactly like link click tracking, tagged as attachment:filename.
//
// Endpoints:
//   GET  ?type=list                                    → list all files (no binary data)
//   POST ?type=upload  body:{name,contentType,size,data}  → store file, return id
//   DELETE ?id=xxx                                     → delete file
//   GET  ?type=download&id=xxx&leadId=xxx&cid=xxx      → track + serve file

const { neon } = require("@neondatabase/serverless");
const { trackClick } = require("./_redis");

async function getDb() {
  const sql = neon(process.env.POSTGRES_URL || process.env.DATABASE_URL);
  await sql`
    CREATE TABLE IF NOT EXISTS attachments (
      id            TEXT PRIMARY KEY,
      label         TEXT NOT NULL,
      original_name TEXT NOT NULL,
      content_type  TEXT NOT NULL DEFAULT 'application/octet-stream',
      size          BIGINT NOT NULL DEFAULT 0,
      data          TEXT NOT NULL,
      uploaded_at   BIGINT NOT NULL,
      download_count INT DEFAULT 0
    )
  `.catch(() => {});
  return sql;
}

module.exports = async (req, res) => {
  if (req.method === "OPTIONS") return res.status(200).end();

  const { type, id } = req.query;

  // ── LIST ─────────────────────────────────────────────────────────────────────
  if (type === "list" && req.method === "GET") {
    try {
      const sql = await getDb();
      const rows = await sql`
        SELECT id, label, original_name, content_type, size, uploaded_at, download_count
        FROM attachments
        ORDER BY uploaded_at DESC
      `;
      return res.json({ attachments: rows });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  // ── UPLOAD ───────────────────────────────────────────────────────────────────
  // Body: { name: string, contentType: string, size: number, data: base64string }
  if (type === "upload" && req.method === "POST") {
    try {
      const { name, contentType, size, data } = req.body;
      if (!name || !data) return res.status(400).json({ error: "name and data are required" });

      const sql = await getDb();
      const attId = `att_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

      await sql`
        INSERT INTO attachments (id, label, original_name, content_type, size, data, uploaded_at)
        VALUES (
          ${attId},
          ${name},
          ${name},
          ${contentType || "application/octet-stream"},
          ${size || 0},
          ${data},
          ${Date.now()}
        )
      `;

      console.log(`✅ [ATTACHMENT] Stored: ${name} (${Math.round((size || 0) / 1024)}KB) id=${attId}`);
      return res.json({ ok: true, id: attId, name });
    } catch (e) {
      console.error("❌ [ATTACHMENT UPLOAD]", e.message);
      return res.status(500).json({ error: e.message });
    }
  }

  // ── DELETE ───────────────────────────────────────────────────────────────────
  if (req.method === "DELETE" && id) {
    try {
      const sql = await getDb();
      await sql`DELETE FROM attachments WHERE id = ${id}`;
      console.log(`🗑️  [ATTACHMENT] Deleted: ${id}`);
      return res.json({ ok: true });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  // ── DOWNLOAD (tracked) ────────────────────────────────────────────────────────
  // Every download is recorded in tracking_events as event_type='click'
  // with target_url = 'attachment:{filename}' so it shows up in Campaign History.
  if (type === "download" && req.method === "GET" && id) {
    try {
      const sql = await getDb();
      const [att] = await sql`SELECT * FROM attachments WHERE id = ${id}`;
      if (!att) return res.status(404).json({ error: "Attachment not found" });

      // Track as click event (reuses full click-tracking pipeline)
      const { leadId, cid } = req.query;
      if (leadId) {
        try {
          const ip = req.headers["x-forwarded-for"]?.split(",")[0]?.trim()
                     || req.headers["x-real-ip"]
                     || "unknown";
          const ua  = req.headers["user-agent"] || "unknown";
          const url = `attachment:${att.original_name}`;
          const result = await trackClick(leadId, ip, ua, url, cid || null);
          console.log(`📎 [ATTACHMENT DL] ${result.counted ? "Tracked" : "Dedup"} lead:${leadId} file:${att.original_name}`);
        } catch (e) {
          console.error("❌ [ATTACHMENT TRACK]", e.message);
        }
      }

      // Increment raw download counter
      await sql`UPDATE attachments SET download_count = download_count + 1 WHERE id = ${id}`.catch(() => {});

      // Serve file bytes
      const buffer = Buffer.from(att.data, "base64");
      res.setHeader("Content-Type", att.content_type);
      res.setHeader("Content-Disposition", `attachment; filename="${att.original_name}"`);
      res.setHeader("Content-Length", String(buffer.length));
      res.setHeader("Cache-Control", "private, no-store");
      return res.send(buffer);
    } catch (e) {
      console.error("❌ [ATTACHMENT DOWNLOAD]", e.message);
      return res.status(500).json({ error: e.message });
    }
  }

  // ── UPLOAD FROM URL ──────────────────────────────────────────────────────────
  // Body: { url: string, label: string }
  // Downloads the file server-side (supports Google Drive / Dropbox / direct URLs)
  // and stores it as base64 in Postgres — same schema as the direct upload endpoint.
  if (type === "upload-url" && req.method === "POST") {
    const { url, label } = req.body || {};
    if (!url || !label) return res.status(400).json({ error: "url and label are required" });

    try {
      // Convert Google Drive sharing link → direct download URL
      let downloadUrl = url;
      if (url.includes("drive.google.com/file/d/")) {
        const fileId = url.match(/\/file\/d\/([a-zA-Z0-9-_]+)/)?.[1];
        if (fileId) {
          downloadUrl = `https://drive.google.com/uc?export=download&id=${fileId}`;
          console.log(`📎 [ATTACH URL] Converted Drive URL → ${downloadUrl}`);
        }
      }

      console.log(`📎 [ATTACH URL] Downloading: ${downloadUrl}`);
      const response = await fetch(downloadUrl);
      if (!response.ok) throw new Error(`Download failed: ${response.status} ${response.statusText}`);

      const contentType   = response.headers.get("content-type") || "application/octet-stream";
      const buffer        = await response.arrayBuffer();
      const maxSize       = 10 * 1024 * 1024; // 10 MB
      if (buffer.byteLength > maxSize)
        throw new Error(`File too large: ${(buffer.byteLength / 1024 / 1024).toFixed(1)} MB (max 10 MB)`);

      // Determine a sensible original filename
      let originalName = label;
      const cd = response.headers.get("content-disposition");
      if (cd && cd.includes("filename=")) {
        const m = cd.match(/filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/);
        if (m?.[1]) originalName = m[1].replace(/['"]/g, "");
      } else {
        try {
          const pathPart = new URL(downloadUrl).pathname.split("/").pop();
          if (pathPart && pathPart.includes(".")) originalName = decodeURIComponent(pathPart);
        } catch {}
        if (!originalName.includes(".")) {
          const ext = (contentType.split("/")[1] || "bin").split(";")[0].trim();
          originalName = `${label.replace(/[^a-zA-Z0-9]/g, "_")}.${ext}`;
        }
      }

      const attId    = `att_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const b64data  = Buffer.from(buffer).toString("base64");

      const sql = await getDb();
      await sql`
        INSERT INTO attachments (id, label, original_name, content_type, size, data, uploaded_at)
        VALUES (
          ${attId}, ${label}, ${originalName}, ${contentType},
          ${buffer.byteLength}, ${b64data}, ${Date.now()}
        )
      `;

      console.log(`✅ [ATTACH URL] Stored: "${label}" / ${originalName} (${Math.round(buffer.byteLength / 1024)} KB) id=${attId}`);
      return res.json({ ok: true, id: attId, label, originalName, size: buffer.byteLength, contentType });
    } catch (e) {
      console.error("❌ [ATTACH URL]", e.message);
      return res.status(500).json({ error: e.message });
    }
  }

  res.status(400).json({ error: "Invalid type or method" });
};
