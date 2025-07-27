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

// ✅ Create "uploads" folder if it doesn't exist
if (!fs.existsSync("uploads")) {
  fs.mkdirSync("uploads");
}

// ✅ Multer setup
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

// ✅ File upload endpoint
app.post("/api/upload", upload.single("file"), (req, res) => {
  const { type, accountant, client, notes } = req.body;
  const file = req.file;

  if (!file) {
    return res.status(400).json({ error: "No file uploaded." });
  }

  const metadata = {
    filename: file.filename,
    originalName: file.originalname,
    path: file.path,
    type,
    accountant,
    client,
    notes,
    uploadedAt: new Date().toISOString(),
  };

  console.log("📥 Received upload:", metadata);
  return res.status(200).json({ message: "File uploaded", metadata });
});

// ✅ AI chat endpoint (existing)
app.post("/api/chat", async (req, res) => {
  const userMessage = req.body.message;

  try {
    const response = await axios.post(
      "https://api.openai.com/v1/chat/completions",
      {
        model: "gpt-4.1-mini",
        messages: [
          {
            role: "system",
            content: "You are a helpful and concise accounting assistant called Moouris.",
          },
          {
            role: "user",
            content: userMessage,
          },
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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Server is running on port ${PORT}`);
});
