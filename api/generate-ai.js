// api/generate-ai.js
// NVIDIA NIM AI Integration
module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  
  const { name, company, apiKey, customPrompt } = req.body;
  const key = apiKey || process.env.NVIDIA_API_KEY; 

  if (!key) return res.status(400).json({ error: 'NVIDIA API Key missing' });

  let prompt = `Write a professional, 100-word cold email for ${name} from ${company}. 
            Subject should be about ERP/SaaS solutions from Enginerds Tech Solution. 
            Do not include a subject line, body only.`;
  
  if(customPrompt) {
    prompt += `\n\nAdditional Instructions: ${customPrompt}`;
  }

  try {
    const response = await fetch('https://integrate.api.nvidia.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${key}`
      },
      body: JSON.stringify({
        model: "openai/gpt-oss-120b",
        messages: [
          {
            role: "user",
            content: prompt
          }
        ],
        temperature: 0.7,
        top_p: 1,
        max_tokens: 1024,
        stream: false // Disabled streaming for simpler CRM integration
      })
    });

    const data = await response.json();
    if (!response.ok) throw new Error(data.error?.message || 'NVIDIA API Error');

    const content = data.choices[0].message.content;
    res.status(200).json({ content });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
