// server.js

// 1️⃣ Import dependencies
import express from "express";                           // Fast, unopinionated web framework
import cors from "cors";                                 // Enable Cross‑Origin Resource Sharing
import multer from "multer";                             // Handle multipart/form‑data (file uploads)
import { createClient } from "@supabase/supabase-js";    // Supabase JS client for Storage & DB
import dotenv from "dotenv";                             // Load ENV vars from .env
import axios from "axios";                               // HTTP client for OpenAI proxy

// 2️⃣ Load environment variables from a .env file (or Render’s ENV)
dotenv.config();

// 3️⃣ Initialize Express app
const app = express();

// 4️⃣ Middleware
app.use(cors());                // Allow requests from any origin (adjust in production)
app.use(express.json());        // Parse JSON bodies on incoming requests

// 5️⃣ Configure Multer to use in-memory storage for uploaded files
//    We NEVER write to disk, so uploads aren’t lost on Render restarts
const upload = multer({ storage: multer.memoryStorage() });

// 6️⃣ Initialize Supabase client (server‑side only)
//    Uses your service_role key so you can upload & list private files
const supabase = createClient(
  process.env.SUPABASE_URL,               // e.g. https://abc123.supabase.co
  process.env.SUPABASE_SERVICE_ROLE_KEY   // secret key—never expose in frontend
);

/**
 * POST /api/upload
 * - Expects a single file under field name "file"
 * - Expects body fields: accountant, client, type, notes
 * - Uploads the file buffer into Supabase Storage under:
 *     bucket: "deltax-uploads"
 *     key:     "{accountant}/{client}/{timestamp}-{originalname}"
 * - Returns JSON { message, key }
 */
app.post("/api/upload", upload.single("file"), async (req, res) => {
  try {
    const { accountant, client, type, notes } = req.body;
    const file = req.file;

    // 6.1 Validate required fields
    if (!file || !accountant || !client) {
      return res
        .status(400)
        .json({ error: "Missing file, accountant, or client." });
    }

    // 6.2 Build a unique storage key to avoid name collisions
    const timestamp = Date.now();
    const key = `${accountant}/${client}/${timestamp}-${file.originalname}`;

    // 6.3 Upload to Supabase Storage
    const { error: uploadError } = await supabase.storage
      .from("deltax-uploads")
      .upload(key, file.buffer, { contentType: file.mimetype });

    if (uploadError) throw uploadError;

    // 6.4 (Optional) Here you could INSERT metadata into a Postgres table

    // 6.5 Respond with success and the storage key
    return res.status(200).json({ message: "File uploaded", key });
  } catch (err) {
    console.error("🔴 Upload failed:", err);
    return res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/files/:accountant
 * Query params: ?client=<clientName>
 * - Lists up to 100 files under that accountant/client prefix
 * - Generates 1‑hour signed URLs for each object
 * - Returns JSON array: [{ name, url }, …]
 */
app.get("/api/files/:accountant", async (req, res) => {
  try {
    const accountant = req.params.accountant;         // from /:accountant
    const client = req.query.client as string;        // from ?client=

    // 7.1 Validate query param
    if (!client) {
      return res
        .status(400)
        .json({ error: "Missing client query parameter." });
    }

    // 7.2 Define the folder prefix in your bucket
    const prefix = `${accountant}/${client}/`;

    // 7.3 List objects under that prefix
    const { data, error: listError } = await supabase.storage
      .from("deltax-uploads")
      .list(prefix, {
        limit: 100,
        offset: 0,
        sortBy: { column: "name", order: "asc" },
      });
    if (listError) throw listError;

    // 7.4 For each object, generate a signed URL using the full path
    const files = await Promise.all(
      data.map(async (obj) => {
        const fullPath = `${prefix}${obj.name}`;    // e.g. "Acct/Client/12345-file.pdf"
        const { signedURL, error: urlError } =
          await supabase.storage
            .from("deltax-uploads")
            .createSignedUrl(fullPath, 60 * 60);      // 1‑hour expiry
        if (urlError) throw urlError;
        return { name: obj.name, url: signedURL };
      })
    );

    // 7.5 Return the array of file info
    return res.status(200).json(files);
  } catch (err) {
    console.error("🔴 Listing failed:", err);
    return res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/chat
 * - Proxies a user message to OpenAI’s chat API
 * - Expects JSON { message }
 * - Returns JSON { reply }
 */
app.post("/api/chat", async (req, res) => {
  try {
    const userMessage = req.body.message;
    const response = await axios.post(
      "https://api.openai.com/v1/chat/completions",
      {
        model: "gpt-4.1-mini",
        messages: [
          {
            role: "system",
            content:
              "You are a helpful accounting assistant integrated into Deltax.",
          },
          { role: "user", content: userMessage },
        ],
        temperature: 0.7,
      },
      {
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        },
      }
    );

    // Extract and return the AI’s reply
    const reply = response.data.choices[0].message.content;
    return res.status(200).json({ reply });
  } catch (err) {
    console.error("🔴 OpenAI API Error:", err.response?.data || err.message);
    return res
      .status(500)
      .json({ error: "OpenAI Error", details: err.response?.data || err.message });
  }
});

// 8️⃣ Start the server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () =>
  console.log(`✅ Server running on port ${PORT}`)
);
