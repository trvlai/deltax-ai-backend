// routes/chatWithDocs.js
import express from "express";
import { createClient } from "@supabase/supabase-js";
import axios from "axios";
import dotenv from "dotenv";
dotenv.config();

const router = express.Router();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

router.post("/", async (req, res) => {
  const { question, accountant, client } = req.body;

  if (!question || !accountant || !client) {
    return res.status(400).json({ error: "Missing fields" });
  }

  try {
    // STEP 1 — Embed user question
    const embeddingResponse = await axios.post(
      "https://api.openai.com/v1/embeddings",
      {
        input: question,
        model: "text-embedding-3-small",
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        },
      }
    );

    const userEmbedding = embeddingResponse.data.data[0].embedding;

    // STEP 2 — Search Supabase for similar content
    const { data: chunks, error } = await supabase.rpc("match_documents", {
      query_embedding: userEmbedding,
      match_count: 10,
      filter_accountant: accountant,
      filter_client: client,
    });

    if (error) throw error;

    // STEP 3 — Build context string
    const contextText = chunks.map((chunk) => chunk.content).join("\n---\n");

    const prompt = `
You are a Cyprus-based accounting assistant.

Use the following context to answer the question.

Context:
${contextText}

Question: ${question}
Answer:`.trim();

    // STEP 4 — Call GPT model
    const chatResponse = await axios.post(
      "https://api.openai.com/v1/chat/completions",
      {
        model: "gpt-4.1-mini",
        messages: [
          { role: "system", content: "You are a helpful Cyprus tax assistant." },
          { role: "user", content: prompt },
        ],
        temperature: 0.3,
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        },
      }
    );

    const answer = chatResponse.data.choices[0].message.content;
    res.status(200).json({ answer, sources: chunks });
  } catch (err) {
    console.error("🔴 chatWithDocs error:", err.response?.data || err.message);
    res.status(500).json({ error: "Internal error", details: err.message });
  }
});

export default router;
