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

// ✅ Ensure "uploads" folder exists
if (!fs.existsSync("uploads")) {
  fs.mkdirSync("uploads");
}

// ✅ Multer setup for saving to /uploads/
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, "uploads/");
  },
  filename: (req, file, cb) => {
    const uniqueName = `${Date.now()}-${file.originalname}`;
    cb(null, uniqueName);
  },
});
const upload = multer({ storage });

/**
 * ✅ POST /api/upload
 * Handles multiple file uploads and saves metadata into accountant folder
 */
app.post("/api/upload", upload.array("files"), (req, res) => {
  const { type, accountant, client, notes } = req.body;
  const files = req.files;

  if (!files || files.length === 0) {
    return res.status(400).json({ error: "No files uploaded." });
  }

  if (!accountant || !client) {
    return res.status(400).json({ error: "Missing accountant or client name." });
  }

  const accountantFolder = path.join("uploads", accountant);
  if (!fs.existsSync(accountantFolder)) {
    fs.mkdirSync(accountantFolder, { recursive: true });
  }

  const filePath = path.join(accountantFolder, "files.json");
  let existing = [];
  if (fs.existsSync(filePath)) {
    try {
      const data = fs.readFileSync(filePath);
      existing = JSON.parse(data);
    } catch (err) {
      console.error("❌ Error reading metadata:", err);
    }
  }

  const newEntries = files.map((file) => ({
    client,
    fileName: file.filename,
    originalName: file.originalname,
    type: type || "",
    notes: notes || "",
    uploadDate: new Date().toISOString(),
    aiNote: "",
    isReviewed: false,
  }));

  existing.push(...newEntries);

  try {
    fs.writeFileSync(filePath, JSON.stringify(existing, null, 2));
    console.log("✅ Files uploaded + metadata saved:", newEntries);
    res.status(200).json({ message: "Files uploaded", metadata: newEntries });
  } catch (err) {
    console.error("❌ Error writing metadata:", err);
    res.status(500).json({ error: "Failed to save metadata." });
  }
});

/**
 * ✅ GET /api/files/:accountant
 * Returns list of uploaded files for a specific accountant
 */
app.get("/api/files/:accountant", (req, res) => {
  const accountant = req.params.accountant;
  const filePath = path.join("uploads", accountant, "files.json");

  if (!fs.existsSync(filePath)) return res.json([]);

  try {
    const data = fs.readFileSync(filePath);
    const files = JSON.parse(data);
    res.json(files);
  } catch (error) {
    console.error("❌ Error loading file list:", error);
    res.status(500).json({ error: "Failed to load files." });
  }
});

/**
 * ✅ POST /api/chat
 * Simple AI assistant using OpenAI API
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

    res.json({ reply: response.data.choices[0].message.content });
  } catch (error) {
    console.error("🔴 OpenAI API Error:", error.response?.data || error.message);
    res.status(500).json({ error: "OpenAI Error", details: error.response?.data || error.message });
  }
});

// ✅ Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Server is running on port ${PORT}`);
});
