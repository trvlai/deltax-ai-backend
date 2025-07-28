// index.js
const express = require("express");
const cors = require("cors");
const axios = require("axios");
require("dotenv").config();
const multer = require("multer");
const path = require("path");
const fs = require("fs");

const app = express();
app.use(cors());
app.use(express.json());

// Ensure the "uploads" directory exists
if (!fs.existsSync("uploads")) {
  fs.mkdirSync("uploads");
}

// Multer configuration for storing uploaded files
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, "uploads/"),
  filename: (req, file, cb) => {
    const uniqueName = `${Date.now()}-${file.originalname}`;
    cb(null, uniqueName);
  },
});
const upload = multer({ storage });

/**
 * POST /api/upload
 * Handles a single file upload per request (field name: "file"),
 * saves the file in uploads/{accountant}/, and writes metadata to files.json
 */
app.post("/api/upload", upload.single("file"), (req, res) => {
  try {
    const { type, accountant, client, notes } = req.body;
    const file = req.file;

    // Validate presence of file and required fields
    if (!file) {
      return res.status(400).json({ error: "No file uploaded." });
    }
    if (!accountant || !client) {
      return res.status(400).json({ error: "Missing accountant or client name." });
    }

    // Create accountant-specific folder if needed
    const acctDir = path.join("uploads", accountant);
    if (!fs.existsSync(acctDir)) {
      fs.mkdirSync(acctDir, { recursive: true });
    }

    // Read existing metadata
    const metaFile = path.join(acctDir, "files.json");
    let existing = [];
    if (fs.existsSync(metaFile)) {
      try {
        existing = JSON.parse(fs.readFileSync(metaFile, "utf8"));
      } catch (err) {
        console.warn("Warning: could not parse existing metadata.", err);
      }
    }

    // Build metadata entry for this file
    const entry = {
      client,
      fileName: file.filename,
      originalName: file.originalname,
      type: type || "",
      notes: notes || "",
      uploadDate: new Date().toISOString(),
      aiNote: "",
      isReviewed: false,
    };

    // Append and save
    existing.push(entry);
    fs.writeFileSync(metaFile, JSON.stringify(existing, null, 2), "utf8");

    console.log("✅ Uploaded and saved metadata:", entry);
    return res.status(200).json({ message: "File uploaded", metadata: entry });
  } catch (err) {
    console.error("🔴 Upload handler error:", err);
    return res.status(500).json({
      error: err.message,
      stack: err.stack?.split("\n"),
    });
  }
});

/**
 * GET /api/files/:accountant
 * Returns all metadata entries for the given accountant
 */
app.get("/api/files/:accountant", (req, res) => {
  const acct = req.params.accountant;
  const metaFile = path.join("uploads", acct, "files.json");

  if (!fs.existsSync(metaFile)) {
    return res.json([]);
  }

  try {
    const files = JSON.parse(fs.readFileSync(metaFile, "utf8"));
    return res.json(files);
  } catch (err) {
    console.error("🔴 Error reading metadata:", err);
    return res.status(500).json({ error: "Failed to load files." });
  }
});

/**
 * POST /api/chat
 * Proxies messages to OpenAI for an accounting assistant
 */
app.post("/api/chat", async (req, res) => {
  const userMessage = req.body.message;
  try {
    const response = await axios.post(
      "https://api.openai.com/v1/chat/completions",
      {
        model: "gpt-4.1-mini",
        messages: [
          { role: "system", content: "You are a helpful and concise accounting assistant called Moouris." },
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
    return res.json({ reply: response.data.choices[0].message.content });
  } catch (err) {
    console.error("🔴 OpenAI API Error:", err.response?.data || err.message);
    return res.status(500).json({ error: "OpenAI Error", details: err.response?.data || err.message });
  }
});

// Start the server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));
