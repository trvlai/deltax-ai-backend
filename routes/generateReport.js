import express from "express";
import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import axios from "axios";

dotenv.config();

const router = express.Router();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

router.get("/:accountant/:client", async (req, res) => {
  const { accountant, client } = req.params;

  try {
    const { data, error } = await supabase
      .from("test_documents")
      .select("note")
      .eq("accountant", accountant)
      .eq("client", client);

    if (error) throw error;

    const notes = data.map((row) => row.note).join("\n\n");

    const prompt = `Based on the following notes, generate a final tax report for the client:\n\n${notes}`;

    const response = await axios.post(
      "https://api.openai.com/v1/chat/completions",
      {
        model: "gpt-4.1-mini",
        messages: [
          {
            role: "system",
            content:
              "You are a professional tax accountant. Generate a concise yet complete tax report based on provided notes.",
          },
          { role: "user", content: prompt },
        ],
        temperature: 0.4,
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        },
      }
    );

    const report = response.data.choices[0].message.content;
    res.status(200).json({ report });
  } catch (err) {
    console.error("🔴 Report Generation Error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

export default router;
