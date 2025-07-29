const express = require('express');
const router = express.Router();
const { createClient } = require('@supabase/supabase-js');
const { OpenAI } = require('openai');
require('dotenv').config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

router.post('/:accountant/:client', async (req, res) => {
  const { accountant, client } = req.params;

  try {
    const { data, error } = await supabase
      .from('test_documents')
      .select('content')
      .eq('accountant', accountant)
      .eq('client', client);

    if (error) throw error;

    const chunks = data.map(doc => doc.content).join('\n');

    const response = await openai.chat.completions.create({
      model: 'gpt-4-1106-preview',
      messages: [
        {
          role: 'system',
          content: `You are a Cyprus tax accountant. Generate a structured tax report for a client using only the provided text below.`,
        },
        {
          role: 'user',
          content: chunks,
        },
      ],
      temperature: 0.3,
    });

    const report = response.choices[0].message.content;
    res.json({ report });

  } catch (err) {
    console.error('❌ Error generating report:', err.message);
    res.status(500).json({ error: 'Failed to generate report' });
  }
});

module.exports = router;
