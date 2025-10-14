// Vercel/Netlify function: api/ghost.js
export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).send("POST only");
  try {
    const { prompt } = req.body || {};
    const system = "You are Ezekiel the Hayfield Ghost. Be spooky, witty, brief.";
    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: system },
          { role: "user", content: prompt || "" }
        ],
        temperature: 0.9,
        max_tokens: 120
      })
    });
    if (!r.ok) return res.status(502).send("Upstream error");
    const data = await r.json();
    const reply = data.choices?.[0]?.message?.content?.trim() || "…(eerie silence)…";
    res.status(200).json({ reply });
  } catch (e) {
    res.status(500).json({ reply: "The ether crackles… try again." });
  }
}
