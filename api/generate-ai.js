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
Write highly personalized, human-sounding outreach emails. Never use spam trigger words.
CRITICAL: You MUST use the recipient's actual name, company name, and industry in the email — not placeholders.
Respond ONLY with valid JSON — no markdown, no explanation outside the JSON.`;

  const user = `Write a personalized cold outreach email using EXACTLY this recipient data:
${context}
${customPrompt ? `\nExtra instructions: ${customPrompt}` : ""}

CRITICAL RULES:
- Use the recipient's ACTUAL name (not "there" or generic greetings)
- Mention their ACTUAL company name specifically
- Reference their ACTUAL industry/role to show you know them
- subject: max 9 words, mention their company or industry, no spam words
- body: 80-120 words, 3-4 short paragraphs separated by blank lines
- Each paragraph on its own line with a blank line between them
- One clear CTA (call to action)
- No bullet points, no subject line in body
- Sign off as last paragraph: "Best regards,\\nPawan Kumar\\nEnginerds Tech Solution"

Return ONLY this JSON (use \\n\\n between paragraphs in body):
{"subject":"...","body":"..."}`;

  try {
    const response = await fetch("https://integrate.api.nvidia.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model:       "meta/llama-3.1-8b-instruct",  // 8B is 3-4x faster than 70B
        messages:    [{ role: "system", content: system }, { role: "user", content: user }],
        temperature: 0.8,
        top_p:       1,
        max_tokens:  400,  // reduced — emails don't need more
        stream:      false,
      }),
    });

    const data = await response.json();
    if (!response.ok) throw new Error(data.error?.message || "NVIDIA API error");

    const choice = data.choices?.[0]?.message?.content;
    if (!choice) throw new Error("NVIDIA returned empty response — check your API key and model availability");

    const raw     = choice.trim();
    // Extract JSON even if model adds text before/after
    const jsonMatch = raw.match(/\{[\s\S]*"subject"[\s\S]*"body"[\s\S]*\}/);
    if (!jsonMatch) throw new Error("AI did not return valid JSON. Response: " + raw.slice(0, 100));
    const parsed  = JSON.parse(jsonMatch[0]);

    if (!parsed.subject || !parsed.body) throw new Error("AI returned incomplete JSON");

    res.status(200).json({ subject: parsed.subject.trim(), body: parsed.body.trim() });
  } catch (err) {
    console.error("generate-ai error:", err.message);
    res.status(500).json({ error: err.message });
  }
};
