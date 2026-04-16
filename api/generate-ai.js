// api/generate-ai.js — NVIDIA NIM AI: generates subject + body
// POST { name, company, role, category, apiKey, customPrompt }
// Returns { subject, body }

module.exports = async (req, res) => {
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { name, company, role, category, apiKey, customPrompt } = req.body;
  const key = apiKey || process.env.NVIDIA_API_KEY;
  if (!key) return res.status(400).json({ error: "NVIDIA API Key missing" });

  const context = [
    name     ? `Recipient Name: ${name}`         : "",
    company  ? `Company: ${company}`              : "",
    role     ? `Role/Title: ${role}`              : "",
    category ? `Industry: ${category}`            : "",
  ].filter(Boolean).join("\n");

  const system = `You are an expert cold email copywriter for Enginerds Tech Solution (ERP & SaaS). 
Write concise, human-sounding outreach emails. Never use spam trigger words.
Respond ONLY with valid JSON — no markdown, no explanation outside the JSON.`;

  const user = `Write a cold outreach email using this context:
${context}
${customPrompt ? `\nExtra instructions: ${customPrompt}` : ""}

Rules:
- subject: max 9 words, curiosity-driven, no spam words (free, guaranteed, act now)
- body: 80-120 words, conversational, one clear CTA, no bullet points, no subject line in body
- Personalize using company/role/industry
- Sign off: Pawan Kumar, Enginerds Tech Solution

Return ONLY this JSON:
{"subject":"...","body":"..."}`;

  try {
    const response = await fetch("https://integrate.api.nvidia.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model:       "openai/gpt-oss-120b",
        messages:    [{ role: "system", content: system }, { role: "user", content: user }],
        temperature: 0.75,
        top_p:       1,
        max_tokens:  512,
        stream:      false,
      }),
    });

    const data = await response.json();
    if (!response.ok) throw new Error(data.error?.message || "NVIDIA API error");

    const choice = data.choices?.[0]?.message?.content;
    if (!choice) throw new Error("NVIDIA returned empty response — check your API key and model availability");

    const raw     = choice.trim();
    const cleaned = raw.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```\s*$/,"").trim();
    const parsed  = JSON.parse(cleaned);

    if (!parsed.subject || !parsed.body) throw new Error("AI returned incomplete JSON");

    res.status(200).json({ subject: parsed.subject.trim(), body: parsed.body.trim() });
  } catch (err) {
    console.error("generate-ai error:", err.message);
    res.status(500).json({ error: err.message });
  }
};
