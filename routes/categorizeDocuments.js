// scripts/categorizeDocuments.js
import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';
import OpenAI from 'openai';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

async function runCategorization() {
  console.log("🚀 Categorizing uncategorized documents...");

  // Fetch up to 50 uncategorized chunks with valid content
  const { data: docs, error } = await supabase
    .from('test_documents')
    .select('id, content')
    .is('category', null)
    .not('content', 'is', null)
    .limit(50);

  if (error) throw error;
  if (!docs.length) {
    console.log("✅ No uncategorized chunks found.");
    return;
  }

  for (const doc of docs) {
    const prompt = `
You are an accounting assistant. Categorize the following document content into one of these categories:

- income
- expenses
- salary
- insurance
- tax
- receipt
- unclear

Respond ONLY with the category name.

Document:
"""${doc.content.slice(0, 1000)}"""
`;

    try {
      const chat = await openai.chat.completions.create({
        model: 'gpt-4.1-mini',
        messages: [{ role: 'user', content: prompt }],
      });

      const category = chat.choices[0].message.content.trim().toLowerCase();

      console.log(`📄 ${doc.id} → ${category}`);

      await supabase
        .from('test_documents')
        .update({ category })
        .eq('id', doc.id);

    } catch (err) {
      console.error(`❌ Error categorizing ${doc.id}:`, err.message);
    }
  }

  console.log("✅ Categorization complete.");
}

runCategorization();
