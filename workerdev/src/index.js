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
       * ============================================================
       * GET — LOAD AUTONOMOUS WORK SPACE ECOSYSTEM
       * ============================================================
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
       * ============================================================
       * POST /build-stack
       * ============================================================
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

      /*
       * ============================================================
       * READ REQUEST
       * ============================================================
       */

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
       * ============================================================
       * PREPARE CATALOG
       * ============================================================
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

      /*
       * ============================================================
       * SYSTEM PROMPT
       * ============================================================
       */

      const systemPrompt = `
You are the autonomous workspace architect for "Autonomous Work Space".

Your job is to transform a user's real-world automation goal into a practical autonomous workspace architecture.

IMPORTANT RULES:

1. Do NOT force every goal into a fixed seven-layer template.
2. Create only the layers that genuinely make sense for this particular goal.
3. The number of layers must vary according to the actual work required.
4. Each layer must represent a meaningful capability or stage of work.
5. Select agents and tools ONLY from the supplied catalog.
6. Never invent an agent, tool, product, capability, URL, or catalog name.
7. A component may be selected only when its supplied description/category reasonably supports the required job.
8. If the catalog lacks a necessary capability, explicitly report a capability gap.
9. Explain WHY each layer exists for this particular goal.
10. Explain WHY every selected agent or tool was selected. These explanations must be specific to the user's goal and must not be generic descriptions.
11. Reason from the user's actual goal, not from generic directory categories.
12. Prefer a small number of strong components over filling layers with weak matches.
13. The architecture should describe what the workspace needs to accomplish, not merely list software.
14. Be honest when the current catalog cannot fully satisfy the goal.
15. Do not claim that a component performs capabilities unsupported by its supplied description.
16. Critically review the architecture before finalizing it.
17. Identify strengths, weaknesses, risks, unnecessary components, missing capabilities, and practical improvements.
18. The Self-Review must be specific to the architecture that you actually generated.
19. Architecture Logic must be detailed and long. Explain the reasoning behind the architecture, layer structure, component selection, relationships between layers, dependencies, gaps, limitations, and how the selected components work together.
20. Do NOT shorten Architecture Logic merely to make the response concise.
21. If stronger or external capability options would materially improve the workspace, report them separately as recommendations.
22. External recommendations must NOT be presented as components from the current catalog.
23. Do not claim external recommendations have been added to Airtable.
24. The final architecture must be coherent as a complete workspace, not merely a collection of individually relevant components.
25. Think about the complete work system from beginning to end before selecting the components.
26. Do not add a component merely because its category sounds relevant.
27. Distinguish between a true capability gap and a capability that can reasonably be handled by an existing selected component.
28. If the current ecosystem is sufficient, do not invent gaps simply to produce recommendations.
29. If the architecture has weaknesses even though it is usable, explain those weaknesses in Self-Review.
30. The Self-Review is a critique of the architecture itself, not a generic statement about the tools.

Return ONLY valid JSON matching the requested schema.
`;

      /*
       * ============================================================
       * USER PROMPT
       * ============================================================
       */

      const userPrompt = `
USER WORKSPACE GOAL:

${goal}

CURRENT AUTONOMOUS WORK SPACE CATALOG:

${JSON.stringify(catalog, null, 2)}

Create the autonomous workspace architecture for this goal.

Return JSON using exactly this structure:

{
  "goal_summary": "Detailed explanation of what the user is trying to accomplish and what the workspace needs to achieve.",

  "core_capabilities": [
    {
      "name": "capability name",
      "reason": "Detailed explanation of why this capability is required for this particular goal."
    }
  ],

  "layers": [
    {
      "number": 1,
      "name": "meaningful layer name",
      "purpose": "Detailed explanation of what this layer does.",
      "why_needed": "Detailed explanation of why this layer is necessary for this particular goal and how it connects to the overall architecture.",

      "agents": [
        {
          "name": "exact catalog name",
          "reason": "Detailed, goal-specific explanation of why this agent was selected and what role it performs."
        }
      ],

      "tools": [
        {
          "name": "exact catalog name",
          "reason": "Detailed, goal-specific explanation of why this tool was selected and what role it performs."
        }
      ]
    }
  ],

  "gaps": [
    {
      "capability": "missing or inadequately covered capability",
      "reason": "Detailed explanation of why the current catalog cannot adequately provide it."
    }
  ],

  "recommendations": [
    {
      "name": "external or stronger capability option",
      "capability": "capability it could provide",
      "reason": "Detailed explanation of why it could improve the workspace beyond the current catalog.",
      "url": "URL if confidently known, otherwise empty string"
    }
  ],

  "review": {
    "summary": "Detailed Self-Review of the generated architecture. Explain whether the architecture actually satisfies the user's goal, its strongest parts, weaknesses, risks, questionable selections, missing pieces, unnecessary components if any, and practical limitations.",
    "improvements": [
      "Specific improvement that should be considered for this architecture."
    ]
  },

  "architecture_summary": "DETAILED AND LONG ARCHITECTURE LOGIC. Explain why the architecture has this particular structure, why these layers exist, how work moves between them, why each selected component fits its assigned role, how the components complement each other, how the layers depend on one another, how gaps affect the design, what alternatives were considered when appropriate, and what limitations remain. This must be substantially detailed rather than a short summary."
}

IMPORTANT OUTPUT REQUIREMENTS:

- Return valid JSON only.
- Do not include markdown fences.
- Do not include commentary outside the JSON.
- Keep the number of layers dynamic.
- Keep component-level "Why selected" reasoning detailed.
- Keep the Self-Review detailed.
- Keep Architecture Logic detailed and long.
- Never invent catalog components.
- Do not create fake gaps or recommendations when they are not justified.
- Do not make all architectures look structurally identical.
`;

      /*
       * ============================================================
       * DISCOVER FREE MODELS
       * ============================================================
       */

      async function getFreeModels() {
        try {
          const response = await fetch(
            "https://openrouter.ai/api/v1/models",
            {
              headers: {
                Authorization: `Bearer ${env.OPENROUTER_KEY}`,
              },
            }
          );

          if (!response.ok) {
            return [];
          }

          const data = await response.json();

          if (!Array.isArray(data.data)) {
            return [];
          }

          const freeModels = data.data
            .filter((model) => {
              const id = String(model.id || "");

              /*
               * Explicit :free models.
               */

              if (id.endsWith(":free")) {
                return true;
              }

              /*
               * Explicit zero-price models.
               */

              const promptPrice =
                Number(model?.pricing?.prompt || 0);

              const completionPrice =
                Number(model?.pricing?.completion || 0);

              return (
                promptPrice === 0 &&
                completionPrice === 0
              );
            })
            .map((model) => model.id)
            .filter(Boolean);

          return [
            ...new Set(freeModels),
          ];
        } catch {
          return [];
        }
      }

      /*
       * ============================================================
       * MODEL LIST
       * ============================================================
       *
       * openrouter/free remains the first choice.
       */

      const discoveredFreeModels =
        await getFreeModels();

      const modelCandidates = [
        "openrouter/free",
        ...discoveredFreeModels,
      ];

      const uniqueModels = [
        ...new Set(modelCandidates),
      ];

      /*
       * Controlled number of attempts.
       */

      const MAX_MODEL_ATTEMPTS =
        Math.min(
          uniqueModels.length,
          8
        );

      /*
       * ============================================================
       * CALL MODEL
       * ============================================================
       */

      async function callModel(model) {
        const response = await fetch(
          "https://openrouter.ai/api/v1/chat/completions",
          {
            method: "POST",

            headers: {
              Authorization:
                `Bearer ${env.OPENROUTER_KEY}`,

              "Content-Type":
                "application/json",

              "HTTP-Referer":
                "https://autonomouswork.space",

              "X-Title":
                "Autonomous Work Space",
            },

            body: JSON.stringify({
              model,

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

              /*
               * Increased from 5000 so the model has enough
               * room for detailed component reasoning,
               * Self-Review and Architecture Logic.
               */

              max_tokens: 7000,
            }),
          }
        );

        const responseText =
          await response.text();

        if (!response.ok) {
          return {
            success: false,
            reason:
              `HTTP ${response.status}`,
            details:
              responseText.slice(
                0,
                1000
              ),
          };
        }

        let data;

        try {
          data =
            JSON.parse(
              responseText
            );
        } catch {
          return {
            success: false,
            reason:
              "OpenRouter returned invalid JSON.",
            details:
              responseText.slice(
                0,
                1000
              ),
          };
        }

        /*
         * Normal OpenRouter response.
         */

        let content =
          data?.choices?.[0]?.message?.content;

        /*
         * Some provider responses can expose
         * content as an array of blocks.
         */

        if (Array.isArray(content)) {
          content =
            content
              .map((part) => {
                if (
                  typeof part ===
                  "string"
                ) {
                  return part;
                }

                if (
                  part &&
                  typeof part.text ===
                    "string"
                ) {
                  return part.text;
                }

                return "";
              })
              .join("");
        }

        content =
          String(
            content || ""
          ).trim();

        /*
         * Empty model response:
         * caller will automatically try another
         * free model.
         */

        if (!content) {
          return {
            success: false,
            reason:
              "Model returned empty content.",
            details:
              JSON.stringify(
                data
              ).slice(
                0,
                1500
              ),
          };
        }

        return {
          success: true,
          content,
        };
      }

      /*
       * ============================================================
       * TRY FREE MODELS
       * ============================================================
       */

      let successfulContent =
        "";

      let successfulModel =
        "";

      let attempts =
        0;

      const failures =
        [];

      for (
        const model of
          uniqueModels.slice(
            0,
            MAX_MODEL_ATTEMPTS
          )
      ) {
        attempts++;

        const result =
          await callModel(
            model
          );

        if (
          result.success
        ) {
          successfulContent =
            result.content;

          successfulModel =
            model;

          break;
        }

        failures.push({
          model,
          reason:
            result.reason,
        });
      }

      /*
       * ============================================================
       * ALL MODELS FAILED
       * ============================================================
       */

      if (
        !successfulContent
      ) {
        return new Response(
          JSON.stringify({
            error:
              "All available free reasoning models failed to return a usable response.",

            attempts,

            models_tried:
              uniqueModels.slice(
                0,
                MAX_MODEL_ATTEMPTS
              ),

            failures,
          }),
          {
            status: 502,

            headers: {
              ...corsHeaders,
              "Content-Type":
                "application/json",
            },
          }
        );
      }

      /*
       * ============================================================
       * PARSE ARCHITECTURE
       * ============================================================
       */

      let architecture;

      try {
        architecture =
          JSON.parse(
            successfulContent
          );
      } catch {
        /*
         * If the model accidentally surrounds
         * the JSON with text, extract the JSON object.
         */

        const start =
          successfulContent.indexOf(
            "{"
          );

        const end =
          successfulContent.lastIndexOf(
            "}"
          );

        if (
          start === -1 ||
          end === -1 ||
          end <= start
        ) {
          return new Response(
            JSON.stringify({
              error:
                "The reasoning model returned content, but it was not valid JSON.",

              model:
                successfulModel,

              raw:
                successfulContent.slice(
                  0,
                  2000
                ),
            }),
            {
              status: 502,

              headers: {
                ...corsHeaders,
                "Content-Type":
                  "application/json",
              },
            }
          );
        }

        try {
          architecture =
            JSON.parse(
              successfulContent.slice(
                start,
                end + 1
              )
            );
        } catch {
          return new Response(
            JSON.stringify({
              error:
                "Could not parse the reasoning model response.",

              model:
                successfulModel,

              raw:
                successfulContent.slice(
                  0,
                  2000
                ),
            }),
            {
              status: 502,

              headers: {
                ...corsHeaders,
                "Content-Type":
                  "application/json",
              },
            }
          );
        }
      }

      /*
       * ============================================================
       * RETURN FINAL ARCHITECTURE
       * ============================================================
       */

      return new Response(
        JSON.stringify({
          success: true,

          architecture,

          model_used:
            successfulModel,

          model_attempts:
            attempts,
        }),
        {
          headers: {
            ...corsHeaders,
            "Content-Type":
              "application/json",
          },
        }
      );
    } catch (error) {
      return new Response(
        JSON.stringify({
          error:
            error?.message ||
            "Unexpected Worker error.",
        }),
        {
          status: 500,

          headers: {
            ...corsHeaders,
            "Content-Type":
              "application/json",
          },
        }
      );
    }
  },
};
