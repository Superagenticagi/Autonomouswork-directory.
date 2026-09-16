export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // ============================================================
    // CORS
    // ============================================================

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

    // ============================================================
    // GET
    // Existing Airtable-backed directory endpoint
    // ============================================================

    if (request.method === "GET") {
      try {
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
      } catch (err) {
        return new Response(
          JSON.stringify({
            error: err.message,
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
    }

    // ============================================================
    // POST /build-stack
    //
    // IMPORTANT:
    // Airtable is NOT used here.
    //
    // The LLM independently understands the user's goal,
    // identifies capabilities, agents and tools, designs the
    // workspace, evaluates gaps, and performs self-review.
    // ============================================================

    if (request.method === "POST" && url.pathname === "/build-stack") {
      let body;

      try {
        body = await request.json();
      } catch (err) {
        return new Response(
          JSON.stringify({
            error: "Invalid JSON request body.",
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
            error: "Workspace goal is required.",
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

      // ------------------------------------------------------------
      // Discover currently available FREE OpenRouter models.
      // ------------------------------------------------------------

      async function getFreeModels() {
        const modelsResponse = await fetch(
          "https://openrouter.ai/api/v1/models",
          {
            headers: {
              Authorization: `Bearer ${env.OPENROUTER_API_KEY}`,
            },
          }
        );

        if (!modelsResponse.ok) {
          throw new Error(
            `OpenRouter model discovery failed: ${modelsResponse.status}`
          );
        }

        const modelsData = await modelsResponse.json();
        const models = Array.isArray(modelsData.data)
          ? modelsData.data
          : [];

        const freeModels = [];

        // Official free router first.
        freeModels.push("openrouter/free");

        for (const model of models) {
          if (!model || !model.id) continue;

          const id = String(model.id);

          // Explicit :free models
          if (id.endsWith(":free")) {
            if (!freeModels.includes(id)) {
              freeModels.push(id);
            }
            continue;
          }

          // Explicit zero-priced models
          const pricing = model.pricing;

          if (pricing) {
            const promptPrice = Number(pricing.prompt);
            const completionPrice = Number(pricing.completion);

            if (
              Number.isFinite(promptPrice) &&
              Number.isFinite(completionPrice) &&
              promptPrice === 0 &&
              completionPrice === 0
            ) {
              if (!freeModels.includes(id)) {
                freeModels.push(id);
              }
            }
          }
        }

        return freeModels;
      }

      // ------------------------------------------------------------
      // Extract actual model content safely.
      // ------------------------------------------------------------

      function extractContent(data) {
        if (!data) return "";

        if (
          data.choices &&
          data.choices[0] &&
          data.choices[0].message
        ) {
          const content = data.choices[0].message.content;

          if (typeof content === "string") {
            return content.trim();
          }

          if (Array.isArray(content)) {
            return content
              .map((item) => {
                if (typeof item === "string") return item;
                if (item && typeof item.text === "string") {
                  return item.text;
                }
                return "";
              })
              .join("")
              .trim();
          }
        }

        return "";
      }

      // ------------------------------------------------------------
      // Parse JSON robustly.
      // ------------------------------------------------------------

      function parseJSON(text) {
        if (!text || typeof text !== "string") {
          return null;
        }

        let cleaned = text.trim();

        // Remove markdown fences.
        cleaned = cleaned
          .replace(/^```json\s*/i, "")
          .replace(/^```\s*/i, "")
          .replace(/\s*```$/i, "")
          .trim();

        // First direct parse.
        try {
          return JSON.parse(cleaned);
        } catch (err) {}

        // Try extracting the outermost JSON object.
        const firstBrace = cleaned.indexOf("{");
        const lastBrace = cleaned.lastIndexOf("}");

        if (firstBrace !== -1 && lastBrace > firstBrace) {
          const candidate = cleaned.slice(
            firstBrace,
            lastBrace + 1
          );

          try {
            return JSON.parse(candidate);
          } catch (err) {}
        }

        return null;
      }

      // ------------------------------------------------------------
      // LLM request
      // ------------------------------------------------------------

      async function callModel(model) {
        const controller = new AbortController();

        const timeout = setTimeout(() => {
          controller.abort();
        }, 90000);

        try {
          const prompt = `
You are the autonomous architecture designer for Autonomous Work Space.

USER'S WORKSPACE GOAL:
${goal}

Your job is to understand the goal and design a realistic autonomous workspace.

Do NOT use Airtable.
Do NOT assume that the workspace is limited to an existing directory.
Do NOT return generic placeholders such as "Recommended agent", "Recommended tool", or "Recommended capability".

Think through the user's goal first.

You must:

1. Understand what the user is actually trying to accomplish.
2. Identify the capabilities required.
3. Identify suitable REAL-WORLD AI agents, agent technologies, or agent types.
4. Identify suitable REAL-WORLD tools, platforms, technologies, APIs, databases, infrastructure, or services.
5. Explain why each selected component fits.
6. Design a practical workflow showing how the components work together.
7. Identify important capability gaps.
8. Provide practical solutions for those gaps.
9. Perform a self-review of the resulting architecture.
10. Keep recommendations relevant to the actual goal.

The workspace should be designed as an autonomous system rather than simply a list of software.

Return ONLY valid JSON.

Use exactly this structure:

{
  "goal_understanding": "short explanation of what the user wants to accomplish",

  "required_capabilities": [
    {
      "name": "capability name",
      "reason": "why this capability is required"
    }
  ],

  "agents": [
    {
      "name": "real agent, agent technology, or realistic agent type",
      "category": "Research",
      "role": "what this agent does",
      "reason": "why it fits the goal",
      "fit": "High"
    }
  ],

  "tools": [
    {
      "name": "real tool, platform, technology, API, or service",
      "category": "Automation",
      "role": "what it does",
      "reason": "why it fits the goal",
      "fit": "High"
    }
  ],

  "workflow": [
    {
      "step": 1,
      "component": "component name",
      "action": "what happens"
    }
  ],

  "gaps": [
    {
      "name": "missing capability",
      "reason": "why it matters",
      "solution": "how to solve it"
    }
  ],

  "recommendations": [
    {
      "name": "specific recommendation",
      "reason": "why it matters",
      "priority": "High"
    }
  ],

  "self_review": {
    "summary": "short review of the architecture",
    "strengths": [
      "strength"
    ],
    "improvements": [
      "improvement"
    ],
    "remaining_gaps": [
      "remaining gap"
    ]
  }
}

IMPORTANT:
- Use real technologies and services where appropriate.
- Do not invent fake products.
- Do not make every component an LLM.
- Do not force unnecessary components into the architecture.
- The number of agents and tools should depend on the goal.
- Keep names specific.
- Keep explanations concise enough for reliable JSON generation.
- Do not include markdown.
`;

          const response = await fetch(
            "https://openrouter.ai/api/v1/chat/completions",
            {
              method: "POST",
              headers: {
                Authorization: `Bearer ${env.OPENROUTER_API_KEY}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                model,
                messages: [
                  {
                    role: "system",
                    content:
                      "You design autonomous AI workspaces. Return valid JSON only.",
                  },
                  {
                    role: "user",
                    content: prompt,
                  },
                ],
                temperature: 0.2,
                max_tokens: 7000,
              }),
              signal: controller.signal,
            }
          );

          if (!response.ok) {
            const errorText = await response.text();

            return {
              ok: false,
              error: `Model returned HTTP ${response.status}`,
              preview: errorText.slice(0, 1000),
            };
          }

          const data = await response.json();
          const content = extractContent(data);

          if (!content) {
            return {
              ok: false,
              error: "Model returned empty content.",
              preview: "",
            };
          }

          const parsed = parseJSON(content);

          if (!parsed || typeof parsed !== "object") {
            return {
              ok: false,
              error: "Model returned invalid JSON.",
              preview: content.slice(0, 2000),
            };
          }

          return {
            ok: true,
            data: parsed,
          };
        } catch (err) {
          return {
            ok: false,
            error:
              err.name === "AbortError"
                ? "Model request timed out."
                : err.message,
            preview: "",
          };
        } finally {
          clearTimeout(timeout);
        }
      }

      // ------------------------------------------------------------
      // Validate basic Builder result.
      // ------------------------------------------------------------

      function validResult(result) {
        if (!result || typeof result !== "object") {
          return false;
        }

        if (
          typeof result.goal_understanding !== "string"
        ) {
          return false;
        }

        if (!Array.isArray(result.required_capabilities)) {
          return false;
        }

        if (!Array.isArray(result.agents)) {
          return false;
        }

        if (!Array.isArray(result.tools)) {
          return false;
        }

        if (!Array.isArray(result.workflow)) {
          return false;
        }

        if (!Array.isArray(result.gaps)) {
          return false;
        }

        if (!Array.isArray(result.recommendations)) {
          return false;
        }

        if (
          !result.self_review ||
          typeof result.self_review !== "object"
        ) {
          return false;
        }

        return true;
      }

      // ------------------------------------------------------------
      // Layer construction
      //
      // Keep the existing frontend-compatible architecture fields.
      // ------------------------------------------------------------

      function componentText(component) {
        return [
          component.name,
          component.role,
          component.reason,
          component.category,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
      }

      function hasAny(text, words) {
        return words.some((word) => text.includes(word));
      }

      function buildLayers(result) {
        const allComponents = [
          ...(Array.isArray(result.agents)
            ? result.agents
            : []),
          ...(Array.isArray(result.tools)
            ? result.tools
            : []),
        ];

        const layers = [];

        const discovery = allComponents.filter((c) =>
          hasAny(componentText(c), [
            "research",
            "search",
            "discover",
            "browse",
            "browser",
            "prospect",
            "lead",
            "enrichment",
            "crawl",
            "scrape",
          ])
        );

        const reasoning = allComponents.filter((c) =>
          hasAny(componentText(c), [
            "reason",
            "analysis",
            "analy",
            "planning",
            "decision",
            "evaluate",
            "research agent",
            "llm",
            "model",
          ])
        );

        const memory = allComponents.filter((c) =>
          hasAny(componentText(c), [
            "memory",
            "database",
            "vector",
            "knowledge",
            "storage",
            "crm",
            "record",
            "retrieval",
          ])
        );

        const execution = allComponents.filter((c) =>
          hasAny(componentText(c), [
            "automation",
            "execute",
            "execution",
            "workflow",
            "api",
            "integration",
            "email",
            "outreach",
            "send",
            "action",
          ])
        );

        const output = allComponents.filter((c) =>
          hasAny(componentText(c), [
            "output",
            "report",
            "delivery",
            "dashboard",
            "document",
            "notification",
            "analytics",
          ])
        );

        const monitoring = allComponents.filter((c) =>
          hasAny(componentText(c), [
            "monitor",
            "logging",
            "log",
            "testing",
            "quality",
            "recovery",
            "failure",
            "observability",
            "tracking",
          ])
        );

        const supporting = allComponents.filter(
          (c) =>
            !discovery.includes(c) &&
            !reasoning.includes(c) &&
            !memory.includes(c) &&
            !execution.includes(c) &&
            !output.includes(c) &&
            !monitoring.includes(c)
        );

        function makeLayer(
          number,
          name,
          purpose,
          components
        ) {
          return {
            number,
            name,
            purpose,
            components: components.map((c) => ({
              name: c.name || "Unnamed component",
              type:
                result.agents.includes(c)
                  ? "Agent"
                  : "Tool",
              category: c.category || "",
              role: c.role || "",
              reason: c.reason || "",
              fit: c.fit || "",
            })),
          };
        }

        if (discovery.length) {
          layers.push(
            makeLayer(
              layers.length + 1,
              "Discovery",
              "Finds and gathers the information required to perform the user's work.",
              discovery
            )
          );
        }

        if (reasoning.length) {
          layers.push(
            makeLayer(
              layers.length + 1,
              "Reasoning & Analysis",
              "Processes information, performs reasoning, evaluation, planning, and decisions.",
              reasoning
            )
          );
        }

        if (memory.length) {
          layers.push(
            makeLayer(
              layers.length + 1,
              "Memory & Knowledge",
              "Stores and retrieves information needed for continued autonomous operation.",
              memory
            )
          );
        }

        if (execution.length) {
          layers.push(
            makeLayer(
              layers.length + 1,
              "Execution & Automation",
              "Carries out actions, integrations, and autonomous workflow execution.",
              execution
            )
          );
        }

        if (output.length) {
          layers.push(
            makeLayer(
              layers.length + 1,
              "Output & Delivery",
              "Transforms completed work into useful outputs and delivers them.",
              output
            )
          );
        }

        if (monitoring.length) {
          layers.push(
            makeLayer(
              layers.length + 1,
              "Monitoring & Recovery",
              "Monitors the workspace, detects failures, and supports recovery and quality control.",
              monitoring
            )
          );
        }

        if (supporting.length) {
          layers.push(
            makeLayer(
              layers.length + 1,
              "Supporting Components",
              "Provides additional capabilities required by the workspace.",
              supporting
            )
          );
        }

        return layers;
      }

      // ------------------------------------------------------------
      // Normalize recommendations.
      // ------------------------------------------------------------

      function normalizeRecommendations(items) {
        if (!Array.isArray(items)) return [];

        return items
          .filter((item) => item && typeof item === "object")
          .filter((item) => {
            const name = String(item.name || "").trim();

            if (!name) return false;

            const lower = name.toLowerCase();

            return ![
              "recommended capability",
              "recommended agent",
              "recommended tool",
              "recommended component",
            ].includes(lower);
          })
          .map((item) => ({
            name: String(item.name || "").trim(),
            reason: String(item.reason || "").trim(),
            priority: String(
              item.priority || "Medium"
            ).trim(),
          }));
      }

      // ------------------------------------------------------------
      // Try free models until one produces valid Builder JSON.
      // ------------------------------------------------------------

      let models;

      try {
        models = await getFreeModels();
      } catch (err) {
        return new Response(
          JSON.stringify({
            error: "Unable to discover free OpenRouter models.",
            details: err.message,
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

      const MAX_MODEL_ATTEMPTS = 30;

      const attempts = [];
      let builderResult = null;
      let selectedModel = null;

      for (
        let i = 0;
        i < models.length && i < MAX_MODEL_ATTEMPTS;
        i++
      ) {
        const model = models[i];

        const result = await callModel(model);

        attempts.push({
          model,
          success: result.ok,
          error: result.ok ? null : result.error,
          response_preview: result.ok
            ? null
            : result.preview || "",
        });

        if (result.ok && validResult(result.data)) {
          builderResult = result.data;
          selectedModel = model;
          break;
        }
      }

      if (!builderResult) {
        return new Response(
          JSON.stringify(
            {
              error:
                "The workspace could not be built. No free model returned a valid workspace result.",
              model_attempts: attempts,
              models_available: models.length,
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

      // ------------------------------------------------------------
      // Preserve the Builder's frontend-compatible result structure.
      // ------------------------------------------------------------

      const layers = buildLayers(builderResult);

      const agents = Array.isArray(builderResult.agents)
        ? builderResult.agents
        : [];

      const tools = Array.isArray(builderResult.tools)
        ? builderResult.tools
        : [];

      const workflow = Array.isArray(builderResult.workflow)
        ? builderResult.workflow
        : [];

      const gaps = Array.isArray(builderResult.gaps)
        ? builderResult.gaps
        : [];

      const recommendations = normalizeRecommendations(
        builderResult.recommendations
      );

      const architectureSummary =
        `The workspace for "${goal}" uses ` +
        `${agents.length} agents and ${tools.length} tools ` +
        `across ${layers.length} dynamically designed layers. ` +
        `The layers organize discovery, reasoning, memory, ` +
        `execution, delivery, monitoring, or other functions ` +
        `according to the actual components selected for the goal.`;

      const architecture = {
        goal,
        layers,
      };

      const responsePayload = {
        architecture,

        goal_understanding:
          builderResult.goal_understanding,

        required_capabilities:
          builderResult.required_capabilities,

        agents,

        tools,

        layers,

        architecture_summary:
          architectureSummary,

        workflow,

        component_evaluation: [
          ...agents.map((agent) => ({
            name: agent.name || "",
            type: "Agent",
            category: agent.category || "",
            role: agent.role || "",
            reason: agent.reason || "",
            fit: agent.fit || "",
          })),

          ...tools.map((tool) => ({
            name: tool.name || "",
            type: "Tool",
            category: tool.category || "",
            role: tool.role || "",
            reason: tool.reason || "",
            fit: tool.fit || "",
          })),
        ],

        capability_gaps: gaps,

        gap_solutions: gaps.map((gap) => ({
          name: gap.name || "",
          reason: gap.reason || "",
          solution: gap.solution || "",
        })),

        final_architecture: {
          goal,
          layers,
          agents,
          tools,
          workflow,
        },

        autonomy_logic:
          "The workspace is designed to understand the goal, gather required information, reason over that information, execute the necessary workflow, produce outputs, and monitor or recover from failures where appropriate.",

        failure_recovery:
          "The architecture should validate important outputs, detect execution failures, retry recoverable operations, and escalate unresolved issues where autonomous recovery is not reliable.",

        human_involvement:
          "Human involvement should be limited to decisions or actions that require approval, sensitive judgment, credentials, legal responsibility, or other safeguards identified during deployment.",

        recommendations,

        external_recommendations: recommendations,

        review: {
          summary:
            builderResult.self_review.summary || "",

          strengths:
            Array.isArray(
              builderResult.self_review.strengths
            )
              ? builderResult.self_review.strengths
              : [],

          improvements:
            Array.isArray(
              builderResult.self_review.improvements
            )
              ? builderResult.self_review.improvements
              : [],

          remaining_gaps:
            Array.isArray(
              builderResult.self_review.remaining_gaps
            )
              ? builderResult.self_review.remaining_gaps
              : [],
        },

        model_used: selectedModel,

        model_attempts: attempts,

        builder_version: "V8.1",

        builder_mode:
          "LLM-first autonomous workspace discovery",
      };

      return new Response(
        JSON.stringify(responsePayload, null, 2),
        {
          status: 200,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json",
            "Cache-Control": "no-store",
          },
        }
      );
    }

    // ============================================================
    // Other POST requests
    // ============================================================

    if (request.method === "POST") {
      return new Response("Not found", {
        status: 404,
        headers: corsHeaders,
      });
    }

    return new Response("Method not allowed", {
      status: 405,
      headers: corsHeaders,
    });
  },
};
