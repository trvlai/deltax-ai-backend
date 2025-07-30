import express from "express";
import cors from "cors";
import multer from "multer";
import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import axios from "axios";
import generateReportRoute from "./routes/generateReport.js";
import chatWithDocsRoute from "./routes/chatWithDocs.js";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import * as Tesseract from "tesseract.js";
import { fromPath } from "pdf2pic";
import fs from "fs";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const upload = multer({ storage: multer.memoryStorage() });

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
      return res.status(400).json({ error: "Missing file, accountant, or client." });
    }

    const filename = `${Date.now()}-${file.originalname}`;
    const key = `${accountant}/${client}/${filename}`;

    // Upload to Supabase Storage
    const { error: uploadError } = await supabase.storage
      .from("deltax-uploads")
      .upload(key, file.buffer, { contentType: file.mimetype });

    if (uploadError) throw uploadError;

    let fullText = "";

    console.log("🟡 Uploading:", {
      name: file.originalname,
      size: file.size,
      type: file.mimetype,
    });

    if (file.mimetype === "application/pdf") {
      try {
        // ✅ Extract directly from buffer using pdfjs-dist
        const uint8array = new Uint8Array(file.buffer);
        const doc = await getDocument({ data: uint8array }).promise;
        let extractedText = "";

        for (let i = 1; i <= doc.numPages; i++) {
          const page = await doc.getPage(i);
          const content = await page.getTextContent();
          const pageText = content.items.map((item) => item.str).join(" ");
          extractedText += pageText + "\n\n";
        }

        fullText = extractedText.trim();

        // 🟡 Fallback to OCR if no text found
        if (!fullText || fullText.length < 10) {
          console.warn("⚠️ No selectable text found. Running OCR fallback.");

          const tmpPath = `./tmp-${Date.now()}.pdf`;
          fs.writeFileSync(tmpPath, file.buffer); // Write PDF for image conversion

          const convert = fromPath(tmpPath, {
            density: 150,
            saveFilename: "ocr-page",
            savePath: "./",
            format: "png",
            width: 1200,
            height: 1600,
          });

          const ocrTextArray = [];

          for (let i = 1; i <= doc.numPages; i++) {
            const imgPath = await convert(i);
            const {
              data: { text },
            } = await Tesseract.recognize(imgPath.path, "eng");
            ocrTextArray.push(text);
            fs.unlinkSync(imgPath.path); // Cleanup image
          }

          fs.unlinkSync(tmpPath); // Cleanup temp PDF
          fullText = ocrTextArray.join("\n\n").trim();
        }
      } catch (err) {
        console.error("🔴 PDF parsing or OCR failed:", err.message);
        return res.status(400).json({ error: "Failed to extract text from PDF." });
      }
    } else {
      fullText = "[Image uploaded — no text extracted]";
    }

    // === Chunk and Embed ===
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
        notes: notes || null,
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
        } = await supabase.storage.from("deltax-uploads").createSignedUrl(fullPath, 60 * 60);

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

app.use("/api/report", generateReportRoute);
app.use("/api/chat-with-docs", chatWithDocsRoute);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));
