// api/generate-ai.js — NVIDIA NIM AI
// POST { name, company, role, category, apiKey, customPrompt, count }
// Returns { variants: [{subject, body}, ...] }

module.exports = async (req, res) => {
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { name, company, role, category, apiKey, customPrompt, count = 1 } = req.body;
  const key = apiKey || process.env.NVIDIA_API_KEY;
  if (!key) return res.status(400).json({ error: "NVIDIA API Key missing. Add it in Settings." });

  const variantCount = Math.min(parseInt(count) || 1, 10);
  const context = [name ? `Recipient: ${name}` : "", company ? `Company: ${company}` : "", role ? `Role: ${role}` : "", category ? `Industry: ${category}` : ""].filter(Boolean).join(", ");

  const system = `You are a world-class B2B sales strategist. Write conversational, high-converting cold emails for Enginerds Tech Solution.
  
STRATEGY:
- START by identifying a specific, industry problem (manual data entry, lag, lack of visibility).
- Pivot to how Enginerds ERP/SaaS solves it.
- Human, conversational tone. No fluff. 
- Return ONLY a JSON array: [{"subject":"...","body":"..."}]`;

  const user = `Generate ${variantCount} cold email variant(s).
PROSPECT: ${context}
${customPrompt ? `FOCUS: ${customPrompt}` : ""}

RULES:
- Subject: intriguing, mentions company.
- Body: 3 paragraphs, under 140 words.
- Signature: "Best regards,\\nPawan Kumar\\nEnginerds Tech Solution"`;

  try {
    const response = await fetch("https://integrate.api.nvidia.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model:       "meta/llama-3.1-8b-instruct",
        messages:    [{ role: "system", content: system }, { role: "user", content: user }],
        temperature: 0.7,
        max_tokens:  3000,
        stream:      false,
      }),
    });

    const data = await response.json();
    if (!response.ok) throw new Error(data.error?.message || `NVIDIA error: ${response.status}`);

    let content = data.choices?.[0]?.message?.content || "";
    if (!content) throw new Error("Empty response from AI");

    // Robust JSON extraction
    const jsonMatch = content.match(/\[\s*{[\s\S]*}\s*\]/);
    if (!jsonMatch) {
        // Try fallback if AI just gave one object
        const objMatch = content.match(/{\s*"subject"[\s\S]*"body"[\s\S]*}/);
        if (objMatch) {
            const variant = JSON.parse(objMatch[0]);
            return res.status(200).json({ variants: [variant] });
        }
        throw new Error("AI did not return a valid JSON structure");
    }
    
    const variants = JSON.parse(jsonMatch[0]);
    res.status(200).json({ variants });
  } catch (err) {
    console.error("AI Error:", err.message);
    const fallback = {
      subject: `Question for ${company || 'your business'}`,
      body: `Hi ${name || 'there'},\n\nI noticed ${company || 'your business'} and wanted to share how Enginerds helps streamline operations.\n\nBest regards,\nPawan Kumar\nEnginerds Tech Solution`
    };
    res.status(500).json({ error: err.message, variants: [fallback], fallback });
  }
};
