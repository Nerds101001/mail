// Simple test version of AI generation
module.exports = async (req, res) => {
  console.log('AI endpoint called:', req.method, req.body);
  
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { name, company, apiKey, customPrompt } = req.body;
    
    // For now, return a test response to see if the endpoint works
    res.json({
      subject: `Test AI Subject for ${company || 'Your Company'}`,
      body: `Hi ${name || 'there'},\n\nThis is a test AI-generated email for ${company || 'your company'}.\n\nCustom prompt: ${customPrompt || 'None'}\nAPI Key provided: ${apiKey ? 'Yes' : 'No'}\n\nBest regards,\nPawan Kumar`,
      test: true,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('AI Generation Error:', error);
    res.status(500).json({
      error: error.message,
      test: true
    });
  }
};