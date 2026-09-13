Latest cloudflare rasp worker code

export default {
  async fetch(request, env) {
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders,
      });
    }

    if (!["GET", "POST"].includes(request.method)) {
      return new Response("Method not allowed", {
        status: 405,
        headers: corsHeaders,
      });
    }

    try {
      /*
       * =========================================================
       * GET
       * Return the current Autonomous Work Space ecosystem
       * =========================================================
       */

      if (request.method === "GET") {
        const BASE_ID = "appY6TPhOsmj3dIX8";
        const TABLE_NAME = "Table 1";

        const airtableUrl =
          `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(TABLE_NAME)}?maxRecords=100`;

        const response = await fetch(airtableUrl, {
          headers: {
            Authorization: `Bearer ${env.AIRTABLE_TOKEN}`,
            "Content-Type": "application/json",
          },
        });

        if (!response.ok) {
          return new Response(
            JSON.stringify({
              error: "Failed to fetch from Airtable",
            }),
            {
              status: response.status,
              headers: {
                ...corsHeaders,
                "Content-Type": "application/json",
              },
            }
          );
        }

        const data = await response.json();

        const items = data.records.map((record) => ({
          id: record.id,
          Name: record.fields.Name || "Untitled",
          Type: record.fields.Type || "Unknown",
          Description: record.fields.Description || "",
          URL: record.fields.URL || "",
          Category: record.fields.Category || "Uncategorized",
          created: record.createdTime,
        }));

        return new Response(JSON.stringify(items, null, 2), {
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json",
            "Cache-Control": "public, max-age=300",
          },
        });
      }

      /*
       * =========================================================
       * POST /build-stack
       * LLM-powered autonomous workspace architect
       * =========================================================
       */

      const url = new URL(request.url);

      if (url.pathname !== "/build-stack") {
        return new Response(
          JSON.stringify({
            error: "Unknown endpoint",
          }),
          {
            status: 404,
            headers: {
              ...corsHeaders,
              "Content-Type": "application/json",
            },
          }
        );
      }

      if (!env.OPENROUTER_KEY) {
        return new Response(
          JSON.stringify({
            error: "OPENROUTER_KEY is not configured on the Worker.",
          }),
          {
            status: 500,
            headers: {
              ...corsHeaders,
              "Content-Type": "application/json",
            },
          }
        );
      }

      let body;

      try {
        body = await request.json();
      } catch {
        return new Response(
          JSON.stringify({
            error: "Invalid JSON request.",
          }),
          {
            status: 400,
            headers: {
              ...corsHeaders,
              "Content-Type": "application/json",
            },
          }
        );
      }

      const goal = String(body.goal || "").trim();
      const ecosystem = Array.isArray(body.ecosystem)
        ? body.ecosystem
        : [];

      if (!goal) {
        return new Response(
          JSON.stringify({
            error: "A workspace goal is required.",
          }),
          {
            status: 400,
            headers: {
              ...corsHeaders,
              "Content-Type": "application/json",
            },
          }
        );
      }

      if (!ecosystem.length) {
        return new Response(
          JSON.stringify({
            error: "No ecosystem data was supplied.",
          }),
          {
            status: 400,
            headers: {
              ...corsHeaders,
              "Content-Type": "application/json",
            },
          }
        );
      }

      /*
       * Keep the prompt bounded.
       * The model reasons ONLY over capabilities that actually exist
       * in the current Autonomous Work Space directory.
       */

      const catalog = ecosystem
        .slice(0, 100)
        .map((item, index) => ({
          index,
          name: item.Name || "",
          type: item.Type || "",
          category: item.Category || "",
          description: item.Description || "",
          url: item.URL || "",
        }));

      const systemPrompt = `
You are the autonomous workspace architect for "Autonomous Work Space".

Your job is to transform a user's real-world automation goal into a practical autonomous workspace architecture.

IMPORTANT RULES:

1. Do NOT force every goal into a fixed seven-layer template.
2. Create only the layers that genuinely make sense for this particular goal.
3. The number of layers can vary.
4. Each layer must represent a meaningful capability or stage of work.
5. Select agents and tools ONLY from the supplied catalog.
6. Never invent an agent, tool, product, capability, URL, or name.
7. A component may be selected only when its description/category reasonably supports the required job.
8. If the catalog lacks a necessary capability, explicitly report a capability gap.
9. Explain WHY each layer exists.
10. Explain WHY every selected agent or tool was selected.
11. Reason from the user's actual goal, not from generic directory categories.
12. Prefer a small number of strong components over filling every layer with weak matches.
13. The architecture should describe what the workspace needs to accomplish, not merely list software.
14. Be honest when the current catalog cannot fully satisfy the goal.
15. Do not claim that a tool performs a capability that its supplied description does not support.

Return ONLY valid JSON matching the requested schema.
`;

      const userPrompt = `
USER WORKSPACE GOAL:

${goal}

CURRENT AUTONOMOUS WORK SPACE CATALOG:

${JSON.stringify(catalog, null, 2)}

Create the autonomous workspace architecture for this goal.

Return JSON using exactly this structure:

{
  "goal_summary": "short explanation of what the user is trying to build",
  "core_capabilities": [
    {
      "name": "capability name",
      "reason": "why this capability is required"
    }
  ],
  "layers": [
    {
      "number": 1,
      "name": "meaningful layer name",
      "purpose": "what this layer does",
      "why_needed": "why this layer is necessary for this particular goal",
      "agents": [
        {
          "name": "exact catalog name",
          "reason": "why this agent is appropriate"
        }
      ],
      "tools": [
        {
          "name": "exact catalog name",
          "reason": "why this tool is appropriate"
        }
      ]
    }
  ],
  "gaps": [
    {
      "capability": "missing capability",
      "reason": "why the current catalog cannot adequately provide it"
    }
  ],
  "architecture_summary": "short explanation of how the selected layers work together"
}

Do not include markdown.
Do not include commentary outside the JSON.
`;

      const openrouterResponse = await fetch(
        "https://openrouter.ai/api/v1/chat/completions",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${env.OPENROUTER_KEY}`,
            "Content-Type": "application/json",
            "HTTP-Referer": "https://autonomouswork.space",
            "X-Title": "Autonomous Work Space",
          },
          body: JSON.stringify({
            model: "openrouter/free",
            messages: [
              {
                role: "system",
                content: systemPrompt,
              },
              {
                role: "user",
                content: userPrompt,
              },
            ],
            temperature: 0.2,
            max_tokens: 5000,
          }),
        }
      );

      if (!openrouterResponse.ok) {
        const errorText = await openrouterResponse.text();

        return new Response(
          JSON.stringify({
            error: "OpenRouter request failed.",
            details: errorText.slice(0, 1000),
          }),
          {
            status: 502,
            headers: {
              ...corsHeaders,
              "Content-Type": "application/json",
            },
          }
        );
      }

      const llmData = await openrouterResponse.json();

      const content =
        llmData?.choices?.[0]?.message?.content || "";

      if (!content) {
        return new Response(
          JSON.stringify({
            error: "The reasoning model returned an empty response.",
          }),
          {
            status: 502,
            headers: {
              ...corsHeaders,
              "Content-Type": "application/json",
            },
          }
        );
      }

      /*
       * Attempt to extract JSON even if a free model accidentally
       * surrounds it with markdown fences.
       */

      let architecture;

      try {
        architecture = JSON.parse(content);
      } catch {
        const start = content.indexOf("{");
        const end = content.lastIndexOf("}");

        if (start === -1 || end === -1 || end <= start) {
          return new Response(
            JSON.stringify({
              error: "The reasoning model did not return valid JSON.",
              raw: content.slice(0, 2000),
            }),
            {
              status: 502,
              headers: {
                ...corsHeaders,
                "Content-Type": "application/json",
              },
            }
          );
        }

        try {
          architecture = JSON.parse(
            content.slice(start, end + 1)
          );
        } catch {
          return new Response(
            JSON.stringify({
              error: "Could not parse the reasoning model response.",
              raw: content.slice(0, 2000),
            }),
            {
              status: 502,
              headers: {
                ...corsHeaders,
                "Content-Type": "application/json",
              },
            }
          );
        }
      }

      return new Response(
        JSON.stringify({
          success: true,
          architecture,
        }),
        {
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json",
          },
        }
      );
    } catch (error) {
      return new Response(
        JSON.stringify({
          error: error.message || "Unexpected Worker error.",
        }),
        {
          status: 500,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json",
          },
        }
      );
    }
  },
};
