// api/generate-ai.js — NVIDIA NIM AI
// POST { name, company, role, category, apiKey, customPrompt, count }
// Returns { variants: [{subject, body}, ...] } — up to 10 variants for round-robin

module.exports = async (req, res) => {
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { name, company, role, category, apiKey, customPrompt, count = 1 } = req.body;
  const key = apiKey || process.env.NVIDIA_API_KEY;
  if (!key) return res.status(400).json({ error: "NVIDIA API Key missing. Add it in Settings or set NVIDIA_API_KEY environment variable." });

  const variantCount = Math.min(parseInt(count) || 1, 10);

  const context = [
    name     ? `Recipient: ${name}`     : "",
    company  ? `Company: ${company}`    : "",
    role     ? `Role: ${role}`          : "",
    category ? `Industry: ${category}` : "",
  ].filter(Boolean).join(", ");

  const system = `You are an expert cold email writer for Enginerds Tech Solution (ERP & SaaS company).

CRITICAL RULES:
1. Use ONLY the exact information provided - never invent details
2. Write conversational, personal emails - not marketing templates
3. Keep emails under 120 words
4. Return ONLY a JSON array - no markdown, no explanations
5. Use proper JSON format with escaped newlines

Response format:
[{"subject":"...","body":"..."}]`;

  const user = `Generate ${variantCount} cold email variant(s).

Prospect info:
${context}
${customPrompt ? `Special focus: ${customPrompt}` : ""}

Requirements:
- Subject: Max 9 words, mention their company/industry
- Body: 3 paragraphs (use \\n\\n between paragraphs):
  * Para 1: Personal greeting with their name and company
  * Para 2: Specific pain point for their industry
  * Para 3: How Enginerds helps + clear CTA
- Signature: "Best regards,\\nPawan Kumar\\nEnginerds Tech Solution"
- NO placeholders like [Name] or [Company]
- Use "your business" if company name is unclear

Return ONLY the JSON array with proper escaping:`;

  try {
    const response = await fetch("https://integrate.api.nvidia.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model:       "meta/llama-3.1-8b-instruct",
        messages:    [{ role: "system", content: system }, { role: "user", content: user }],
        temperature: 0.7,
        top_p:       0.9,
        max_tokens:  variantCount * 600,
        stream:      false,
      }),
    });

    const data = await response.json();
    if (!response.ok) {
      console.error("NVIDIA API error:", JSON.stringify(data));
      throw new Error(data.error?.message || data.detail || `NVIDIA API error: ${response.status}`);
    }

    const choice = data.choices?.[0]?.message?.content;
    if (!choice) {
      console.error("Empty response from NVIDIA:", JSON.stringify(data));
      throw new Error("NVIDIA returned empty response");
    }

    let raw = choice.trim();
    console.log("AI response preview:", raw.substring(0, 200));
    
    // Extract JSON - try multiple strategies
    let jsonStr = null;
    
    // 1. Try markdown code block
    const codeBlock = raw.match(/```(?:json)?\s*(\[[\s\S]*?\])\s*```/);
    if (codeBlock) jsonStr = codeBlock[1];
    
    // 2. Try direct array match
    if (!jsonStr) {
      const arrayMatch = raw.match(/\[[\s\S]*\]/);
      if (arrayMatch) jsonStr = arrayMatch[0];
    }
    
    if (!jsonStr) {
      console.error("Could not extract JSON from:", raw);
      throw new Error("AI did not return valid JSON. Please try again.");
    }

    // Parse JSON
    let variants;
    try {
      variants = JSON.parse(jsonStr);
    } catch (parseErr) {
      console.error("JSON parse failed:", parseErr.message);
      console.error("Tried to parse:", jsonStr.substring(0, 300));
      
      // Try to fix common issues and retry
      try {
        const fixed = jsonStr
          .replace(/[\u0000-\u0008\u000B-\u000C\u000E-\u001F\u007F-\u009F]/g, '') // Remove control chars except \n \r \t
          .replace(/\n/g, '\\n')
          .replace(/\r/g, '')
          .replace(/\t/g, ' ');
        variants = JSON.parse(fixed);
        console.log("JSON fixed and parsed successfully");
      } catch (retryErr) {
        throw new Error(`Invalid JSON from AI: ${parseErr.message}`);
      }
    }

    if (!Array.isArray(variants) || variants.length === 0) {
      throw new Error("AI returned invalid format");
    }

    if (!variants[0]?.subject || !variants[0]?.body) {
      throw new Error("AI returned incomplete data");
    }

    // Clean variants
    const cleaned = variants
      .map(v => ({
        subject: String(v.subject || '').trim(),
        body: String(v.body || '').trim()
      }))
      .filter(v => v.subject && v.body);

    if (cleaned.length === 0) {
      throw new Error("No valid variants generated");
    }

    res.status(200).json({
      subject:  cleaned[0].subject,
      body:     cleaned[0].body,
      variants: cleaned
    });
  } catch (err) {
    console.error("generate-ai error:", err.message);
    
    // Fallback: return a basic template if AI completely fails
    const fallbackVariant = {
      subject: `Quick question about ${company || 'your business'}`,
      body: `Hi ${name || 'there'},\n\nI noticed ${company || 'your company'} and thought you might be interested in how we help businesses streamline their operations with our ERP solutions.\n\nWe've helped similar companies reduce manual work by 60% and gain real-time visibility across their operations.\n\nWould you be open to a quick 15-minute call this week?\n\nBest regards,\nPawan Kumar\nEnginerds Tech Solution`
    };
    
    res.status(500).json({ 
      error: err.message || "Failed to generate email",
      fallback: fallbackVariant,
      variants: [fallbackVariant]
    });
  }
};
