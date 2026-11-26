// Live Reply Assistant - server
// Listens (in the browser), sends what the other person said here, and streams
// back a plain-language reply for you to say, using your uploaded documents.

import express from "express";
import multer from "multer";
import mammoth from "mammoth";
import pdfParse from "pdf-parse/lib/pdf-parse.js";
import Anthropic from "@anthropic-ai/sdk";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const here = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(here, "data");
const KB_FILE = path.join(DATA_DIR, "knowledge.json");
const PORT = process.env.PORT || 3000;
const MODEL = process.env.CLAUDE_MODEL || "claude-opus-5-5";
const APP_PASSWORD = process.env.APP_PASSWORD || "";

const client = new Anthropic(); // reads ANTHROPIC_API_KEY from the environment
const app = express();
app.use(express.json({ limit: "2mb" }));

// ---- Optional password protection (recommended when hosted publicly) ----
if (APP_PASSWORD) {
  app.use((req, res, next) => {
    const header = req.headers.authorization || "";
    const [scheme, encoded] = header.split(" ");
    if (scheme === "Basic" && encoded) {
      const pass = Buffer.from(encoded, "base64").toString().split(":").slice(1).join(":");
      if (pass === APP_PASSWORD) return next();
    }
    res.set("WWW-Authenticate", 'Basic realm="Live Reply Assistant"');
    res.status(401).send("Password required");
  });
}

app.use(express.static(path.join(here, "public")));

// ---- Knowledge base (documents + background), saved to disk ----
fs.mkdirSync(DATA_DIR, { recursive: true });
let kb = { background: "", documents: [] }; // documents: [{id, name, text, chars}]
try {
  kb = JSON.parse(fs.readFileSync(KB_FILE, "utf8"));
} catch {
  /* first run */
}
const saveKb = () => fs.writeFileSync(KB_FILE, JSON.stringify(kb));

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

async function extractText(file) {
  const name = file.originalname.toLowerCase();
  if (name.endsWith(".pdf")) return (await pdfParse(file.buffer)).text;
  if (name.endsWith(".docx")) return (await mammoth.extractRawText({ buffer: file.buffer })).value;
  // .txt, .md, .csv, .json, etc.
  return file.buffer.toString("utf8");
}

app.get("/api/knowledge", (_req, res) => {
  res.json({
    background: kb.background,
    documents: kb.documents.map(({ id, name, chars }) => ({ id, name, chars })),
  });
});

app.post("/api/upload", upload.array("files", 20), async (req, res) => {
  const added = [];
  const failed = [];
  for (const file of req.files || []) {
    try {
      const text = (await extractText(file)).trim();
      if (!text) throw new Error("No readable text found (scanned image PDFs are not supported)");
      const doc = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), name: file.originalname, text, chars: text.length };
      kb.documents.push(doc);
      added.push({ id: doc.id, name: doc.name, chars: doc.chars });
    } catch (err) {
      failed.push({ name: file.originalname, error: err.message });
    }
  }
  saveKb();
  res.json({ added, failed });
});

app.delete("/api/documents/:id", (req, res) => {
  kb.documents = kb.documents.filter((d) => d.id !== req.params.id);
  saveKb();
  res.json({ ok: true });
});

app.post("/api/background", (req, res) => {
  kb.background = String(req.body.background || "");
  saveKb();
  res.json({ ok: true });
});

// ---- The prompt ----
function buildSystemPrompt() {
  const docs = kb.documents
    .map((d) => `<document name="${d.name.replace(/"/g, "'")}">\n${d.text}\n</document>`)
    .join("\n\n");

  return `You are a quiet helper sitting next to the user during a live, spoken conversation with another person. You hear what the other person says (through a speech-to-text transcript that may contain recognition mistakes, and may be in a language the user does not understand). Your job is to tell the user, in plain words, what was said and exactly what to say back.

How to reply:
- First, give a short, faithful English translation/clean-up of what the other person just said.
- Then give the reply the user should say out loud. Write it as natural spoken words in first person, like an ordinary person talking: short sentences, no jargon, no lists unless the person asked for several items.
- Never mention documents, files, a knowledge base, sources, or "according to". The user is speaking as themselves and simply knows these facts.
- Use the facts, numbers, prices, dates and names from the background and documents below whenever they answer the question. Get numbers exactly right.
- If the documents do not contain the answer, do not invent facts. Suggest a natural, honest reply instead (for example, saying you will check and get back to them), and add a one-line private hint for the user.
- If the transcript is unclear or just small talk, give a short natural reply anyway.
- Keep the spoken reply brief: usually 1-3 sentences.

Output format - use exactly these markers, each on its own line, and nothing else:
### THEY SAID
<English meaning of what the other person said>
### YOU SAY
<the reply the user should speak, in the language requested in the latest message>
### IN THEIR LANGUAGE
<only if requested in the latest message: the same reply translated into the other person's language; otherwise leave empty>
### NOTE
<optional one-line private hint for the user, or leave empty>

<background_from_user>
${kb.background || "(none provided)"}
</background_from_user>

<documents>
${docs || "(no documents uploaded)"}
</documents>`;
}

// ---- Respond endpoint: streams plain text back to the browser ----
app.post("/api/respond", async (req, res) => {
  const { utterance, history = [], replyLanguage = "English", theirLanguage = "", showInTheirLanguage = false } = req.body || {};
  if (!utterance || !String(utterance).trim()) return res.status(400).json({ error: "Nothing was heard" });
  if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) {
    return res.status(500).type("text/plain").send("### NOTE\nThe server has no ANTHROPIC_API_KEY set. Add it and restart the server.");
  }

  // Keep the cached system prompt byte-stable: per-request settings go in the user turn.
  const system = buildSystemPrompt();

  // Short rolling history so the replies stay consistent with the conversation.
  const messages = [];
  for (const turn of history.slice(-10)) {
    if (!turn?.heard || !turn?.reply) continue;
    messages.push({ role: "user", content: `The other person said: "${turn.heard}"` });
    messages.push({ role: "assistant", content: turn.reply });
  }
  const settings = [
    `Write the YOU SAY reply in: ${replyLanguage}.`,
    theirLanguage ? `The other person is speaking: ${theirLanguage}.` : "",
    showInTheirLanguage ? "Also fill the IN THEIR LANGUAGE section." : "Leave IN THEIR LANGUAGE empty.",
  ]
    .filter(Boolean)
    .join(" ");
  messages.push({ role: "user", content: `${settings}\n\nThe other person said: "${String(utterance).trim()}"` });

  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("X-Accel-Buffering", "no");

  const controller = new AbortController();
  res.on("close", () => {
    if (!res.writableFinished) controller.abort(); // user pressed Stop / closed tab
  });

  try {
    const stream = client.beta.messages.stream(
      {
        model: MODEL,
        max_tokens: 4000,
        output_config: { effort: "low" }, // live conversation: speed matters most
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
        messages,
      },
      { signal: controller.signal }
    );

    for await (const event of stream) {
      if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
        res.write(event.delta.text);
      }
    }
    const final = await stream.finalMessage();
    if (final.stop_reason === "refusal") {
      res.write("\n### NOTE\nThe assistant could not answer this one. Reply in your own words.");
    }
    res.end();
  } catch (err) {
    if (controller.signal.aborted) return;
    console.error(err);
    let msg = "Something went wrong talking to Claude.";
    if (err instanceof Anthropic.AuthenticationError) msg = "The ANTHROPIC_API_KEY on the server is missing or invalid.";
    else if (err instanceof Anthropic.RateLimitError) msg = "Too many requests right now. Wait a moment and try again.";
    else if (err instanceof Anthropic.APIConnectionError) msg = "The server could not reach Claude. Check its internet connection.";
    else if (err instanceof Anthropic.APIError) msg = `Claude API error: ${err.message}`;
    if (!res.headersSent) res.status(500);
    res.end(`\n### NOTE\n${msg}`);
  }
});

app.listen(PORT, () => {
  console.log(`Live Reply Assistant running at http://localhost:${PORT}`);
  if (!process.env.ANTHROPIC_API_KEY) console.warn("Warning: ANTHROPIC_API_KEY is not set.");
  if (!APP_PASSWORD) console.warn("Tip: set APP_PASSWORD before hosting this publicly.");
});
