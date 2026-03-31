export default async function handler(req, res) {
    if (req.method !== "POST") {
        res.setHeader("Allow", "POST");
        return res.status(405).json({ error: "Method not allowed" });
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
        return res.status(500).json({ error: "GEMINI_API_KEY is not configured on the server." });
    }

    const { words } = req.body;
    if (!words || typeof words !== "string" || words.trim().length === 0) {
        return res.status(400).json({ error: "Missing or invalid 'words' field." });
    }

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${encodeURIComponent(apiKey)}`;

    try {
        const response = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                contents: [{
                    parts: [{
                        text: `You are a sign language translator. Convert the following sequence of signed words into a natural, grammatically correct English sentence. Only output the final sentence, nothing else. Words: ${words}`
                    }]
                }],
                generationConfig: {
                    maxOutputTokens: 256,
                    temperature: 0.6,
                    thinkingConfig: { thinkingBudget: 0 },
                },
            }),
        });

        const data = await response.json();

        if (!response.ok) {
            return res.status(response.status).json({
                error: data?.error?.message || `Gemini API returned ${response.status}`,
            });
        }

        const text = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
        return res.status(200).json({ sentence: text || "" });
    } catch (e) {
        return res.status(502).json({ error: "Failed to reach Gemini API." });
    }
}
