// api/generate-ai.js — AI Email Generation using NVIDIA NIM
module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { name, company, role, category, apiKey, customPrompt } = req.body;

    if (!apiKey) {
      return res.status(400).json({ error: 'NVIDIA API key is required' });
    }

    // Construct the AI prompt
    const systemPrompt = `You are an expert email copywriter specializing in B2B sales emails. Generate a personalized, professional email that:
1. Is concise and engaging (150-200 words max)
2. Focuses on value proposition for the recipient
3. Has a clear call-to-action
4. Sounds natural and conversational
5. Avoids being overly salesy

Context:
- Recipient: ${name || 'the recipient'}
- Company: ${company || 'their company'}
- Role: ${role || 'decision maker'}
- Category: ${category || 'business professional'}

${customPrompt ? `Additional instructions: ${customPrompt}` : ''}

Generate both a subject line and email body. Return as JSON with "subject" and "body" fields.`;

    const userPrompt = `Generate a personalized B2B sales email for ${name} at ${company}. Make it professional, valuable, and engaging.`;

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
        temperature: 0.7,
        max_tokens: 500,
        top_p: 0.9
      })
    });

    if (!response.ok) {
      const errorData = await response.text();
      console.error('NVIDIA API Error:', response.status, errorData);
      
      // Return fallback email if API fails
      return res.json({
        subject: `Quick idea for ${company}`,
        body: `Hi ${name},\n\nI hope this email finds you well. I wanted to reach out because I believe we could help ${company} streamline operations and drive growth.\n\nWe've helped similar companies in your industry achieve significant improvements in efficiency and ROI. I'd love to share some specific examples that might be relevant to your current challenges.\n\nWould you be open to a brief 15-minute call this week to explore how we might be able to help?\n\nBest regards,\nPawan Kumar\nEnginerds Tech Solution`,
        fallback: true
      });
    }

    const data = await response.json();
    
    if (!data.choices || !data.choices[0] || !data.choices[0].message) {
      throw new Error('Invalid response from NVIDIA API');
    }

    const aiResponse = data.choices[0].message.content;
    
    // Try to parse as JSON first
    let result;
    try {
      result = JSON.parse(aiResponse);
    } catch (parseError) {
      // If not JSON, extract subject and body manually
      const lines = aiResponse.split('\n').filter(line => line.trim());
      
      let subject = `Quick idea for ${company}`;
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
      result.subject = `Quick idea for ${company}`;
    }
    
    if (!result.body) {
      result.body = `Hi ${name},\n\nI hope this email finds you well. I wanted to reach out because I believe we could help ${company} achieve your business goals.\n\nWould you be open to a brief conversation to explore potential opportunities?\n\nBest regards,\nPawan Kumar\nEnginerds Tech Solution`;
    }

    // Clean up the content
    result.subject = result.subject.replace(/^["']|["']$/g, '').trim();
    result.body = result.body.replace(/^["']|["']$/g, '').trim();

    console.log('✅ AI Email Generated:', { subject: result.subject.substring(0, 50) + '...' });

    res.json(result);

  } catch (error) {
    console.error('❌ AI Generation Error:', error);
    
    // Return fallback email on any error
    const { name, company } = req.body;
    res.json({
      subject: `Quick idea for ${company || 'your company'}`,
      body: `Hi ${name || 'there'},\n\nI hope this email finds you well. I wanted to reach out because I believe we could help ${company || 'your company'} streamline operations and drive growth.\n\nWe've helped similar companies achieve significant improvements in efficiency and ROI. I'd love to share some specific examples that might be relevant to your current challenges.\n\nWould you be open to a brief 15-minute call this week to explore how we might be able to help?\n\nBest regards,\nPawan Kumar\nEnginerds Tech Solution`,
      fallback: true,
      error: error.message
    });
  }
};