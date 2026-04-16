// api/tasks.js — Daily task engine
// GET /api/tasks → generate today's priority task list from leads + clients + deals

const { get } = require("./_redis");

function daysDiff(dateStr) {
  if (!dateStr) return null;
  return Math.ceil((new Date(dateStr) - Date.now()) / 86400000);
}

function daysSince(dateStr) {
  if (!dateStr) return null;
  return Math.floor((Date.now() - new Date(dateStr)) / 86400000);
}

module.exports = async (req, res) => {
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  try {
    const [rawLeads, rawClients, rawDeals] = await Promise.all([
      get("crm:leads"),
      get("crm:clients"),
      get("crm:deals"),
    ]);

    const leads   = JSON.parse(rawLeads   || "[]");
    const clients = JSON.parse(rawClients || "[]");
    const deals   = JSON.parse(rawDeals   || "[]");

    const tasks = [];
    const today = new Date().toDateString();

    // ── HOT LEADS — opened or clicked, not yet replied ──────────────────
    leads
      .filter(l => (l.opens >= 2 || l.clicks >= 1) && !["REPLIED","WON","LOST","UNSUBSCRIBED"].includes(l.pipelineStage))
      .forEach(l => tasks.push({
        priority: "HIGH",
        type: "CALL",
        icon: "🔥",
        title: `Call hot lead: ${l.name}`,
        detail: `${l.company || l.email} — opened ${l.opens||0}x, clicked ${l.clicks||0}x`,
        leadId: l.id,
        name: l.name,
        email: l.email,
      }));

    // ── FOLLOW-UP DUE — sent but no reply, 2+ days ago ──────────────────
    leads
      .filter(l => l.status === "SENT" && l.pipelineStage !== "REPLIED" && daysSince(l.lastSent) >= 2)
      .forEach(l => tasks.push({
        priority: "MEDIUM",
        type: "FOLLOWUP",
        icon: "📧",
        title: `Follow up: ${l.name}`,
        detail: `Sent ${daysSince(l.lastSent)} days ago — no reply yet`,
        leadId: l.id,
        name: l.name,
        email: l.email,
      }));

    // ── DEMO CALLS TODAY ─────────────────────────────────────────────────
    deals
      .filter(d => d.type === "DEMO" && d.demoDate && new Date(d.demoDate).toDateString() === today)
      .forEach(d => tasks.push({
        priority: "HIGH",
        type: "DEMO",
        icon: "📞",
        title: `Demo call today: ${d.clientName || d.leadName}`,
        detail: `${d.demoTime || "Time not set"} — ${d.notes || ""}`,
        dealId: d.id,
        name: d.clientName || d.leadName,
      }));

    // ── RENEWALS DUE SOON (within 30 days) ──────────────────────────────
    clients
      .filter(c => c.renewalDate && daysDiff(c.renewalDate) !== null && daysDiff(c.renewalDate) <= 30 && daysDiff(c.renewalDate) >= 0)
      .forEach(c => tasks.push({
        priority: daysDiff(c.renewalDate) <= 7 ? "HIGH" : "MEDIUM",
        type: "RENEWAL",
        icon: "🔄",
        title: `Renewal due: ${c.name}`,
        detail: `${c.software || "Software"} — expires in ${daysDiff(c.renewalDate)} days`,
        clientId: c.id,
        name: c.name,
        email: c.email,
      }));

    // ── OVERDUE PAYMENTS ─────────────────────────────────────────────────
    clients
      .filter(c => c.paymentStatus === "OVERDUE")
      .forEach(c => tasks.push({
        priority: "HIGH",
        type: "PAYMENT",
        icon: "💰",
        title: `Overdue payment: ${c.name}`,
        detail: `${c.software || ""} — ₹${c.amount || 0} pending`,
        clientId: c.id,
        name: c.name,
        email: c.email,
      }));

    // ── PENDING QUOTATIONS (older than 3 days, no response) ─────────────
    deals
      .filter(d => d.type === "QUOTATION" && d.status === "SENT" && daysSince(d.createdAt) >= 3)
      .forEach(d => tasks.push({
        priority: "MEDIUM",
        type: "QUOTE_FOLLOWUP",
        icon: "📋",
        title: `Follow up on quote: ${d.clientName || d.leadName}`,
        detail: `Sent ${daysSince(d.createdAt)} days ago — ₹${d.amount || 0}`,
        dealId: d.id,
        name: d.clientName || d.leadName,
      }));

    // Sort: HIGH first, then MEDIUM
    const order = { HIGH: 0, MEDIUM: 1, LOW: 2 };
    tasks.sort((a, b) => order[a.priority] - order[b.priority]);

    res.json({ tasks, generatedAt: new Date().toISOString(), counts: {
      total: tasks.length,
      high: tasks.filter(t => t.priority === "HIGH").length,
      medium: tasks.filter(t => t.priority === "MEDIUM").length,
    }});
  } catch (err) {
    console.error("tasks error:", err.message);
    res.status(500).json({ error: err.message });
  }
};
