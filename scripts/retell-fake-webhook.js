// Posts a correctly SIGNED fake "call_analyzed" webhook to a CRM server, so the Calls page can be tested
// without a real call. Needs the same RETELL_API_KEY the server uses.
//   RETELL_API_KEY=key_x node scripts/retell-fake-webhook.js http://127.0.0.1:3000 <leadId> [outcome]
const crypto = require("crypto");
const [,, base = "http://127.0.0.1:3000", leadId = "", outcome = "interested"] = process.argv;
const key = process.env.RETELL_API_KEY;
if (!key) { console.error("set RETELL_API_KEY"); process.exit(1); }
const now = Date.now();
const call = {
  call_id: "call_fake_" + now, agent_id: "agent_fake", call_type: "phone_call", direction: "outbound",
  from_number: "+14155550100", to_number: "+919876543210", call_status: "ended",
  start_timestamp: now - 95000, end_timestamp: now - 5000, duration_ms: 90000, disconnection_reason: "agent_hangup",
  transcript: "Agent: Hello, this is Riya from Enginerds.\nUser: Haan boliye.\nAgent: ...",
  metadata: leadId ? { leadId } : {},
  call_analysis: { call_summary: "Fake test call. The person asked for a demo next Tuesday at 11am.", user_sentiment: "Positive", call_successful: true, custom_analysis_data: { outcome, preferred_time: "Tuesday 11am" } },
  call_cost: { combined_cost: 12.5 },
};
(async () => {
  for (const event of ["call_ended", "call_analyzed"]) {
    const body = Buffer.from(JSON.stringify({ event, call }));
    const ts = String(Date.now());
    const d = crypto.createHmac("sha256", key).update(Buffer.concat([body, Buffer.from(ts)])).digest("hex");
    const r = await fetch(base + "/api/retell-webhook", { method: "POST", headers: { "content-type": "application/json", "x-retell-signature": `v=${ts},d=${d}` }, body });
    console.log(event, "→ HTTP", r.status);
  }
})();
