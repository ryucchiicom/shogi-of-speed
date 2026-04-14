export default {
  async fetch(request, env) {
    const body = await request.json();

    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${env.OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: env.OPENAI_MODEL || "gpt-4.1-mini",
        input: [
          {
            role: "system",
            content: [
              {
                type: "input_text",
                text:
`You generate a compact JSON object for a Shogi mod editor.

Return ONLY JSON with this schema:
{
  "summary": string,
  "prompt": string,
  "patch": {
    "theme": { "boardLight"?: string, "boardDark"?: string, "piece1"?: string, "piece2"?: string },
    "game": { "cooldownMs"?: number, "handCooldownMs"?: number, "cpuDelayMin"?: number, "cpuDelayMax"?: number, "seriousCpuInterval"?: number },
    "labels": { "kingBlack"?: string, "kingWhite"?: string },
    "rules": object,
    "ui": object
  }
}

Keep patches conservative and game-safe.
`
              }
            ]
          },
          {
            role: "user",
            content: [
              {
                type: "input_text",
                text: JSON.stringify(body)
              }
            ]
          }
        ]
      })
    });

    const data = await response.json();
    const text = data.output_text || "";

    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = {
        summary: "AI出力の解釈に失敗したので、ローカル生成に寄せたよ。",
        prompt: body?.request || "",
        patch: {}
      };
    }

    return new Response(JSON.stringify(parsed), {
      headers: { "Content-Type": "application/json; charset=utf-8" }
    });
  }
};
