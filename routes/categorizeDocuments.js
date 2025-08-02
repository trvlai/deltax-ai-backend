// routes/categorizeDocuments.js

import { createClient } from '@supabase/supabase-js';
import OpenAI from 'openai';
import 'dotenv/config';

// 🔑 Initialize Supabase and OpenAI
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY // NOT the anon key!
);
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

async function runCategorization() {
  console.log("🚀 Starting document categorization...");

  // 1. Fetch up to 50 uncategorized documents with content
  const { data: docs, error } = await supabase
    .from('test_documents')
    .select('id, content')
    .is('category', null)
    .not('content', 'is', null)
    .limit(50);

  if (error) {
    console.error("❌ Error fetching docs:", error.message);
    return;
  }

  if (!docs.length) {
    console.log("✅ No uncategorized documents found.");
    return;
  }

  // 2. Loop over each document
  for (const doc of docs) {
    const prompt = `
You are an AI assistant for accountants. Categorize the following document into one of these categories:
- income
- expenses
- tax
- salary
- insurance
- receipt
- unclear

Respond ONLY with the category name.

Document content:
"""${doc.content.slice(0, 1000)}"""
`;

    try {
      const chat = await openai.chat.completions.create({
        model: "gpt-4.1-mini",
        messages: [{ role: "user", content: prompt }],
      });

      const categoryRaw = chat.choices[0].message.content?.trim().toLowerCase();
      const category = categoryRaw.replace(/[^a-z]/g, ""); // clean extra characters

      console.log(`📄 ${doc.id} → predicted: "${categoryRaw}"`);

      if (!category) {
        console.log(`⚠️ Skipping ${doc.id} — no valid category returned.`);
        continue;
      }

      const { error: updateError } = await supabase
        .from('test_documents')
        .update({ category })
        .eq('id', doc.id);

      if (updateError) {
        console.error(`❌ Failed to update ${doc.id}:`, updateError.message);
      } else {
        console.log(`✅ Updated ${doc.id} → category: "${category}"`);
      }

    } catch (err) {
      console.error(`❌ Error on ${doc.id}:`, err.message);
    }
  }

  console.log("🎉 Categorization run complete.");
}

runCategorization();
