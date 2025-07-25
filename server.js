import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { OpenAI } from "openai";

dotenv.config();

const app = express();
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

app.use(cors());
app.use(express.json());

app.post("/api/chat", async (req, res) => {
  const { messages } = req.body;

  try {
    const chatCompletion = await openai.chat.completions.create({
      model: "gpt-4o",
      messages,
    });

    const reply = chatCompletion.choices[0].message.content;
    res.json({ reply });
  } catch (err) {
    console.error(err);
    res.status(500).send("OpenAI Error");
  }
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`✅ Server listening on port ${PORT}`);
});
