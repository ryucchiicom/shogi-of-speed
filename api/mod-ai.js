// Node / serverless の例。
// OpenAI APIキーはここにだけ置く。ブラウザには置かない。
// 返答は Structured Outputs で JSON を固定する。

import OpenAI from "openai";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      res.status(405).json({ error: "Method Not Allowed" });
      return;
    }

    const { mode, modName, prompt, current } = req.body || {};

    const schema = {
      type: "object",
      additionalProperties: false,
      properties: {
        summary: { type: "string" },
        mod: {
          type: "object",
          additionalProperties: true,
          properties: {
            theme: {
              type: "object",
              additionalProperties: false,
              properties: {
                boardDark: { type: "string" },
                boardLight: { type: "string" },
                piece1: { type: "string" },
                piece2: { type: "string" }
              }
            },
            royalLabels: {
              type: "object",
              additionalProperties: false,
              properties: {
                black: { type: "string" },
                white: { type: "string" }
              }
            }
          }
        }
      },
      required: ["summary", "mod"]
    };

    const input = [
      {
        role: "system",
        content:
          "You create compact JSON mods for a shogi web game. Return only valid JSON that matches the schema. Keep it practical."
      },
      {
        role: "user",
        content: JSON.stringify({
          mode,
          modName,
          prompt,
          current
        })
      }
    ];

    const response = await client.responses.create({
      model: "gpt-5.4",
      input,
      text: {
        format: {
          type: "json_schema",
          name: "mod_output",
          schema,
          strict: true
        }
      }
    });

    const text = response.output_text || "{}";
    res.status(200).json(JSON.parse(text));
  } catch (error) {
    res.status(500).json({ error: error?.message || "Unknown error" });
  }
}
