// api/attachments.js — File attachment management
const { get, set } = require("./_redis");

module.exports = async (req, res) => {
  if (req.method === "OPTIONS") return res.status(200).end();
  
  const { type } = req.query;

  // ── UPLOAD ATTACHMENT FROM URL ────────────────────────────────────────
  if (type === "upload-url" && req.method === "POST") {
    const { url, label } = req.body;
    
    if (!url || !label) {
      return res.status(400).json({ error: "URL and label are required" });
    }

    try {
      // Convert Google Drive sharing links to direct download links
      let downloadUrl = url;
      if (url.includes('drive.google.com/file/d/')) {
        const fileId = url.match(/\/file\/d\/([a-zA-Z0-9-_]+)/)?.[1];
        if (fileId) {
          downloadUrl = `https://drive.google.com/uc?export=download&id=${fileId}`;
          console.log(`📎 [ATTACHMENT] Converted Google Drive URL: ${downloadUrl}`);
        }
      }

      // Download file from URL
      console.log(`📎 [ATTACHMENT] Downloading: ${downloadUrl}`);
      const response = await fetch(downloadUrl);
      
      if (!response.ok) {
        throw new Error(`Failed to download: ${response.status} ${response.statusText}`);
      }

      // Get file info
      const contentType = response.headers.get('content-type') || 'application/octet-stream';
      const contentLength = response.headers.get('content-length');
      const buffer = await response.arrayBuffer();
      
      // Check file size limit (10MB max for Redis storage)
      const maxSize = 10 * 1024 * 1024; // 10MB
      if (buffer.byteLength > maxSize) {
        throw new Error(`File too large: ${(buffer.byteLength / 1024 / 1024).toFixed(1)}MB (max 10MB)`);
      }
      
      // Generate unique ID and filename
      const attachmentId = `att_${Date.now()}_${Math.random().toString(36).slice(2)}`;
      
      // Extract filename from URL or Content-Disposition header
      let originalName = 'attachment';
      const contentDisposition = response.headers.get('content-disposition');
      if (contentDisposition && contentDisposition.includes('filename=')) {
        const match = contentDisposition.match(/filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/);
        if (match && match[1]) {
          originalName = match[1].replace(/['"]/g, '');
        }
      } else {
        // Fallback to URL parsing
        const urlPath = new URL(downloadUrl).pathname;
        const urlFilename = urlPath.split('/').pop();
        if (urlFilename && urlFilename.includes('.')) {
          originalName = urlFilename;
        } else if (label.includes('.')) {
          originalName = label;
        } else {
          // Guess extension from content type
          const ext = contentType.split('/')[1] || 'bin';
          originalName = `${label.replace(/[^a-zA-Z0-9]/g, '_')}.${ext}`;
        }
      }
      
      const fileExtension = originalName.includes('.') ? originalName.split('.').pop() : 'bin';
      const fileName = `${attachmentId}.${fileExtension}`;
      
      // Store file data as base64 in Redis (for small files) or use file system for larger files
      const base64Data = Buffer.from(buffer).toString('base64');
      
      const attachment = {
        id: attachmentId,
        label,
        originalUrl: url,
        fileName,
        originalName,
        contentType,
        size: buffer.byteLength,
        base64Data,
        uploadedAt: new Date().toISOString(),
        downloadCount: 0
      };

      // Store attachment metadata
      const attachments = await get("attachments").then(data => data ? JSON.parse(data) : []).catch(() => []);
      attachments.push(attachment);
      await set("attachments", JSON.stringify(attachments));

      console.log(`✅ [ATTACHMENT] Stored: ${label} (${(buffer.byteLength / 1024).toFixed(1)}KB)`);
      
      res.json({ 
        success: true, 
        attachment: {
          id: attachmentId,
          label,
          fileName,
          size: buffer.byteLength,
          contentType
        }
      });

    } catch (error) {
      console.error(`❌ [ATTACHMENT] Download failed:`, error.message);
      res.status(500).json({ error: `Failed to download attachment: ${error.message}` });
    }
  }

  // ── LIST ATTACHMENTS ──────────────────────────────────────────────────
  else if (type === "list" && req.method === "GET") {
    try {
      const attachments = await get("attachments").then(data => data ? JSON.parse(data) : []).catch(() => []);
      
      // Return metadata only (without base64 data for performance)
      const attachmentList = attachments.map(att => ({
        id: att.id,
        label: att.label,
        fileName: att.fileName,
        originalName: att.originalName,
        contentType: att.contentType,
        size: att.size,
        uploadedAt: att.uploadedAt,
        downloadCount: att.downloadCount || 0
      }));

      res.json({ attachments: attachmentList });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  // ── GET ATTACHMENT DATA ───────────────────────────────────────────────
  else if (type === "download" && req.method === "GET") {
    const { id } = req.query;
    
    try {
      const attachments = await get("attachments").then(data => data ? JSON.parse(data) : []).catch(() => []);
      const attachment = attachments.find(att => att.id === id);
      
      if (!attachment) {
        return res.status(404).json({ error: "Attachment not found" });
      }

      // Increment download count
      attachment.downloadCount = (attachment.downloadCount || 0) + 1;
      await set("attachments", JSON.stringify(attachments));

      // Return file data
      const buffer = Buffer.from(attachment.base64Data, 'base64');
      
      res.setHeader('Content-Type', attachment.contentType);
      res.setHeader('Content-Disposition', `attachment; filename="${attachment.originalName}"`);
      res.setHeader('Content-Length', buffer.length);
      res.send(buffer);

    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  // ── DELETE ATTACHMENT ─────────────────────────────────────────────────
  else if (type === "delete" && req.method === "DELETE") {
    const { id } = req.query;
    
    try {
      const attachments = await get("attachments").then(data => data ? JSON.parse(data) : []).catch(() => []);
      const filteredAttachments = attachments.filter(att => att.id !== id);
      
      if (attachments.length === filteredAttachments.length) {
        return res.status(404).json({ error: "Attachment not found" });
      }

      await set("attachments", JSON.stringify(filteredAttachments));
      console.log(`🗑️ [ATTACHMENT] Deleted: ${id}`);
      
      res.json({ success: true, message: "Attachment deleted" });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  else {
    res.status(400).json({ error: "Invalid request" });
  }
};