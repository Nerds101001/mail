// api/ops.js — Unified ops endpoint with improved tracking
// GET /api/ops?type=tasks          → daily task list
// GET /api/ops?type=reminder       → send morning digest email
// GET /api/ops?type=tracking&ids=  → open/click stats (optimized)
// GET /api/ops?type=events&leadId= → detailed tracking events
// GET /api/ops?type=gmail-status   → Gmail connection status

const { get, set, getTrackingStats, getTrackingEvents } = require("./_redis");
const nodemailer = require("nodemailer");

async function safeGet(key, fallback) {
  try { const v = await get(key); return v ? JSON.parse(v) : fallback; } catch(e) { return fallback; }
}

function daysDiff(d)  { if(!d) return null; return Math.ceil((new Date(d)-Date.now())/86400000); }
function daysSince(d) { if(!d) return null; return Math.floor((Date.now()-new Date(d))/86400000); }

module.exports = async (req, res) => {
  if (req.method === "OPTIONS") return res.status(200).end();
  const { type, ids, leadId } = req.query;

  // ── TRACKING STATS (using simplified tracking system) ──────────────────
  if (type === "tracking") {
    try {
      console.log(`📊 [OPS TRACKING] Request received:`, { type, ids, leadId, query: req.query });
      
      if (!ids) {
        console.log(`📊 [OPS TRACKING] No IDs provided, returning empty object`);
        return res.json({});
      }
      
      const leadIds = ids.split(",").filter(Boolean);
      console.log(`📊 [OPS TRACKING] Processing ${leadIds.length} lead IDs:`, leadIds);
      
      const stats = await getTrackingStats(leadIds);
      console.log(`📊 [OPS TRACKING] Retrieved stats:`, stats);
      
      console.log(`✅ [OPS TRACKING] Returning stats for ${Object.keys(stats).length} leads`);
      return res.json(stats);
      
    } catch(e) {
      console.error(`❌ [OPS TRACKING ERROR]:`, e.message, e.stack);
      return res.status(500).json({ error: "Failed to fetch tracking stats", details: e.message });
    }
  }

  // ── TRACKING EVENTS (detailed log with better error handling) ────────
  if (type === "events") {
    try {
      if (!leadId) return res.json({ events: [], error: "Missing leadId parameter" });
      
      console.log(`📋 [TRACKING EVENTS] Fetching events for lead ${leadId}`);
      const events = await getTrackingEvents(leadId, 100);
      
      console.log(`✅ [TRACKING EVENTS] Found ${events.length} events for lead ${leadId}`);
      return res.json({ events });
    } catch(e) {
      console.error(`❌ [TRACKING EVENTS ERROR] Lead ${leadId}:`, e.message);
      return res.json({ events: [], error: e.message });
    }
  }

  // ── GMAIL STATUS ──────────────────────────────────────────────────────
  if (type === "gmail-status") {
    try {
      const email = await get("gmail:email");
      const expiresAt = parseInt(await get("gmail:expires_at")||"0");
      return res.json({ connected: !!email, email: email||null, tokenExpired: expiresAt>0&&Date.now()>expiresAt });
    } catch(e) { return res.json({ connected: false, email: null }); }
  }

  // ── DAILY TASKS ───────────────────────────────────────────────────────
  if (type === "tasks") {
    const [leads, clients, deals] = await Promise.all([
      safeGet("crm:leads",[]), safeGet("crm:clients",[]), safeGet("crm:deals",[]),
    ]);
    const tasks = [];
    const today = new Date().toDateString();

    leads.filter(l=>(l.opens>=2||l.clicks>=1)&&!["REPLIED","WON","LOST","UNSUBSCRIBED"].includes(l.pipelineStage))
      .forEach(l=>tasks.push({priority:"HIGH",type:"CALL",icon:"🔥",title:`Call hot lead: ${l.name}`,detail:`${l.company||l.email} — ${l.opens||0} opens, ${l.clicks||0} clicks`,email:l.email,name:l.name}));

    leads.filter(l=>l.status==="SENT"&&daysSince(l.lastSent)>=2)
      .forEach(l=>tasks.push({priority:"MEDIUM",type:"FOLLOWUP",icon:"📧",title:`Follow up: ${l.name}`,detail:`Sent ${daysSince(l.lastSent)} days ago`,email:l.email,name:l.name}));

    deals.filter(d=>d.type==="DEMO"&&d.demoDate&&new Date(d.demoDate).toDateString()===today)
      .forEach(d=>tasks.push({priority:"HIGH",type:"DEMO",icon:"📞",title:`Demo today: ${d.clientName||d.leadName}`,detail:`${d.demoTime||"Time TBD"}`,name:d.clientName||d.leadName}));

    clients.filter(c=>c.renewalDate&&daysDiff(c.renewalDate)!==null&&daysDiff(c.renewalDate)<=30&&daysDiff(c.renewalDate)>=0)
      .forEach(c=>tasks.push({priority:daysDiff(c.renewalDate)<=7?"HIGH":"MEDIUM",type:"RENEWAL",icon:"🔄",title:`Renewal due: ${c.name}`,detail:`${c.software||""} — ${daysDiff(c.renewalDate)} days left`,email:c.email,name:c.name}));

    clients.filter(c=>c.paymentStatus==="OVERDUE")
      .forEach(c=>tasks.push({priority:"HIGH",type:"PAYMENT",icon:"💰",title:`Overdue payment: ${c.name}`,detail:`${c.software||""} — ₹${c.amount||0}`,email:c.email,name:c.name}));

    tasks.sort((a,b)=>({HIGH:0,MEDIUM:1,LOW:2}[a.priority]-{HIGH:0,MEDIUM:1,LOW:2}[b.priority]));
    return res.json({ tasks, generatedAt: new Date().toISOString(), counts:{total:tasks.length,high:tasks.filter(t=>t.priority==="HIGH").length} });
  }

  // ── SEND REMINDER ─────────────────────────────────────────────────────
  if (type === "reminder") {
    const [leads, clients, deals, profiles] = await Promise.all([
      safeGet("crm:leads",[]), safeGet("crm:clients",[]), safeGet("crm:deals",[]), safeGet("crm:profiles",[]),
    ]);
    const today = new Date().toDateString();
    const hotLeads      = leads.filter(l=>(l.opens>=2||l.clicks>=1)&&!["WON","LOST","UNSUBSCRIBED"].includes(l.pipelineStage));
    const followups     = leads.filter(l=>l.status==="SENT"&&daysSince(l.lastSent)>=2);
    const demosToday    = deals.filter(d=>d.type==="DEMO"&&d.demoDate&&new Date(d.demoDate).toDateString()===today);
    const renewalsSoon  = clients.filter(c=>c.renewalDate&&daysDiff(c.renewalDate)!==null&&daysDiff(c.renewalDate)<=30&&daysDiff(c.renewalDate)>=0);
    const overduePayments = clients.filter(c=>c.paymentStatus==="OVERDUE");

    const smtpProfile = profiles.find(p=>p.type==="smtp"&&p.active);
    if (!smtpProfile) return res.json({ ok: false, reason: "No active SMTP profile" });

    const appUrl = process.env.APP_URL || "https://enginerdsmail.vercel.app";
    const row = (icon,title,detail) => `<tr style="border-bottom:1px solid #f0f0f0;"><td style="padding:8px 4px;width:28px;">${icon}</td><td style="padding:8px 4px;font-weight:600;color:#111;">${title}</td><td style="padding:8px 4px;color:#666;">${detail}</td></tr>`;
    const section = (title,color,items,fn) => !items.length?"":`<div style="margin-bottom:24px;"><h3 style="font-size:14px;font-weight:700;color:${color};margin:0 0 10px;text-transform:uppercase;">${title} (${items.length})</h3><table style="width:100%;border-collapse:collapse;font-size:13px;">${items.map(fn).join("")}</table></div>`;

    const html = `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#f5f5f5;font-family:-apple-system,sans-serif;">
<div style="max-width:600px;margin:0 auto;padding:24px 16px;">
  <div style="background:#0a0b0d;border-radius:8px 8px 0 0;padding:20px 24px;"><div style="font-family:monospace;font-size:14px;font-weight:700;color:#00e5a0;letter-spacing:2px;">ENGINERDS CRM — Daily Digest</div></div>
  <div style="background:#fff;border-radius:0 0 8px 8px;padding:24px;">
    <h2 style="font-size:18px;margin:0 0 4px;">Good morning! 👋</h2>
    <p style="font-size:13px;color:#666;margin:0 0 24px;">${new Date().toLocaleDateString("en-IN",{weekday:"long",year:"numeric",month:"long",day:"numeric"})}</p>
    <div style="display:flex;gap:12px;margin-bottom:24px;flex-wrap:wrap;">
      ${[["🔥",hotLeads.length,"Hot Leads","#fff8e1","#f59e0b"],["📞",demosToday.length,"Demos Today","#dcfce7","#16a34a"],["🔄",renewalsSoon.length,"Renewals","#fef3c7","#d97706"],["💰",overduePayments.length,"Overdue","#fee2e2","#dc2626"]]
        .map(([icon,n,label,bg,color])=>`<div style="flex:1;min-width:100px;background:${bg};border-radius:8px;padding:14px;text-align:center;"><div style="font-size:24px;font-weight:700;color:${color};">${n}</div><div style="font-size:11px;color:${color};text-transform:uppercase;">${label}</div></div>`).join("")}
    </div>
    ${section("🔥 Hot Leads","#dc2626",hotLeads,l=>row("🔥",l.name,`${l.company||l.email} — ${l.opens||0} opens`))}
    ${section("📞 Demos Today","#7c3aed",demosToday,d=>row("📞",d.clientName||d.leadName,d.demoTime||"Time TBD"))}
    ${section("🔄 Renewals Due","#d97706",renewalsSoon,c=>row("🔄",c.name,`${c.software||""} — ${daysDiff(c.renewalDate)} days`))}
    ${section("💰 Overdue Payments","#dc2626",overduePayments,c=>row("💰",c.name,`₹${c.amount||0} pending`))}
    ${section("📧 Follow-ups","#0284c7",followups.slice(0,10),l=>row("📧",l.name,`Sent ${daysSince(l.lastSent)} days ago`))}
    <div style="margin-top:24px;text-align:center;"><a href="${appUrl}" style="background:#00e5a0;color:#000;padding:12px 28px;border-radius:6px;font-weight:700;text-decoration:none;font-size:14px;">Open CRM →</a></div>
  </div>
</div></body></html>`;

    const transporter = nodemailer.createTransport({ host:smtpProfile.host, port:parseInt(smtpProfile.port), secure:!!smtpProfile.secure, auth:{user:smtpProfile.user,pass:smtpProfile.pass}, tls:{rejectUnauthorized:false} });
    await transporter.sendMail({ from:`"Enginerds CRM" <${smtpProfile.user}>`, to:"contact@enginerds.in", subject:`📋 Daily Digest — ${hotLeads.length} hot leads, ${demosToday.length} demos today`, html });
    return res.json({ ok: true });
  }

  // ── AI EMAIL GENERATION (MULTIPLE VARIANTS) ──────────────────────────
  if (type === "generate-ai" && req.method === "POST") {
    try {
      const { name, company, role, category, apiKey, customPrompt, count = 1 } = req.body;

      if (!apiKey) {
        return res.status(400).json({ error: 'NVIDIA API key is required' });
      }

      console.log(`🤖 [AI GENERATION] Generating ${count} variants for ${company}`);

      // Generate multiple variants
      const variants = [];
      const variantCount = Math.min(Math.max(1, parseInt(count) || 1), 10); // Limit to 1-10 variants

      for (let i = 0; i < variantCount; i++) {
        // Vary the temperature and approach for each variant
        const temperature = 0.6 + (i * 0.1); // 0.6, 0.7, 0.8, 0.9, 1.0
        const approaches = [
          'Focus on pain points and solutions',
          'Emphasize ROI and quantifiable benefits',
          'Use a consultative, question-based approach',
          'Highlight case studies and social proof',
          'Lead with industry-specific insights'
        ];
        const approach = approaches[i % approaches.length];

        // Construct the AI prompt with variation
        const systemPrompt = `You are an expert email copywriter specializing in B2B sales emails. Generate a personalized, professional email that:
1. Is concise and engaging (150-200 words max)
2. Focuses on value proposition for the recipient
3. Has a clear call-to-action
4. Sounds natural and conversational
5. Avoids being overly salesy

Approach for this variant: ${approach}

Context:
- Recipient: ${name || '[Name]'}
- Company: ${company || '[Company]'}
- Role: ${role || 'decision maker'}
- Category: ${category || 'business professional'}

${customPrompt ? `Additional instructions: ${customPrompt}` : ''}

Generate both a subject line and email body. Return ONLY valid JSON with "subject" and "body" fields, no markdown formatting.`;

        const userPrompt = `Generate variant ${i + 1} of ${variantCount}: A personalized B2B sales email for ${name || '[Name]'} at ${company || '[Company]'}. Make it professional, valuable, and engaging. Use the ${approach} approach.`;

        try {
          // Call NVIDIA NIM API
          const response = await fetch('https://integrate.api.nvidia.com/v1/chat/completions', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${apiKey}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              model: 'meta/llama-3.1-405b-instruct',
              messages: [
                {
                  role: 'system',
                  content: systemPrompt
                },
                {
                  role: 'user', 
                  content: userPrompt
                }
              ],
              temperature: temperature,
              max_tokens: 600,
              top_p: 0.9
            })
          });

          if (!response.ok) {
            const errorData = await response.text();
            console.error(`❌ NVIDIA API Error for variant ${i + 1}:`, response.status, errorData);
            throw new Error(`API returned ${response.status}`);
          }

          const data = await response.json();
          
          if (!data.choices || !data.choices[0] || !data.choices[0].message) {
            throw new Error('Invalid response from NVIDIA API');
          }

          const aiResponse = data.choices[0].message.content;
          
          // Try to parse as JSON first
          let result;
          try {
            // Remove markdown code blocks if present
            const cleanedResponse = aiResponse.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
            result = JSON.parse(cleanedResponse);
          } catch (parseError) {
            // If not JSON, extract subject and body manually
            const lines = aiResponse.split('\n').filter(line => line.trim());
            
            let subject = `Quick idea for ${company || '[Company]'}`;
            let body = aiResponse;
            
            // Look for subject line patterns
            for (const line of lines) {
              if (line.toLowerCase().includes('subject:') || line.toLowerCase().includes('subject line:')) {
                subject = line.replace(/subject:?/i, '').trim().replace(/^["']|["']$/g, '');
                break;
              }
            }
            
            // Remove subject line from body if found
            body = aiResponse.replace(/subject:?[^\n]*/i, '').trim();
            
            result = { subject, body };
          }

          // Ensure we have both subject and body
          if (!result.subject) {
            result.subject = `Quick idea for ${company || '[Company]'}`;
          }
          
          if (!result.body) {
            result.body = `Hi ${name || '[Name]'},\n\nI hope this email finds you well. I wanted to reach out because I believe we could help ${company || '[Company]'} achieve your business goals.\n\nWould you be open to a brief conversation to explore potential opportunities?\n\nBest regards,\nPawan Kumar\nEnginerds Tech Solution`;
          }

          // Clean up the content
          result.subject = result.subject.replace(/^["']|["']$/g, '').trim();
          result.body = result.body.replace(/^["']|["']$/g, '').trim();

          variants.push(result);
          console.log(`✅ Variant ${i + 1}/${variantCount} generated:`, result.subject.substring(0, 50) + '...');

        } catch (variantError) {
          console.error(`❌ Error generating variant ${i + 1}:`, variantError.message);
          
          // Add fallback variant
          variants.push({
            subject: `${['Quick idea', 'Opportunity', 'Partnership idea', 'Question', 'Collaboration'][i % 5]} for ${company || '[Company]'}`,
            body: `Hi ${name || '[Name]'},\n\nI hope this email finds you well. I wanted to reach out because I believe we could help ${company || '[Company]'} streamline operations and drive growth.\n\nWe've helped similar companies in your industry achieve significant improvements in efficiency and ROI. I'd love to share some specific examples that might be relevant to your current challenges.\n\nWould you be open to a brief 15-minute call this week to explore how we might be able to help?\n\nBest regards,\nPawan Kumar\nEnginerds Tech Solution`,
            fallback: true
          });
        }

        // Add small delay between API calls to avoid rate limiting
        if (i < variantCount - 1) {
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      }

      console.log(`✅ [AI GENERATION] Generated ${variants.length} variants successfully`);

      return res.json({ 
        variants: variants,
        count: variants.length
      });

    } catch (error) {
      console.error('❌ AI Generation Error:', error);
      
      // Return fallback variants on any error
      const { name, company, count = 1 } = req.body;
      const fallbackVariants = [];
      const variantCount = Math.min(Math.max(1, parseInt(count) || 1), 10);
      
      for (let i = 0; i < variantCount; i++) {
        fallbackVariants.push({
          subject: `${['Quick idea', 'Opportunity', 'Partnership idea', 'Question', 'Collaboration'][i % 5]} for ${company || '[Company]'}`,
          body: `Hi ${name || '[Name]'},\n\nI hope this email finds you well. I wanted to reach out because I believe we could help ${company || '[Company]'} streamline operations and drive growth.\n\nWe've helped similar companies achieve significant improvements in efficiency and ROI. I'd love to share some specific examples that might be relevant to your current challenges.\n\nWould you be open to a brief 15-minute call this week to explore how we might be able to help?\n\nBest regards,\nPawan Kumar\nEnginerds Tech Solution`,
          fallback: true
        });
      }
      
      return res.json({
        variants: fallbackVariants,
        count: fallbackVariants.length,
        error: error.message
      });
    }
  }

  res.status(400).json({ error: "Invalid type" });
};
