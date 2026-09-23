const { onRequest } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");

const ANTHROPIC_API_KEY = defineSecret("ANTHROPIC_API_KEY");

// Endpoint: POST { prompt: string } -> { text: string }
// Prompt WAJIB berisi angka hasil rumus (dikirim dari chat.html) — instruksi di dalam
// prompt melarang model mengarang angka baru, jadi narasi tetap terkunci ke data asli.
exports.askAI = onRequest({ secrets: [ANTHROPIC_API_KEY], cors: true }, async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  const { prompt } = req.body || {};
  if (!prompt || typeof prompt !== "string") return res.status(400).json({ error: "prompt kosong" });

  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY.value(),
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 400,
        messages: [{ role: "user", content: prompt }],
      }),
    });
    const data = await r.json();
    if (!r.ok) return res.status(502).json({ error: data.error?.message || "Anthropic API error" });
    const text = (data.content || []).map((c) => c.text || "").join("\n").trim();
    res.json({ text });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});
