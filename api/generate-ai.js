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
STRICT RULES — violating these will cause the email to fail:
1. ONLY use the exact name, company, and industry provided. NEVER invent names, cities, locations, or details.
2. If company name is provided, use it exactly. If not, say "your business" — never make up a name.
3. If recipient name is provided, use it. If not, use "Hi there" — never invent a name.
4. Write like a real person sending a personal email — NOT a marketing template.
5. NO placeholder text like [City], [Location], [Name] — use real values or omit entirely.
6. Keep it conversational, direct, under 120 words.
Respond ONLY with valid JSON array.`;

  const user = `Write ${variantCount} cold email variant(s) for this prospect:
${context}
${customPrompt ? `\nFocus: ${customPrompt}` : ""}

CRITICAL — use ONLY the data above. Do NOT invent any names, locations, or details not provided.
If company is "Nerds" or unclear, write "your business" instead of making up a company name.

Each variant:
- subject: max 9 words, reference their actual company/industry, no spam words
- body: 3 short paragraphs separated by \\n\\n
  Para 1: Personal opener using their REAL name and REAL company only
  Para 2: Identify a specific pain point for their industry (${context.includes('Industry') ? context.split('Industry:')[1]?.split('\n')[0]?.trim() : 'their sector'})
  Para 3: How Enginerds solves it + one clear CTA
- Sign off: "Best regards,\\nPawan Kumar\\nEnginerds Tech Solution"
- NO bullet points, NO [placeholders], NO invented details

Return ONLY this JSON array:
[{"subject":"...","body":"..."}]`;

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
