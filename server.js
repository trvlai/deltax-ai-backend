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

// In-memory uploads
const upload = multer({ storage: multer.memoryStorage() });

// Supabase client
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// === FILE UPLOAD ===
app.post("/api/upload", upload.single("file"), async (req, res) => {
  try {
    const { accountant, client, type, notes } = req.body;
    const file = req.file;

    if (!file || !accountant || !client) {
      res.status(400).json({ error: "Missing file, accountant, or client." });
      return;
    }

    const key = `${accountant}/${client}/${Date.now()}-${file.originalname}`;
    const { error: uploadError } = await supabase.storage
      .from("deltax-uploads")
      .upload(key, file.buffer, { contentType: file.mimetype });

    if (uploadError) throw uploadError;

    res.setHeader("Content-Type", "application/json");
    res.status(200).send(JSON.stringify({ message: "File uploaded", key }));
  } catch (err) {
    console.error("🔴 Upload failed:", err);
    res.status(500).json({ error: err.message });
  }
});

// === GET FILE LIST FOR ACCOUNTANT ===
app.get("/api/files/:accountant", async (req, res) => {
  try {
    const { accountant } = req.params;
    const { data: folders, error: folderError } = await supabase.storage
      .from("deltax-uploads")
      .list(`${accountant}/`, { limit: 100 });

    if (folderError) throw folderError;

    const allFiles = [];

    for (const folder of folders) {
      if (!folder.name) continue;
      const prefix = `${accountant}/${folder.name}/`;

      const { data: files, error: listError } = await supabase.storage
        .from("deltax-uploads")
        .list(prefix, {
          limit: 100,
          offset: 0,
          sortBy: { column: "name", order: "asc" },
        });

      if (listError) throw listError;

      for (const obj of files) {
        const fullPath = `${prefix}${obj.name}`;
        const {
          data: { signedUrl },
          error: urlError,
        } = await supabase.storage
          .from("deltax-uploads")
          .createSignedUrl(fullPath, 60 * 60);

        if (urlError) throw urlError;

        allFiles.push({
          name: obj.name,
          url: signedUrl,
          client: folder.name,
        });
      }
    }

    res.status(200).json(allFiles);
  } catch (err) {
    console.error("🔴 Listing failed:", err);
    res.status(500).json({ error: err.message });
  }
});

// === CHAT ROUTE ===
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
    res.status(200).json({ reply });
  } catch (err) {
    console.error("🔴 OpenAI API Error:", err.response?.data || err.message);
    res.status(500).json({
      error: "OpenAI Error",
      details: err.response?.data || err.message,
    });
  }
});

// === START SERVER ===
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));
