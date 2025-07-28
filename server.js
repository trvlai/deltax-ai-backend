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

const upload = multer({ storage: multer.memoryStorage() });

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

app.post("/api/upload", upload.single("file"), async (req, res) => {
  try {
    const { accountant, client } = req.body;
    const file = req.file;
    if (!file || !accountant || !client) {
      return res.status(400).json({ error: "Missing file, accountant, or client." });
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

app.get("/api/files/:accountant", async (req, res) => {
  try {
    const { accountant } = req.params;
    let cp = req.query.client;
    const client = Array.isArray(cp) ? cp[0] : cp;
    if (!client) return res.status(400).json({ error: "Missing client query parameter." });

    const prefix = `${accountant}/${client}/`;
    const { data, error: listError } = await supabase.storage
      .from("deltax-uploads")
      .list(prefix, { limit: 100, offset: 0, sortBy: { column: "name", order: "asc" } });
    if (listError) throw listError;

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

app.post("/api/chat", async (req, res) => {
  try {
    const { message } = req.body;
    const ai = await axios.post(
      "https://api.openai.com/v1/chat/completions",
      {
        model: "gpt-4.1-mini",
        messages: [
          { role: "system", content: "You are a helpful accounting assistant." },
          { role: "user", content: message },
        ],
      },
      { headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` } }
    );
    return res.status(200).json({ reply: ai.data.choices[0].message.content });
  } catch (err) {
    console.error("🔴 OpenAI Error:", err.response?.data || err.message);
    return res.status(500).json({ error: "OpenAI Error", details: err.response?.data || err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ Server up on port ${PORT}`));
