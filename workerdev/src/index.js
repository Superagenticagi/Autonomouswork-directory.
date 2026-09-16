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
      ==========================================================
      GET
      ==========================================================
      Keep the existing Airtable endpoint for the public
      directory. Build My Stack does NOT use this data.
      ==========================================================
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
      ==========================================================
      BUILD STACK
      ==========================================================
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

      /*
      ==========================================================
      DISCOVERY PROMPT
      ==========================================================
      The model is now responsible for discovering suitable
      agents and tools instead of receiving an Airtable catalog.
      ==========================================================
      */

      const systemPrompt = `
You are the autonomous workspace architect for "Autonomous Work Space".

Your task is to take a user's real-world workspace goal and independently
discover the agents and tools that would be required to build that workspace.

IMPORTANT:

The supplied goal is the ONLY starting point.

There is NO Airtable catalog.

Do NOT assume that you are restricted to a predefined directory.

You must reason about the actual problem first, then identify the agents,
tools, services, platforms, frameworks, or other software capabilities
that would genuinely be useful for solving it.

The objective is not to produce a generic AI-tool list.

The objective is to design a coherent autonomous workspace.

==========================================================
DISCOVERY
==========================================================

Determine:

1. What the user is actually trying to accomplish.
2. What capabilities are genuinely required.
3. What types of agents are required.
4. What types of tools are required.
5. Which real products/services currently provide those capabilities.
6. How those components could work together.

You may identify real-world products outside any predefined directory.

However:

- Do NOT invent products.
- Do NOT invent URLs.
- Do NOT claim a product has a capability without reasonable evidence.
- Prefer well-known, verifiable products.
- Clearly preserve uncertainty where appropriate.
- Do not force unnecessary components into the architecture.
- Prefer a small number of strong components over a large list of weak ones.

==========================================================
FREE / ZERO-COST REQUIREMENT
==========================================================

The reasoning model itself is being accessed through OpenRouter free models.

That does NOT mean every discovered external product must be completely free.

For every discovered component, identify its availability status where reasonably
known:

- free
- free tier
- open source
- paid
- unknown

If the user's goal can realistically be satisfied with free/open-source options,
prefer those options.

Do not falsely describe paid software as free.

==========================================================
ARCHITECTURE
==========================================================

Create only the layers genuinely required by the goal.

Do NOT use a fixed seven-layer architecture.

A simple goal may require only a few layers.

A complex autonomous workspace may require many layers.

Every layer must have:

- meaningful name
- purpose
- why it is needed
- selected agents
- selected tools

Every selected component must have a specific reason for its selection.

==========================================================
AUTONOMOUS REASONING
==========================================================

Think like a system architect.

Do not merely match keywords.

For example, if the goal requires:

research → extraction → analysis → memory → reporting

then determine whether separate components are actually required for those
functions and how they connect.

Consider:

- input
- planning
- research
- execution
- data handling
- memory
- reasoning
- communication
- monitoring
- evaluation
- output

Only include functions that genuinely matter to the user's goal.

==========================================================
GAPS
==========================================================

After constructing the architecture, identify capability gaps.

A gap means:

"The proposed workspace needs this capability, but the currently discovered
components do not adequately cover it."

Do not invent a gap simply to make the result longer.

==========================================================
SELF REVIEW
==========================================================

Critically review the architecture after building it.

Ask:

- Does it actually solve the user's goal?
- Are the selected agents appropriate?
- Are the tools appropriate?
- Are there unnecessary components?
- Are there missing capabilities?
- Are there compatibility concerns?
- Are any claims uncertain?
- Could the architecture be simpler?
- What would prevent the workspace from working in practice?

The Self-Review must be genuinely critical.

==========================================================
ARCHITECTURE LOGIC
==========================================================

Provide a detailed explanation of how the architecture was derived.

Explain:

- how the user's goal was interpreted
- which capabilities were identified
- why particular agents were selected
- why particular tools were selected
- how the layers interact
- how the workspace would operate
- what gaps remain
- what assumptions were made
- what limitations exist

Do not mention Airtable.

Do not say the architecture was created from a directory.

Do not say that the system was restricted to 40 records.

==========================================================
OUTPUT
==========================================================

Return ONLY valid JSON.

No markdown.

No commentary outside JSON.
`;

      const userPrompt = `
USER WORKSPACE GOAL:

${goal}

Independently analyze this goal.

First determine the capabilities required.

Then discover appropriate real agents and tools.

Then construct the autonomous workspace architecture.

Then identify genuine gaps.

Then perform a critical self-review.

Return JSON using exactly this structure:

{
  "goal_summary": "Detailed explanation of what the user is actually trying to accomplish.",

  "core_capabilities": [
    {
      "name": "capability name",
      "reason": "Detailed explanation of why this capability is required."
    }
  ],

  "discovered_components": [
    {
      "name": "Exact product or project name",
      "type": "Agent or Tool",
      "category": "Relevant category",
      "url": "Real URL if confidently known, otherwise empty string",
      "availability": "free, free tier, open source, paid, or unknown",
      "reason": "Detailed explanation of why this component is relevant to the user's goal."
    }
  ],

  "layers": [
    {
      "number": 1,
      "name": "Meaningful layer name",
      "purpose": "Detailed explanation of what this layer does.",
      "why_needed": "Detailed explanation of why this layer is necessary.",

      "agents": [
        {
          "name": "Exact discovered component name",
          "reason": "Detailed component-level explanation."
        }
      ],

      "tools": [
        {
          "name": "Exact discovered component name",
          "reason": "Detailed component-level explanation."
        }
      ]
    }
  ],

  "gaps": [
    {
      "capability": "Missing capability",
      "reason": "Detailed explanation of why the discovered ecosystem does not adequately cover it."
    }
  ],

  "recommendations": [
    {
      "capability": "Capability that could be improved",
      "reason": "Detailed explanation of what kind of additional component would improve the workspace."
    }
  ],

  "review": {
    "summary": "Detailed critical self-review.",
    "improvements": [
      "Specific improvement.",
      "Another specific improvement if genuinely necessary."
    ]
  },

  "architecture_summary": "Detailed Architecture Logic explaining how the workspace was derived from the goal, why the selected components were chosen, how the layers work together, what assumptions were made, and what limitations remain."
}

IMPORTANT:

- Discover components independently.
- Do not use Airtable.
- Do not assume a predefined catalog.
- Do not invent products.
- Do not invent URLs.
- Do not fabricate capabilities.
- Prefer relevant and practical components.
- Prefer free/open-source options where they genuinely fit.
- Clearly identify paid or unknown availability.
- The number of layers must be determined by the actual goal.
- The number of components must be determined by the actual goal.
- Quality and reasoning are more important than quantity.
`;

      /*
      ==========================================================
      FREE MODEL DISCOVERY
      ==========================================================
      */

      async function getFreeModels() {
        try {
          const response = await fetch(
            "https://openrouter.ai/api/v1/models",
            {
              headers: {
                Authorization:
                  `Bearer ${env.OPENROUTER_KEY}`,
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
              const id =
                String(model.id || "");

              if (id.endsWith(":free")) {
                return true;
              }

              const promptPrice =
                Number(
                  model?.pricing?.prompt || 0
                );

              const completionPrice =
                Number(
                  model?.pricing?.completion || 0
                );

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

      const discoveredFreeModels =
        await getFreeModels();

      const modelCandidates = [
        "openrouter/free",
        ...discoveredFreeModels,
      ];

      const uniqueModels = [
        ...new Set(modelCandidates),
      ];

      const MAX_MODEL_ATTEMPTS =
        Math.min(
          uniqueModels.length,
          8
        );

      /*
      ==========================================================
      MODEL CALL
      ==========================================================
      */

      async function callModel(model) {
        const response =
          await fetch(
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
                    content:
                      systemPrompt,
                  },

                  {
                    role: "user",
                    content:
                      userPrompt,
                  },
                ],

                temperature: 0.2,

                max_tokens: 10000,
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
                1500
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
                1500
              ),
          };
        }

        let content =
          data?.choices?.[0]?.message?.content;

        /*
        Some models return content as
        an array of content blocks.
        */

        if (
          Array.isArray(content)
        ) {
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
                2000
              ),
          };
        }

        return {
          success: true,
          content,
        };
      }

      /*
      ==========================================================
      TRY FREE MODELS
      ==========================================================
      */

      let successfulContent =
        "";

      let successfulModel =
        "";

      let attempts = 0;

      const failures = [];

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
      ==========================================================
      PARSE ARCHITECTURE
      ==========================================================
      */

      let architecture;

      try {
        architecture =
          JSON.parse(
            successfulContent
          );
      } catch {
        /*
        Try extracting JSON if the
        model accidentally surrounded
        the response with text.
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
                  3000
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
                  3000
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
      ==========================================================
      NORMALIZE OUTPUT
      ==========================================================
      */

      if (
        !architecture ||
        typeof architecture !==
          "object"
      ) {
        return new Response(
          JSON.stringify({
            error:
              "The reasoning model returned an invalid architecture object.",

            model:
              successfulModel,
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

      if (
        !Array.isArray(
          architecture.core_capabilities
        )
      ) {
        architecture.core_capabilities =
          [];
      }

      if (
        !Array.isArray(
          architecture.discovered_components
        )
      ) {
        architecture.discovered_components =
          [];
      }

      if (
        !Array.isArray(
          architecture.layers
        )
      ) {
        architecture.layers =
          [];
      }

      if (
        !Array.isArray(
          architecture.gaps
        )
      ) {
        architecture.gaps =
          [];
      }

      if (
        !Array.isArray(
          architecture.recommendations
        )
      ) {
        architecture.recommendations =
          [];
      }

      if (
        !architecture.review ||
        typeof architecture.review !==
          "object"
      ) {
        architecture.review = {
          summary:
            "No separate self-review was returned by the reasoning model.",

          improvements: [],
        };
      }

      if (
        typeof architecture.review.summary !==
        "string"
      ) {
        architecture.review.summary =
          "";
      }

      if (
        !Array.isArray(
          architecture.review.improvements
        )
      ) {
        architecture.review.improvements =
          [];
      }

      if (
        typeof architecture.architecture_summary !==
        "string"
      ) {
        architecture.architecture_summary =
          "";
      }

      /*
      ==========================================================
      FINAL RESPONSE
      ==========================================================
      */

      return new Response(
        JSON.stringify(
          {
            success: true,

            architecture,

            model_used:
              successfulModel,

            model_attempts:
              attempts,

            discovery_mode:
              "openrouter_free_models",
          },
          null,
          2
        ),

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
