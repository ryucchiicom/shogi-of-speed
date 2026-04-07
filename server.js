// server.js
import express from "express";
import cors from "cors";

const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));

const PORT = process.env.PORT || 3000;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4.1-mini";

if (!OPENAI_API_KEY) {
  console.warn("OPENAI_API_KEY is not set.");
}

const MOD_SCHEMA = {
  name: "mod_spec",
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      name: { type: "string" },
      summary: { type: "string" },
      versions: {
        type: "array",
        minItems: 1,
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            version: { type: "integer", minimum: 1 },
            summary: { type: "string" },
            patch: {
              type: "object",
              additionalProperties: false,
              properties: {
                boardTint: {
                  type: "object",
                  additionalProperties: false,
                  properties: {
                    light: { type: "string" },
                    dark: { type: "string" }
                  },
                  required: ["light", "dark"]
                },
                cooldownMs: { type: "integer", minimum: 0 },
                pieceLabels: {
                  type: "object",
                  additionalProperties: { type: "string" }
                },
                extraMoves: {
                  type: "object",
                  additionalProperties: {
                    type: "array",
                    items: {
                      type: "object",
                      additionalProperties: false,
                      properties: {
                        dx: { type: "integer" },
                        dy: { type: "integer" },
                        repeat: { type: "boolean" }
                      },
                      required: ["dx", "dy", "repeat"]
                    }
                  }
                },
                handCooldownMs: { type: "integer", minimum: 0 },
                cpuBias: {
                  type: "object",
                  additionalProperties: {
                    type: "number"
                  }
                },
                notes: { type: "string" }
              },
              required: ["notes"]
            }
          },
          required: ["version", "summary", "patch"]
        }
      }
    },
    required: ["name", "summary", "versions"]
  }
};

app.post("/api/generate-mod", async (req, res) => {
  try {
    const { mode, modName, prompt, existingMod } = req.body || {};
    if (!OPENAI_API_KEY) {
      return res.status(500).json({ error: "OPENAI_API_KEY is not set." });
    }

    const system = [
      "You are a mod designer for a shogi-like browser game.",
      "Return ONLY valid JSON matching the schema.",
      "Keep the mod practical for a browser game.",
      "Avoid unsafe or external dependencies.",
      "Use version numbers starting at 1.",
      "When editing an existing mod, preserve useful parts and increment version.",
      "Prefer patches that can be interpreted by a simple game engine."
    ].join(" ");

    const user = JSON.stringify({
      mode,
      modName,
      prompt,
      existingMod
    });

    const body = {
      model: OPENAI_MODEL,
      input: [
        { role: "system", content: [{ type: "text", text: system }] },
        { role: "user", content: [{ type: "text", text: user }] }
      ],
      text: {
        format: {
          type: "json_schema",
          name: MOD_SCHEMA.name,
          schema: MOD_SCHEMA.schema,
          strict: true
        }
      }
    };

    const r = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${OPENAI_API_KEY}`
      },
      body: JSON.stringify(body)
    });

    const data = await r.json();
    if (!r.ok) {
      return res.status(r.status).json({
        error: "OpenAI request failed",
        details: data
      });
    }

    const text =
      data.output_text ||
      data.output?.[0]?.content?.[0]?.text ||
      "";

    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      return res.status(500).json({
        error: "Model did not return valid JSON",
        raw: text
      });
    }

    return res.json(parsed);
  } catch (err) {
    return res.status(500).json({ error: err.message || String(err) });
  }
});

app.listen(PORT, () => {
  console.log(`MOD generator proxy running on http://localhost:${PORT}`);
});
