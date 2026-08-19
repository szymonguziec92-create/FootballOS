export default async (req) => {
  if (req.method !== "POST") {
    return new Response(
      JSON.stringify({ error: "Method not allowed" }),
      {
        status: 405,
        headers: { "Content-Type": "application/json" },
      }
    );
  }

  try {
    const body = await req.json();

    const {
      system = "",
      messages = [],
      maxTokens = 1000,
    } = body;

    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) {
      return new Response(
        JSON.stringify({
          error: "Brak GEMINI_API_KEY w Netlify",
        }),
        {
          status: 500,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    const contents = messages
      .map((m) => {
        const parts = [];

        if (typeof m.content === "string") {
          parts.push({ text: m.content });
        }

        if (Array.isArray(m.content)) {
          for (const item of m.content) {
            if (item.type === "text") {
              parts.push({
                text: item.text || "",
              });
            }

            if (item.type === "image" && item.source?.data) {
              parts.push({
                inlineData: {
                  mimeType:
                    item.source.media_type || "image/jpeg",
                  data: item.source.data,
                },
              });
            }
          }
        }

        return {
          role: m.role === "assistant" ? "model" : "user",
          parts,
        };
      })
      .filter((m) => m.parts.length > 0);

    const response = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": apiKey,
        },
        body: JSON.stringify({
          systemInstruction: {
            parts: [{ text: system }],
          },
          contents,
          generationConfig: {
            maxOutputTokens: maxTokens,
            temperature: 0.7,
          },
        }),
      }
    );

    const data = await response.json();

    if (!response.ok) {
      console.error("Gemini error:", data);

      return new Response(
        JSON.stringify({
          error:
            data?.error?.message ||
            "Błąd Gemini",
        }),
        {
          status: response.status,
          headers: {
            "Content-Type": "application/json",
          },
        }
      );
    }

    const text =
      data?.candidates?.[0]?.content?.parts
        ?.map((p) => p.text || "")
        .join("") || "";

    return new Response(
      JSON.stringify({ text }),
      {
        status: 200,
        headers: {
          "Content-Type": "application/json",
        },
      }
    );
  } catch (error) {
    console.error("AI error:", error);

    return new Response(
      JSON.stringify({
        error:
          error?.message ||
          "Nie udało się połączyć z AI.",
      }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }
    );
  }
};

export const config = {
  path: "/api/ai",
};
