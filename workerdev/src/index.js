
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

Your job is to transform a user's real-world goal into a practical, deeply reasoned autonomous workspace architecture.

This is NOT a simple directory recommendation task.

You must think about:
- what the user is actually trying to accomplish
- what capabilities are genuinely required
- what stages of work are required
- which agents and tools are actually appropriate
- how those components relate to one another
- what the current ecosystem can and cannot provide
- whether the proposed architecture is coherent
- what weaknesses remain after the architecture is constructed

IMPORTANT RULES:

1. Do NOT force every goal into a fixed seven-layer template.

2. Create only the layers that genuinely make sense for this particular goal.

3. The number of layers can vary. A simple goal may need only a few layers. A complex goal may require more.

4. Every layer must represent a meaningful capability, stage, responsibility, or function of the actual workspace.

5. Select agents and tools ONLY from the supplied catalog.

6. Never invent an agent, tool, product, capability, URL, or name.

7. A component may be selected only when its supplied description, category, or stated capability reasonably supports the required job.

8. Do not select components merely because their category sounds relevant.

9. If a component is a weak match, do not pretend it is a strong match.

10. If the catalog lacks a necessary capability, explicitly identify the capability gap.

11. Explain WHY every layer exists.

12. Explain WHY every selected agent or tool was selected.

13. Component-level reasoning is important. Give meaningful reasons, not generic statements such as "this tool is useful."

14. Reason from the user's actual goal, not from generic directory categories.

15. Prefer a small number of strong components over filling the architecture with weak components.

16. The architecture should describe what the workspace needs to accomplish, not merely list software.

17. Think about the logical relationship between layers. Explain how work moves from one capability to another.

18. Be honest when the current catalog cannot fully satisfy the goal.

19. Do not claim that a tool performs a capability that its supplied description does not support.

20. Identify weaknesses in your own proposed architecture.

21. The Self-Review must genuinely critique the architecture rather than simply praise it.

22. Architecture Logic must be detailed. Do not reduce it to a short generic summary.

23. Explain why the architecture has this particular structure and why the selected components fit the user's goal.

24. Where there are gaps, explain what is missing and why the current catalog is insufficient.

25. Where a stronger alternative appears necessary but is not in the supplied catalog, identify that as a recommendation rather than inventing it as an existing catalog component.

26. Do not manufacture external products or URLs.

27. Do not create artificial layers simply to make the answer longer.

28. Quality of reasoning is more important than the number of layers or components.

29. The final architecture should be understandable to a human who wants to actually build the workspace.

30. Preserve uncertainty where appropriate. Do not claim certainty when the catalog evidence is weak.

Return ONLY valid JSON matching the requested schema.
Do not include markdown.
Do not include commentary outside the JSON.
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

Analyze the user's goal carefully.

First determine what the workspace actually needs to accomplish.

Then determine the core capabilities required.

Then evaluate the supplied ecosystem against those capabilities.

Then construct a dynamic architecture using only appropriate catalog components.

After constructing the architecture, critically review it.

The final response must be detailed enough to show the reasoning behind the architecture, while remaining grounded in the supplied catalog.

Return JSON using exactly this structure:

{
  "goal_summary": "Detailed explanation of what the user is actually trying to build and accomplish.",

  "core_capabilities": [
    {
      "name": "capability name",
      "reason": "Detailed explanation of why this capability is genuinely required for this goal."
    }
  ],

  "layers": [
    {
      "number": 1,
      "name": "meaningful layer name",
      "purpose": "Detailed explanation of what this layer is responsible for.",
      "why_needed": "Detailed explanation of why this layer is necessary for this particular goal and how it relates to the overall architecture.",

      "agents": [
        {
          "name": "exact catalog name",
          "reason": "Detailed explanation of why this particular catalog agent was selected, based on its supplied description/category and the actual requirement."
        }
      ],

      "tools": [
        {
          "name": "exact catalog name",
          "reason": "Detailed explanation of why this particular catalog tool was selected, based on its supplied description/category and the actual requirement."
        }
      ]
    }
  ],

  "gaps": [
    {
      "capability": "missing or weak capability",
      "reason": "Detailed explanation of why the current ecosystem cannot adequately provide this capability."
    }
  ],

  "recommendations": [
    {
      "capability": "capability that could be improved",
      "reason": "Explain what kind of stronger capability, agent, or tool would improve the workspace and why."
    }
  ],

  "review": {
    "summary": "Detailed critical self-review of the proposed architecture. Discuss whether the architecture genuinely fits the goal, whether the selected components are strong matches, where the architecture is incomplete, and what risks or weaknesses remain.",

    "improvements": [
      "Specific improvement that should be considered.",
      "Another specific improvement if one is genuinely necessary."
    ]
  },

  "architecture_summary": "Detailed Architecture Logic. Explain how the architecture was derived from the user's goal, why these particular capabilities and layers were created, why the selected agents and tools fit their respective responsibilities, how the layers work together, why this structure is appropriate instead of a generic fixed template, where the current ecosystem is insufficient, and how the resulting workspace would operate as a coherent autonomous system."
}

IMPORTANT OUTPUT REQUIREMENTS:

- "goal_summary" should explain the actual goal rather than merely repeat the user's words.

- "core_capabilities" should contain capabilities genuinely required by the goal.

- "layers" must be dynamically determined from the goal.

- Each layer needs a meaningful purpose and a detailed "why_needed".

- Every selected agent and tool must have a detailed component-level "reason".

- Do not select components simply to increase the number of components.

- "gaps" should be honest. If there are no important gaps, return an empty array.

- "recommendations" should contain useful improvement directions when appropriate. Do not invent actual external products unless they are supported by the supplied catalog.

- "review.summary" must be a real critical Self-Review.

- "review.improvements" must identify concrete improvements where appropriate.

- "architecture_summary" must be a detailed Architecture Logic explanation, not a one- or two-sentence summary.

- Do not shorten the reasoning merely to save tokens.

- Do not include markdown.

- Do not include text outside the JSON.
`;

      /*
       * ============================================================
       * FREE MODEL DISCOVERY
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

          return [...new Set(freeModels)];
        } catch {
          return [];
        }
      }

      /*
       * ============================================================
       * BUILD MODEL CANDIDATE LIST
       * ============================================================
       */

      const discoveredFreeModels = await getFreeModels();

      const modelCandidates = [
        "openrouter/free",
        ...discoveredFreeModels,
      ];

      const uniqueModels = [
        ...new Set(modelCandidates),
      ];

      /*
       * Controlled fallback.
       */

      const MAX_MODEL_ATTEMPTS = Math.min(
        uniqueModels.length,
        8
      );

      /*
       * ============================================================
       * OPENROUTER REQUEST FUNCTION
       * ============================================================
       */

      async function callModel(model) {
        const response = await fetch(
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

              /*
               * Low temperature preserves consistency while
               * allowing the model to reason about different goals.
               */

              temperature: 0.2,

              /*
               * Increased from the previous version because
               * detailed Architecture Logic + Self-Review can
               * legitimately require more output.
               */

              max_tokens: 8000,
            }),
          }
        );

        const responseText = await response.text();

        if (!response.ok) {
          return {
            success: false,
            reason: `HTTP ${response.status}`,
            details: responseText.slice(0, 1000),
          };
        }

        let data;

        try {
          data = JSON.parse(responseText);
        } catch {
          return {
            success: false,
            reason: "OpenRouter returned invalid JSON.",
            details: responseText.slice(0, 1000),
          };
        }

        let content =
          data?.choices?.[0]?.message?.content;

        /*
         * Some providers return content blocks.
         */

        if (Array.isArray(content)) {
          content = content
            .map((part) => {
              if (typeof part === "string") {
                return part;
              }

              if (
                part &&
                typeof part.text === "string"
              ) {
                return part.text;
              }

              return "";
            })
            .join("");
        }

        content = String(content || "").trim();

        if (!content) {
          return {
            success: false,
            reason: "Model returned empty content.",
            details: JSON.stringify(data).slice(0, 1500),
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

      let successfulContent = "";
      let successfulModel = "";
      let attempts = 0;

      const failures = [];

      for (
        const model of uniqueModels.slice(
          0,
          MAX_MODEL_ATTEMPTS
        )
      ) {
        attempts++;

        const result = await callModel(model);

        if (result.success) {
          successfulContent = result.content;
          successfulModel = model;
          break;
        }

        failures.push({
          model,
          reason: result.reason,
        });
      }

      /*
       * ============================================================
       * ALL FREE MODELS FAILED
       * ============================================================
       */

      if (!successfulContent) {
        return new Response(
          JSON.stringify({
            error:
              "All available free reasoning models failed to return a usable response.",
            attempts,
            models_tried: uniqueModels.slice(
              0,
              MAX_MODEL_ATTEMPTS
            ),
            failures,
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
       * ============================================================
       * PARSE ARCHITECTURE JSON
       * ============================================================
       */

      let architecture;

      try {
        architecture = JSON.parse(
          successfulContent
        );
      } catch {
        /*
         * Recover JSON if a model accidentally adds
         * surrounding text.
         */

        const start =
          successfulContent.indexOf("{");

        const end =
          successfulContent.lastIndexOf("}");

        if (
          start === -1 ||
          end === -1 ||
          end <= start
        ) {
          return new Response(
            JSON.stringify({
              error:
                "The reasoning model returned content, but it was not valid JSON.",
              model: successfulModel,
              raw: successfulContent.slice(
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
          architecture = JSON.parse(
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
              model: successfulModel,
              raw: successfulContent.slice(
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
       * BASIC OUTPUT VALIDATION
       * ============================================================
       *
       * We don't reject a useful architecture just because
       * one optional section is missing, but we ensure the
       * important structural fields exist.
       */

      if (
        !architecture ||
        typeof architecture !== "object"
      ) {
        return new Response(
          JSON.stringify({
            error:
              "The reasoning model returned an invalid architecture object.",
            model: successfulModel,
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

      if (
        !Array.isArray(
          architecture.core_capabilities
        )
      ) {
        architecture.core_capabilities = [];
      }

      if (
        !Array.isArray(
          architecture.layers
        )
      ) {
        architecture.layers = [];
      }

      if (
        !Array.isArray(
          architecture.gaps
        )
      ) {
        architecture.gaps = [];
      }

      if (
        !Array.isArray(
          architecture.recommendations
        )
      ) {
        architecture.recommendations = [];
      }

      /*
       * Preserve the frontend's existing review schema.
       */

      if (
        !architecture.review ||
        typeof architecture.review !== "object"
      ) {
        architecture.review = {
          summary:
            "The architecture was generated, but the reasoning model did not provide a separate self-review.",
          improvements: [],
        };
      }

      if (
        typeof architecture.review.summary !==
        "string"
      ) {
        architecture.review.summary = "";
      }

      if (
        !Array.isArray(
          architecture.review.improvements
        )
      ) {
        architecture.review.improvements = [];
      }

      if (
        typeof architecture.architecture_summary !==
        "string"
      ) {
        architecture.architecture_summary = "";
      }

      /*
       * ============================================================
       * RETURN FINAL ARCHITECTURE
       * ============================================================
       */

      return new Response(
        JSON.stringify(
          {
            success: true,
            architecture,
            model_used: successfulModel,
            model_attempts: attempts,
          },
          null,
          2
        ),
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
          error:
            error?.message ||
            "Unexpected Worker error.",
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
