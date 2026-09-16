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
       *
       * IMPORTANT:
       * Airtable is deliberately NOT used here.
       *
       * The Builder is now LLM-first. It receives only the user's
       * workspace goal and independently determines:
       *
       * - required capabilities
       * - appropriate agents
       * - appropriate tools
       * - dynamic architecture layers
       * - gaps
       * - recommendations
       * - self-review
       *
       * The returned JSON structure remains compatible with the
       * existing frontend architecture display.
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
       * ============================================================
       * SYSTEM PROMPT
       * ============================================================
       */

      const systemPrompt = `
You are the autonomous workspace architect for "Autonomous Work Space".

Your job is to transform a user's real-world goal into a practical,
deeply reasoned autonomous workspace architecture.

IMPORTANT:

This Builder is NOT connected to the Autonomous Work Space directory
for this operation.

Do NOT use Airtable.
Do NOT expect an ecosystem catalog.
Do NOT select components from a supplied catalog.
Do NOT claim that a component exists in the Autonomous Work Space
directory.

Instead, reason from the user's actual goal and identify suitable
real-world agents, agent technologies, tools, platforms, APIs,
databases, infrastructure, and services that could realistically be
used to build the workspace.

This is NOT a simple directory recommendation task.

You must think about:

- what the user is actually trying to accomplish
- what capabilities are genuinely required
- what stages of work are required
- which agents and tools are actually appropriate
- how those components relate to one another
- how the workspace can operate autonomously
- what information must be discovered
- what reasoning and decisions are required
- what execution and automation are required
- what memory or knowledge is required
- what outputs must be produced
- how monitoring and recovery should work
- what weaknesses remain after the architecture is constructed

IMPORTANT RULES:

1. Do NOT force every goal into a fixed seven-layer template.

2. Create only the layers that genuinely make sense for this
   particular goal.

3. The number of layers can vary. A simple goal may need only a few
   layers. A complex goal may require more.

4. Every layer must represent a meaningful capability, stage,
   responsibility, or function of the actual workspace.

5. Identify REAL-WORLD agents, agent technologies, tools, platforms,
   APIs, databases, infrastructure, or services where appropriate.

6. Never invent fake products.

7. Do not manufacture fake URLs.

8. Do not claim that an imaginary product exists.

9. Do not select components merely because their name sounds relevant.

10. Explain WHY every layer exists.

11. Explain WHY every selected agent or tool was selected.

12. Component-level reasoning is important. Give meaningful reasons,
    not generic statements such as "this tool is useful."

13. Reason from the user's actual goal, not from generic AI-directory
    categories.

14. Prefer a small number of strong components over filling the
    architecture with weak components.

15. The architecture should describe what the workspace needs to
    accomplish, not merely list software.

16. Think about the logical relationship between layers. Explain how
    work moves from one capability to another.

17. Be honest when a required capability is difficult to provide.

18. Identify weaknesses in your own proposed architecture.

19. The Self-Review must genuinely critique the architecture rather
    than simply praise it.

20. Architecture Logic must be detailed. Do not reduce it to a short
    generic summary.

21. Explain why the architecture has this particular structure and
    why the selected components fit the user's goal.

22. Where there are gaps, explain what is missing and why.

23. Where a stronger capability, agent, or tool would be useful,
    identify it as a recommendation.

24. Do not create artificial layers simply to make the answer longer.

25. Quality of reasoning is more important than the number of layers
    or components.

26. The final architecture should be understandable to a human who
    wants to actually build the workspace.

27. Preserve uncertainty where appropriate.

28. Do not claim certainty when a technology's suitability depends on
    implementation details.

29. Do not turn every component into an LLM.

30. Use different types of technologies where appropriate, including
    search, databases, automation, APIs, orchestration, monitoring,
    communication, storage, and other infrastructure.

31. The selected components must collectively form a coherent
    autonomous workflow.

32. The final answer must be valid JSON.

33. Return ONLY valid JSON matching the requested schema.

34. Do not include markdown.

35. Do not include commentary outside the JSON.
`;

      /*
       * ============================================================
       * USER PROMPT
       * ============================================================
       */

      const userPrompt = `
USER WORKSPACE GOAL:

${goal}

Analyze this goal carefully.

First determine what the workspace actually needs to accomplish.

Then determine the core capabilities required.

Then identify appropriate real-world agents, agent technologies,
tools, platforms, APIs, databases, infrastructure, and services.

Then construct a dynamic architecture around those capabilities.

The architecture must be designed specifically for this goal.

Do NOT assume a fixed seven-layer structure.

Do NOT use Airtable.

Do NOT assume an existing Autonomous Work Space directory.

Do NOT limit your choices to a predefined catalog.

After constructing the architecture, critically review it.

The final response must be detailed enough to show the reasoning behind
the architecture while remaining realistic and technically coherent.

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
          "name": "real-world agent, agent technology, or realistic agent type",
          "reason": "Detailed explanation of why this particular agent or agent technology was selected and how it supports the actual requirement."
        }
      ],

      "tools": [
        {
          "name": "real-world tool, platform, technology, API, database, infrastructure, or service",
          "reason": "Detailed explanation of why this particular tool or technology was selected and how it supports the actual requirement."
        }
      ]
    }
  ],

  "gaps": [
    {
      "capability": "missing or weak capability",
      "reason": "Detailed explanation of why the architecture cannot adequately provide this capability without additional work or infrastructure."
    }
  ],

  "recommendations": [
    {
      "capability": "capability that could be improved",
      "reason": "Explain what stronger capability, agent, tool, technology, or architectural improvement would improve the workspace and why."
    }
  ],

  "review": {
    "summary": "Detailed critical self-review of the proposed architecture. Discuss whether the architecture genuinely fits the goal, whether the selected components are strong matches, where the architecture is incomplete, and what risks or weaknesses remain.",

    "improvements": [
      "Specific improvement that should be considered.",
      "Another specific improvement if one is genuinely necessary."
    ]
  },

  "architecture_summary": "Detailed Architecture Logic. Explain how the architecture was derived from the user's goal, why these particular capabilities and layers were created, why the selected agents and tools fit their respective responsibilities, how the layers work together, why this structure is appropriate instead of a generic fixed template, where implementation limitations exist, and how the resulting workspace would operate as a coherent autonomous system."
}

IMPORTANT OUTPUT REQUIREMENTS:

- "goal_summary" should explain the actual goal rather than merely
  repeat the user's words.

- "core_capabilities" should contain capabilities genuinely required
  by the goal.

- "layers" must be dynamically determined from the goal.

- Each layer needs a meaningful purpose and a detailed "why_needed".

- Every selected agent and tool must have a detailed component-level
  "reason".

- Use real technologies and services where appropriate.

- Do not invent fake products.

- Do not invent fake URLs.

- Do not select components simply to increase the number of
  components.

- "gaps" should be honest. If there are no important gaps, return an
  empty array.

- "recommendations" should contain useful improvement directions when
  appropriate.

- "review.summary" must be a real critical Self-Review.

- "review.improvements" must identify concrete improvements where
  appropriate.

- "architecture_summary" must be a detailed Architecture Logic
  explanation, not a one- or two-sentence summary.

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
       * ============================================================
       * MODEL ATTEMPT LIMIT
       * ============================================================
       *
       * Keep the first model as the preferred route and allow
       * fallback to other currently-free models if necessary.
       */

      const MAX_MODEL_ATTEMPTS = Math.min(
        uniqueModels.length,
        30
      );

      /*
       * ============================================================
       * OPENROUTER REQUEST FUNCTION
       * ============================================================
       */

      async function callModel(model) {
        const controller = new AbortController();

        const timeout = setTimeout(() => {
          controller.abort();
        }, 90000);

        try {
          const response = await fetch(
            "https://openrouter.ai/api/v1/chat/completions",
            {
              method: "POST",

              headers: {
                Authorization: `Bearer ${env.OPENROUTER_KEY}`,
                "Content-Type": "application/json",
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

                /*
                 * Low temperature helps preserve structured output
                 * while still allowing goal-specific reasoning.
                 */

                temperature: 0.2,

                /*
                 * Detailed Architecture Logic + Self-Review
                 * legitimately requires substantial output.
                 */

                max_tokens: 8000,
              }),

              signal: controller.signal,
            }
          );

          const responseText = await response.text();

          if (!response.ok) {
            return {
              success: false,
              reason: `HTTP ${response.status}`,
              details: responseText.slice(0, 1500),
            };
          }

          let data;

          try {
            data = JSON.parse(responseText);
          } catch {
            return {
              success: false,
              reason:
                "OpenRouter returned invalid JSON.",
              details: responseText.slice(0, 1500),
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
              reason:
                "Model returned empty content.",
              details: JSON.stringify(data).slice(
                0,
                2000
              ),
            };
          }

          return {
            success: true,
            content,
          };
        } catch (error) {
          return {
            success: false,
            reason:
              error?.name === "AbortError"
                ? "Model request timed out."
                : error?.message ||
                  "Unknown model request error.",
            details: "",
          };
        } finally {
          clearTimeout(timeout);
        }
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
          details: result.details || "",
        });
      }

      /*
       * ============================================================
       * ALL FREE MODELS FAILED
       * ============================================================
       */

      if (!successfulContent) {
        return new Response(
          JSON.stringify(
            {
              error:
                "All available free reasoning models failed to return a usable response.",

              attempts,

              models_tried:
                uniqueModels.slice(
                  0,
                  MAX_MODEL_ATTEMPTS
                ),

              failures,
            },
            null,
            2
          ),
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
         * surrounding text or markdown fences.
         */

        let cleaned =
          successfulContent.trim();

        /*
         * Remove common markdown JSON fences.
         */

        cleaned = cleaned
          .replace(/^```json\s*/i, "")
          .replace(/^```\s*/i, "")
          .replace(/\s*```$/i, "")
          .trim();

        try {
          architecture = JSON.parse(cleaned);
        } catch {
          /*
           * Last recovery attempt:
           * extract the outermost JSON object.
           */

          const start =
            cleaned.indexOf("{");

          const end =
            cleaned.lastIndexOf("}");

          if (
            start === -1 ||
            end === -1 ||
            end <= start
          ) {
            return new Response(
              JSON.stringify(
                {
                  error:
                    "The reasoning model returned content, but it was not valid JSON.",

                  model:
                    successfulModel,

                  raw:
                    successfulContent.slice(
                      0,
                      3000
                    ),
                },
                null,
                2
              ),
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
              cleaned.slice(
                start,
                end + 1
              )
            );
          } catch {
            return new Response(
              JSON.stringify(
                {
                  error:
                    "Could not parse the reasoning model response.",

                  model:
                    successfulModel,

                  raw:
                    successfulContent.slice(
                      0,
                      3000
                    ),
                },
                null,
                2
              ),
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
      }

      /*
       * ============================================================
       * BASIC OUTPUT VALIDATION
       * ============================================================
       *
       * We do not reject a useful architecture just because
       * one optional section is missing.
       *
       * We ensure the important structural fields exist.
       * ============================================================
       */

      if (
        !architecture ||
        typeof architecture !== "object"
      ) {
        return new Response(
          JSON.stringify(
            {
              error:
                "The reasoning model returned an invalid architecture object.",

              model:
                successfulModel,
            },
            null,
            2
          ),
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
        typeof architecture.goal_summary !==
        "string"
      ) {
        architecture.goal_summary = "";
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
        typeof architecture.review !==
          "object"
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
       * NORMALIZE LAYERS
       * ============================================================
       *
       * Preserve the model's dynamic layer structure.
       * We do NOT impose a fixed seven-layer template.
       */

      architecture.layers =
        architecture.layers.map(
          (layer, index) => {
            if (
              !layer ||
              typeof layer !== "object"
            ) {
              return {
                number: index + 1,
                name: "Workspace Layer",
                purpose: "",
                why_needed: "",
                agents: [],
                tools: [],
              };
            }

            if (
              typeof layer.number !== "number"
            ) {
              layer.number = index + 1;
            }

            if (
              typeof layer.name !== "string" ||
              !layer.name.trim()
            ) {
              layer.name =
                "Workspace Layer";
            }

            if (
              typeof layer.purpose !==
              "string"
            ) {
              layer.purpose = "";
            }

            if (
              typeof layer.why_needed !==
              "string"
            ) {
              layer.why_needed = "";
            }

            if (
              !Array.isArray(layer.agents)
            ) {
              layer.agents = [];
            }

            if (
              !Array.isArray(layer.tools)
            ) {
              layer.tools = [];
            }

            layer.agents =
              layer.agents.map((agent) => ({
                name:
                  typeof agent?.name ===
                  "string"
                    ? agent.name
                    : "Unnamed agent",

                reason:
                  typeof agent?.reason ===
                  "string"
                    ? agent.reason
                    : "",
              }));

            layer.tools =
              layer.tools.map((tool) => ({
                name:
                  typeof tool?.name ===
                  "string"
                    ? tool.name
                    : "Unnamed tool",

                reason:
                  typeof tool?.reason ===
                  "string"
                    ? tool.reason
                    : "",
              }));

            return layer;
          }
        );

      /*
       * ============================================================
       * NORMALIZE CORE CAPABILITIES
       * ============================================================
       */

      architecture.core_capabilities =
        architecture.core_capabilities.map(
          (item) => ({
            name:
              typeof item?.name === "string"
                ? item.name
                : "Capability",

            reason:
              typeof item?.reason === "string"
                ? item.reason
                : "",
          })
        );

      /*
       * ============================================================
       * NORMALIZE GAPS
       * ============================================================
       */

      architecture.gaps =
        architecture.gaps.map(
          (gap) => ({
            capability:
              typeof gap?.capability ===
              "string"
                ? gap.capability
                : "Unspecified capability gap",

            reason:
              typeof gap?.reason === "string"
                ? gap.reason
                : "",
          })
        );

      /*
       * ============================================================
       * NORMALIZE RECOMMENDATIONS
       * ============================================================
       */

      architecture.recommendations =
        architecture.recommendations
          .filter(
            (item) =>
              item &&
              typeof item === "object"
          )
          .filter((item) => {
            const capability =
              String(
                item.capability || ""
              ).trim();

            /*
             * Remove obvious placeholder outputs.
             */

            const lower =
              capability.toLowerCase();

            return (
              capability &&
              lower !==
                "recommended capability" &&
              lower !==
                "recommended component" &&
              lower !==
                "recommended agent" &&
              lower !==
                "recommended tool"
            );
          })
          .map((item) => ({
            capability:
              String(
                item.capability || ""
              ).trim(),

            reason:
              String(
                item.reason || ""
              ).trim(),
          }));

      /*
       * ============================================================
       * FINAL ARCHITECTURE LOGIC SAFETY
       * ============================================================
       *
       * If the model gives an empty architecture summary, provide a
       * useful deterministic explanation without replacing the
       * model's architecture.
       */

      if (
        !architecture.architecture_summary.trim()
      ) {
        const layerCount =
          architecture.layers.length;

        const componentCount =
          architecture.layers.reduce(
            (total, layer) =>
              total +
              layer.agents.length +
              layer.tools.length,
            0
          );

        architecture.architecture_summary =
          `The workspace architecture was derived from the user's goal rather than from a fixed template. It contains ${layerCount} dynamically determined layers and ${componentCount} selected components. Each layer represents a meaningful responsibility in the autonomous workflow, while the selected agents and tools support the capabilities required for that responsibility.`;
      }

      /*
       * ============================================================
       * FINAL RESPONSE
       * ============================================================
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
          },
          null,
          2
        ),
        {
          status: 200,

          headers: {
            ...corsHeaders,
            "Content-Type":
              "application/json",

            "Cache-Control":
              "no-store",
          },
        }
      );
    } catch (error) {
      return new Response(
        JSON.stringify(
          {
            error:
              error?.message ||
              "Unexpected Worker error.",
          },
          null,
          2
        ),
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
