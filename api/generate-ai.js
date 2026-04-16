// api/generate-ai.js — NVIDIA NIM AI
// POST { name, company, role, category, apiKey, customPrompt, count }
// Returns { variants: [{subject, body}, ...] } — up to 10 variants for round-robin

module.exports = async (req, res) => {
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { name, company, role, category, apiKey, customPrompt, count = 1 } = req.body;
  const key = apiKey || process.env.NVIDIA_API_KEY;
  if (!key) return res.status(400).json({ error: "NVIDIA API Key missing" });

  const variantCount = Math.min(parseInt(count) || 1, 10);

  const context = [
    name     ? `Recipient: ${name}`     : "",
    company  ? `Company: ${company}`    : "",
    role     ? `Role: ${role}`          : "",
    category ? `Industry: ${category}` : "",
  ].filter(Boolean).join(", ");

  const system = `You are a conversion-focused cold email expert for Enginerds Tech Solution (ERP & SaaS).
Your emails must:
1. Address the recipient's specific pain points and operational inefficiencies
2. Show ROI and transparent value — not vague promises
3. Sound like a real person, not a marketing template
4. Create urgency through insight, not pressure
5. Be conversational and direct
Respond ONLY with valid JSON array.`;

  const user = `Write ${variantCount} different cold email variant(s) for this prospect:
${context}
${customPrompt ? `\nSpecial focus: ${customPrompt}` : ""}

Each variant must:
- Have a UNIQUE subject line (max 9 words, no spam words, mention company or pain point)
- Body: 3-4 short paragraphs with \\n\\n between them
- Paragraph 1: Personalized opener referencing their company/industry specifically
- Paragraph 2: Identify a specific operational flaw or inefficiency they likely face
- Paragraph 3: How Enginerds solves it with transparent ROI (e.g. "reduce manual work by 60%", "real-time visibility")
- Paragraph 4: Simple CTA — one question or meeting request
- Sign off: "Best regards,\\nPawan Kumar\\nEnginerds Tech Solution"
- NO bullet points, NO generic phrases like "I hope this finds you well"
- Each variant must be COMPLETELY different in angle and approach

Return ONLY this JSON (array of ${variantCount} objects):
[{"subject":"...","body":"..."}${variantCount > 1 ? ',{"subject":"...","body":"..."}' : ''}]`;

  try {
    const response = await fetch("https://integrate.api.nvidia.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model:       "meta/llama-3.1-8b-instruct",
        messages:    [{ role: "system", content: system }, { role: "user", content: user }],
        temperature: 0.9,
        top_p:       1,
        max_tokens:  variantCount * 500,
        stream:      false,
      }),
    });

    const data = await response.json();
    if (!response.ok) throw new Error(data.error?.message || "NVIDIA API error");

    const choice = data.choices?.[0]?.message?.content;
    if (!choice) throw new Error("NVIDIA returned empty response");

    const raw = choice.trim();
    // Extract JSON array
    const jsonMatch = raw.match(/\[[\s\S]*\]/);
    if (!jsonMatch) throw new Error("AI did not return valid JSON array");

    const variants = JSON.parse(jsonMatch[0]);
    if (!Array.isArray(variants) || !variants[0]?.subject) throw new Error("Invalid response format");

    // Return first variant directly for backwards compat + all variants
    res.status(200).json({
      subject:  variants[0].subject.trim(),
      body:     variants[0].body.trim(),
      variants: variants.map(v => ({ subject: v.subject?.trim(), body: v.body?.trim() })).filter(v => v.subject && v.body)
    });
  } catch (err) {
    console.error("generate-ai error:", err.message);
    res.status(500).json({ error: err.message });
  }
};
