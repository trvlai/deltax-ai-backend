import express from "express";
import cors from "cors";
import multer from "multer";
import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import axios from "axios";
import generateReportRoute from "./routes/generateReport.js";
import chatWithDocsRoute from "./routes/chatWithDocs.js";

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
    const { accountant, client, type, notes } = req.body;
    const file = req.file;

    if (!file || !accountant || !client) {
      return res.status(400).json({ error: "Missing file, accountant, or client." });
    }

    const filename = `${Date.now()}-${file.originalname}`;
    const key = `${accountant}/${client}/${filename}`;

    // Upload to Supabase Storage
    const { error: uploadError } = await supabase.storage
      .from("deltax-uploads")
      .upload(key, file.buffer, { contentType: file.mimetype });

    if (uploadError) throw uploadError;

    // Extract text or fallback
    let fullText = "";

    console.log("🟡 Uploading:", {
      name: file.originalname,
      size: file.size,
      type: file.mimetype,
    });

    if (file.mimetype === "application/pdf") {
      try {
        const pdfParse = await import("pdf-parse");
        const data = await pdfParse.default(file.buffer);
        fullText = data.text || "[Empty PDF]";
      } catch (err) {
        console.error("🔴 PDF parsing failed:", err.message);
        return res.status(400).json({ error: "Failed to parse PDF file." });
      }
    } else {
      fullText = "[Image uploaded — no text extracted]";
    }

    const chunks = [];
    const chunkSize = 500;
    for (let i = 0; i < fullText.length; i += chunkSize) {
      chunks.push(fullText.slice(i, i + chunkSize));
    }

    for (const chunk of chunks) {
      const embeddingRes = await axios.post(
        "https://api.openai.com/v1/embeddings",
        {
          input: chunk,
          model: "text-embedding-3-small",
        },
        {
          headers: {
            Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
            "Content-Type": "application/json",
          },
        }
      );

      const [{ embedding }] = embeddingRes.data.data;

      const docRow = {
        accountant,
        client,
        filename,
        content: chunk,
        embedding,
        category: null,
        note: notes || null,
        upload_date: new Date().toISOString(),
      };

      const chunkRow = {
        accountant,
        client,
        filename,
        content: chunk,
        embedding,
        category: null,
        notes: notes || null,
        created_at: new Date().toISOString(),
      };

      const { error: testDocError } = await supabase.from("test_documents").insert([docRow]);
      if (testDocError) throw testDocError;

      const { error: userChunkError } = await supabase.from("user_chunks").insert([chunkRow]);
      if (userChunkError) throw userChunkError;
    }

    res.status(200).json({ message: "File uploaded and embedded!", key });
  } catch (err) {
    console.error("🔴 Upload or embedding failed:", err);
    res.status(500).json({ error: err.message });
  }
});

// === GET FILES === (unchanged)
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
          sortBy: { column: "name", order: "asc" },
        });

      if (listError) throw listError;

      for (const obj of files) {
        const fullPath = `${prefix}${obj.name}`;
        const { data: signedUrl, error: urlError } = await supabase.storage
          .from("deltax-uploads")
          .createSignedUrl(fullPath, 3600);

        if (urlError) throw urlError;

        allFiles.push({ name: obj.name, url: signedUrl.signedUrl, client: folder.name });
      }
    }

    res.status(200).json(allFiles);
  } catch (err) {
    console.error("🔴 Listing failed:", err);
    res.status(500).json({ error: err.message });
  }
});

// === CHAT + REPORT ROUTES ===
app.use("/api/chat", chatWithDocsRoute);
app.use("/api/report", generateReportRoute);

// === START SERVER ===
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));
