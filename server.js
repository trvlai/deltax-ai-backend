// server.js

import express from "express";
import cors from "cors";
import multer from "multer";
import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import axios from "axios";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

// Use in‑memory storage so we never write to disk
const upload = multer({ storage: multer.memoryStorage() });

// Supabase client (server‑side only)
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// POST /api/upload
app.post("/api/upload", upload.single("file"), async (req, res) => {
  try {
    const { accountant, client, type, notes } = req.body;
    const file = req.file;

    if (!file || !accountant || !client) {
      return res
        .status(400)
        .json({ error: "Missing file, accountant, or client." });
    }

    const key = `${accountant}/${client}/${Date.now()}-${file.originalname}`;
    const { error: uploadError } = await supabase.storage
      .from("deltax-uploads")
      .upload(key, file.buffer, { contentType: file.mimetype });

    if (uploadError) throw uploadError;
    return res.status(200).json({ message: "File uploaded", key });
  } catch (err) {
    console.error("🔴 Upload failed:", err);
    return res.status(500).json({ error: err.message });
  }
});

// GET /api/files/:accountant?client=...
app.get("/api/files/:accountant", async (req, res) => {
  try {
    const { accountant } = req.params;
    let clientParam = req.query.client;
    const client = Array.isArray(clientParam) ? clientParam[0] : clientParam;

    if (!client) {
      return res
        .status(400)
        .json({ error: "Missing client query parameter." });
    }

    const prefix = `${accountant}/${client}/`;
    const { data, error: listError } = await supabase.storage
      .from("deltax-uploads")
      .list(prefix, { limit: 100, offset: 0, sortBy: { column: "name", order: "asc" } });
    if (listError) throw listError;

    // Return both name and signed URL
    const files = await Promise.all(
      data.map(async (obj) => {
        const fullPath = `${prefix}${obj.name}`;
        const { signedURL, error: urlError } = await supabase.storage
          .from("deltax-uploads")
          .createSignedUrl(fullPath, 60 * 60);
        if (urlError) throw urlError;
        return { name: obj.name, url: signedURL };
      })
    );

    return res.status(200).json(files);
  } catch (err) {
    console.error("🔴 Listing failed:", err);
    return res.status(500).json({ error: err.message });
  }
});

// POST /api/chat
app.post("/api/chat", async (req, res) => {
  try {
    const userMessage = req.body.message;
    const response = await axios.post(
      "https://api.openai.com/v1/chat/completions",
      {
        model: "gpt-4.1-mini",
        messages: [
          { role: "system", content: "You are a helpful accounting assistant." },
          { role: "user", content: userMessage },
        ],
        temperature: 0.7,
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        },
      }
    );
    const reply = response.data.choices[0].message.content;
    return res.status(200).json({ reply });
  } catch (err) {
    console.error("🔴 OpenAI API Error:", err.response?.data || err.message);
    return res
      .status(500)
      .json({ error: "OpenAI Error", details: err.response?.data || err.message });
  }
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));
