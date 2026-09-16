export default {
  async fetch(request, env) {
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };

    // =========================================================
    // CORS
    // =========================================================

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders,
      });
    }

    // =========================================================
    // GET
    // =========================================================
    // Airtable is STILL used here for the directory.
    //
    // The Stack Builder does NOT use Airtable.
    // =========================================================

    if (request.method === "GET") {
      try {
        const BASE_ID = "appY6TPhOsmj3dIX8";
        const TABLE_NAME = "Table 1";

        const airtableUrl =
          `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(
            TABLE_NAME
          )}?maxRecords=100`;

        const response = await fetch(airtableUrl, {
          headers: {
            Authorization: `Bearer ${env.AIRTABLE_TOKEN}`,
            "Content-Type": "application/json",
          },
        });

        if (!response.ok) {
          const errorText = await response.text();

          return new Response(
            JSON.stringify({
              error: "Failed to fetch from Airtable",
              details: errorText,
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

        const items = (data.records || []).map((record) => ({
          id: record.id,
          Name: record.fields?.Name || "Untitled",
          Type: record.fields?.Type || "Unknown",
          Description: record.fields?.Description || "",
          URL: record.fields?.URL || "",
          Category: record.fields?.Category || "Uncategorized",
          created: record.createdTime,
        }));

        return new Response(JSON.stringify(items, null, 2), {
          status: 200,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json",
            "Cache-Control": "public, max-age=300",
          },
        });
      } catch (error) {
        return new Response(
          JSON.stringify({
            error: "Directory request failed",
            details: error?.message || String(error),
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

    // =========================================================
    // POST /build-stack
    // =========================================================

    if (
      request.method === "POST" &&
      new URL(request.url).pathname === "/build-stack"
    ) {
      try {
        let body;

        try {
          body = await request.json();
        } catch {
          return jsonResponse(
            {
              error: "Invalid JSON request body.",
            },
            400,
            corsHeaders
          );
        }

        const goal = String(body?.goal || "").trim();

        if (!goal) {
          return jsonResponse(
            {
              error: "A workspace goal is required.",
            },
            400,
            corsHeaders
          );
        }

        // =====================================================
        // DISCOVER CURRENT FREE MODELS
        // =====================================================

        const freeModels = await discoverFreeModels(env);

        const models = buildModelList(freeModels);

        // =====================================================
        // LLM PROMPT
        // =====================================================
        //
        // IMPORTANT:
        // Keep the requested JSON compact.
        //
        // The Worker creates layers, architecture summary,
        // frontend structure, etc.
        //
        // The model's job is intelligence/discovery.
        // =====================================================

        const systemPrompt = `
You are the AI intelligence engine for Autonomous Work Space.

The user gives you a work goal.

Your job is to understand the goal and identify the agents and tools that would actually be useful for accomplishing it.

Use your knowledge of existing AI agents, AI tools, software platforms, automation systems, research tools, coding tools, databases, memory systems, communication systems, infrastructure, APIs and other technologies.

Think practically.

Do not assume a predefined directory.

Do not limit yourself to a fixed list of products.

Identify suitable real-world agents and tools when you know them.

The goal is to design a practical autonomous workspace, not merely recommend random AI products.

You must:

1. Understand the user's goal.
2. Identify the capabilities required.
3. Identify suitable agents.
4. Identify suitable tools.
5. Explain why each is useful.
6. Design the basic workflow.
7. Identify missing capabilities.
8. Suggest solutions for those gaps.
9. Perform a concise self-review.

IMPORTANT:

- Agents should perform reasoning, research, decision-making, creation, analysis, or autonomous work.
- Tools should provide capabilities such as search, browsing, storage, databases, automation, communication, scheduling, APIs, execution, monitoring, etc.
- Do not add components just to make the workspace larger.
- Prefer a small practical architecture when appropriate.
- Do not invent products.
- If you are uncertain about a specific product, use a capability-based recommendation instead.
- The architecture should make sense as a complete workflow.
- Recommendations must have real names.
- Never output "Recommended capability" as a placeholder.

RETURN ONLY VALID JSON.

Use this EXACT compact structure:

{
  "goal_understanding": "short explanation",

  "required_capabilities": [
    {
      "name": "capability name",
      "reason": "why it is required"
    }
  ],

  "agents": [
    {
      "name": "real agent or agent technology",
      "category": "category",
      "role": "what it does",
      "reason": "why it fits",
      "fit": "High"
    }
  ],

  "tools": [
    {
      "name": "real tool or technology",
      "category": "category",
      "role": "what it does",
      "reason": "why it fits",
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
      "name": "recommendation",
      "reason": "why",
      "priority": "High"
    }
  ],

  "self_review": {
    "summary": "short review",
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

Keep the response concise enough to fit reliably in one response.

Do not output markdown.
Do not output code fences.
Do not explain your answer outside the JSON.
`;

        const userPrompt = `
Build an autonomous workspace for this goal:

${goal}

Find the agents and tools that would be useful, design the workflow, identify gaps, propose solutions, and review the resulting architecture.

Return only the requested JSON.
`;

        // =====================================================
        // ASK OPENROUTER
        // =====================================================

        const result = await askFreeModels({
          env,
          models,
          systemPrompt,
          userPrompt,
        });

        if (!result.ok) {
          return jsonResponse(
            {
              error: "The workspace could not be built.",
              details: result.error,
              model_attempts: result.attempts,
            },
            502,
            corsHeaders
          );
        }

        // =====================================================
        // PARSE LLM RESULT
        // =====================================================

        let intelligence;

        try {
          intelligence = parseJSON(result.content);
        } catch (error) {
          return jsonResponse(
            {
              error: "The AI returned an invalid workspace result.",
              details: error?.message || String(error),
              model_used: result.model,
              model_attempts: result.attempts,
              response_preview: String(
                result.content || ""
              ).slice(0, 3000),
            },
            502,
            corsHeaders
          );
        }

        // =====================================================
        // BUILD FINAL WORKSPACE
        // =====================================================

        const architecture = buildWorkspace(
          goal,
          intelligence,
          result
        );

        return jsonResponse(
          {
            success: true,
            architecture,
          },
          200,
          corsHeaders
        );
      } catch (error) {
        return jsonResponse(
          {
            error: "The workspace builder encountered an unexpected error.",
            details: error?.message || String(error),
          },
          500,
          corsHeaders
        );
      }
    }

    // =========================================================
    // UNKNOWN ROUTE
    // =========================================================

    return new Response("Not found", {
      status: 404,
      headers: corsHeaders,
    });
  },
};


// =============================================================
// DISCOVER FREE OPENROUTER MODELS
// =============================================================

async function discoverFreeModels(env) {
  try {
    const response = await fetch(
      "https://openrouter.ai/api/v1/models",
      {
        method: "GET",
        headers: {
          Authorization:
            `Bearer ${env.OPENROUTER_API_KEY}`,
          "Content-Type": "application/json",
        },
      }
    );

    if (!response.ok) {
      return [];
    }

    const data = await response.json();

    const models = Array.isArray(data?.data)
      ? data.data
      : [];

    const free = [];

    for (const model of models) {
      const id = model?.id;

      if (!id || typeof id !== "string") {
        continue;
      }

      // Explicit :free models.
      if (id.endsWith(":free")) {
        free.push(id);
        continue;
      }

      // Explicit zero-priced models.
      const prompt =
        model?.pricing?.prompt;

      const completion =
        model?.pricing?.completion;

      if (
        (prompt === "0" || prompt === 0) &&
        (completion === "0" || completion === 0)
      ) {
        free.push(id);
      }
    }

    return [...new Set(free)];
  } catch {
    return [];
  }
}


// =============================================================
// MODEL LIST
// =============================================================

function buildModelList(freeModels) {
  const models = [];

  // Primary free router.
  models.push("openrouter/free");

  // Explicit free models.
  for (const model of freeModels || []) {
    if (!model) {
      continue;
    }

    if (!models.includes(model)) {
      models.push(model);
    }
  }

  // Do not make an enormous fallback list.
  return models.slice(0, 20);
}


// =============================================================
// ASK FREE MODELS
// =============================================================
//
// Strategy:
//
// 1. Try openrouter/free.
// 2. If it fails or produces unusable JSON,
//    try explicit free models one by one.
// 3. Stop as soon as a valid result is obtained.
//
// This is much closer to the successful Python scanner logic.
// =============================================================

async function askFreeModels({
  env,
  models,
  systemPrompt,
  userPrompt,
}) {
  const attempts = [];

  // ---------------------------------------------------------
  // FIRST: openrouter/free
  // ---------------------------------------------------------

  const first = await callModel({
    apiKey: env.OPENROUTER_API_KEY,
    model: "openrouter/free",
    systemPrompt,
    userPrompt,
  });

  attempts.push(first.attempt);

  if (first.ok) {
    return {
      ok: true,
      content: first.content,
      model: first.model,
      attempts,
    };
  }

  // ---------------------------------------------------------
  // NEXT: explicit free models
  // ---------------------------------------------------------

  for (const model of models || []) {
    if (
      !model ||
      model === "openrouter/free"
    ) {
      continue;
    }

    const result = await callModel({
      apiKey: env.OPENROUTER_API_KEY,
      model,
      systemPrompt,
      userPrompt,
    });

    attempts.push(result.attempt);

    if (result.ok) {
      return {
        ok: true,
        content: result.content,
        model: result.model,
        attempts,
      };
    }
  }

  return {
    ok: false,
    error:
      "No free OpenRouter model returned a valid workspace response.",
    attempts,
  };
}


// =============================================================
// SINGLE MODEL CALL
// =============================================================

async function callModel({
  apiKey,
  model,
  systemPrompt,
  userPrompt,
}) {
  const controller =
    new AbortController();

  const timeout = setTimeout(() => {
    controller.abort();
  }, 90000);

  try {
    const response = await fetch(
      "https://openrouter.ai/api/v1/chat/completions",
      {
        method: "POST",

        signal: controller.signal,

        headers: {
          Authorization:
            `Bearer ${apiKey}`,
          "Content-Type":
            "application/json",

          "HTTP-Referer":
            "https://autonomouswork-directory.pages.dev/",

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

          max_tokens: 7000,
        }),
      }
    );

    clearTimeout(timeout);

    const raw = await response.text();

    if (!response.ok) {
      return {
        ok: false,
        attempt: {
          model,
          success: false,
          status: response.status,
          error: raw.slice(0, 1000),
        },
      };
    }

    let data;

    try {
      data = JSON.parse(raw);
    } catch {
      return {
        ok: false,
        attempt: {
          model,
          success: false,
          error:
            "Provider response was not valid JSON.",
        },
      };
    }

    const content =
      extractContent(data);

    if (!content) {
      return {
        ok: false,
        attempt: {
          model,
          success: false,
          error:
            "Model returned no content.",
        },
      };
    }

    // -------------------------------------------------------
    // IMPORTANT:
    // Validate the model's actual JSON HERE.
    //
    // A model response is not considered successful merely
    // because HTTP returned 200.
    // -------------------------------------------------------

    try {
      parseJSON(content);
    } catch (error) {
      return {
        ok: false,
        attempt: {
          model,
          success: false,
          error:
            "Model returned unusable JSON: " +
            (error?.message || String(error)),
          response_preview:
            content.slice(0, 1200),
        },
      };
    }

    return {
      ok: true,

      content,

      model:
        data?.model ||
        model,

      attempt: {
        model:
          data?.model ||
          model,
        success: true,
        status: response.status,
      },
    };
  } catch (error) {
    clearTimeout(timeout);

    return {
      ok: false,

      attempt: {
        model,
        success: false,
        error:
          error?.name === "AbortError"
            ? "Request timed out."
            : error?.message ||
              String(error),
      },
    };
  }
}


// =============================================================
// EXTRACT MODEL CONTENT
// =============================================================

function extractContent(data) {
  const message =
    data?.choices?.[0]?.message;

  if (!message) {
    return "";
  }

  const content =
    message.content;

  if (typeof content === "string") {
    return content.trim();
  }

  if (Array.isArray(content)) {
    let output = "";

    for (const block of content) {
      if (typeof block === "string") {
        output += block;
        continue;
      }

      if (
        typeof block?.text === "string"
      ) {
        output += block.text;
        continue;
      }

      if (
        typeof block?.content === "string"
      ) {
        output += block.content;
      }
    }

    return output.trim();
  }

  return "";
}


// =============================================================
// ROBUST JSON PARSER
// =============================================================

function parseJSON(text) {
  if (!text || typeof text !== "string") {
    throw new Error(
      "Empty model response."
    );
  }

  let cleaned =
    text.trim();

  // Remove markdown fences.
  cleaned = cleaned
    .replace(
      /^```json\s*/i,
      ""
    )
    .replace(
      /^```\s*/i,
      ""
    )
    .replace(
      /\s*```$/i,
      ""
    )
    .trim();

  // Direct JSON.
  try {
    return JSON.parse(cleaned);
  } catch {
    // Continue.
  }

  // ---------------------------------------------------------
  // Find JSON object inside surrounding text.
  // ---------------------------------------------------------

  const start =
    cleaned.indexOf("{");

  if (start === -1) {
    throw new Error(
      "No JSON object found."
    );
  }

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (
    let i = start;
    i < cleaned.length;
    i++
  ) {
    const char =
      cleaned[i];

    if (escaped) {
      escaped = false;
      continue;
    }

    if (char === "\\") {
      escaped = true;
      continue;
    }

    if (char === '"') {
      inString = !inString;
      continue;
    }

    if (inString) {
      continue;
    }

    if (char === "{") {
      depth++;
    }

    if (char === "}") {
      depth--;

      if (depth === 0) {
        const candidate =
          cleaned.slice(
            start,
            i + 1
          );

        try {
          return JSON.parse(
            candidate
          );
        } catch {
          break;
        }
      }
    }
  }

  throw new Error(
    "Could not extract valid JSON from model response."
  );
}


// =============================================================
// BUILD WORKSPACE
// =============================================================
//
// The model supplies the intelligence.
// The Worker supplies the predictable frontend structure.
//
// This prevents the model from having to generate a huge,
// deeply nested frontend object.
// =============================================================

function buildWorkspace(
  goal,
  intelligence,
  result
) {
  const agents =
    normalizeAgents(
      intelligence?.agents
    );

  const tools =
    normalizeTools(
      intelligence?.tools
    );

  const capabilities =
    normalizeCapabilities(
      intelligence?.required_capabilities
    );

  const gaps =
    normalizeGaps(
      intelligence?.gaps
    );

  const recommendations =
    normalizeRecommendations(
      intelligence?.recommendations
    );

  const workflow =
    normalizeWorkflow(
      intelligence?.workflow
    );

  // ---------------------------------------------------------
  // DYNAMIC LAYERS
  // ---------------------------------------------------------

  const layers =
    createDynamicLayers({
      agents,
      tools,
      workflow,
      capabilities,
      gaps,
    });

  // ---------------------------------------------------------
  // CONNECTIONS
  // ---------------------------------------------------------

  const connections =
    createConnections(
      layers
    );

  // ---------------------------------------------------------
  // REVIEW
  // ---------------------------------------------------------

  const selfReview =
    intelligence?.self_review &&
    typeof intelligence.self_review ===
      "object"
      ? intelligence.self_review
      : {};

  const review = {
    summary:
      selfReview.summary ||
      "The workspace was reviewed for capability coverage, component fit, gaps and practical autonomy.",

    strengths:
      Array.isArray(
        selfReview.strengths
      )
        ? selfReview.strengths
        : [],

    improvements:
      Array.isArray(
        selfReview.improvements
      )
        ? selfReview.improvements
        : [],

    remaining_gaps:
      Array.isArray(
        selfReview.remaining_gaps
      )
        ? selfReview.remaining_gaps
        : gaps.map(
            (gap) => gap.name
          ),
  };

  // ---------------------------------------------------------
  // FINAL ARCHITECTURE
  // ---------------------------------------------------------

  const finalArchitecture = {
    agents:
      agents.map(
        (agent) =>
          agent.name
      ),

    tools:
      tools.map(
        (tool) =>
          tool.name
      ),

    connections,
  };

  // ---------------------------------------------------------
  // ARCHITECTURE SUMMARY
  // ---------------------------------------------------------

  const architectureSummary =
    buildSummary({
      agents,
      tools,
      layers,
      goal,
    });

  return {
    goal,

    goal_understanding:
      intelligence?.goal_understanding ||
      "The goal was analyzed by the AI workspace planner.",

    required_capabilities:
      capabilities,

    agents,

    tools,

    layers,

    architecture_summary:
      architectureSummary,

    workflow,

    component_evaluation:
      createComponentEvaluation(
        agents,
        tools
      ),

    capability_gaps:
      gaps,

    gap_solutions:
      gaps.map(
        (gap) => ({
          problem:
            gap.name,
          solution:
            gap.solution,
          components_added_or_changed:
            [],
        })
      ),

    final_architecture:
      finalArchitecture,

    autonomy_logic:
      buildAutonomyLogic(
        layers
      ),

    failure_recovery:
      buildFailureRecovery(),

    human_involvement:
      buildHumanInvolvement(),

    recommendations,

    external_recommendations:
      recommendations,

    review,

    model_used:
      result.model,

    model_attempts:
      result.attempts,

    builder_version:
      "V8",

    builder_mode:
      "LLM-first autonomous workspace discovery",
  };
}


// =============================================================
// NORMALIZE AGENTS
// =============================================================

function normalizeAgents(
  agents
) {
  if (!Array.isArray(agents)) {
    return [];
  }

  return agents
    .map((agent) => {
      if (typeof agent === "string") {
        return {
          name: agent,
          type: "Agent",
          category:
            "General",
          role: agent,
          reason:
            "Selected as a useful autonomous component.",
          fit: "Medium",
        };
      }

      if (
        !agent ||
        typeof agent !== "object"
      ) {
        return null;
      }

      const name =
        agent.name ||
        agent.agent ||
        "";

      if (!name) {
        return null;
      }

      return {
        name,
        type: "Agent",
        category:
          agent.category ||
          "General",
        role:
          agent.role ||
          "Autonomous task execution",
        reason:
          agent.reason ||
          "Selected for the workspace.",
        fit:
          normalizeFit(
            agent.fit
          ),
      };
    })
    .filter(Boolean);
}


// =============================================================
// NORMALIZE TOOLS
// =============================================================

function normalizeTools(
  tools
) {
  if (!Array.isArray(tools)) {
    return [];
  }

  return tools
    .map((tool) => {
      if (typeof tool === "string") {
        return {
          name: tool,
          type: "Tool",
          category:
            "General",
          role: tool,
          reason:
            "Selected as a useful workspace capability.",
          fit: "Medium",
        };
      }

      if (
        !tool ||
        typeof tool !== "object"
      ) {
        return null;
      }

      const name =
        tool.name ||
        tool.tool ||
        "";

      if (!name) {
        return null;
      }

      return {
        name,
        type: "Tool",
        category:
          tool.category ||
          "General",
        role:
          tool.role ||
          "Workspace capability",
        reason:
          tool.reason ||
          "Selected for the workspace.",
        fit:
          normalizeFit(
            tool.fit
          ),
      };
    })
    .filter(Boolean);
}


// =============================================================
// NORMALIZE CAPABILITIES
// =============================================================

function normalizeCapabilities(
  capabilities
) {
  if (!Array.isArray(capabilities)) {
    return [];
  }

  return capabilities
    .map((item) => {
      if (typeof item === "string") {
        return {
          name: item,
          reason:
            "Required by the workspace goal.",
        };
      }

      if (
        !item ||
        typeof item !== "object"
      ) {
        return null;
      }

      const name =
        item.name ||
        item.capability ||
        "";

      if (!name) {
        return null;
      }

      return {
        name,
        reason:
          item.reason ||
          "Required by the workspace goal.",
      };
    })
    .filter(Boolean);
}


// =============================================================
// NORMALIZE GAPS
// =============================================================

function normalizeGaps(
  gaps
) {
  if (!Array.isArray(gaps)) {
    return [];
  }

  return gaps
    .map((gap) => {
      if (typeof gap === "string") {
        return {
          name: gap,
          reason:
            "This capability may be missing.",
          solution:
            "Add an appropriate component or workflow step.",
        };
      }

      if (
        !gap ||
        typeof gap !== "object"
      ) {
        return null;
      }

      const name =
        gap.name ||
        gap.capability ||
        "";

      if (!name) {
        return null;
      }

      return {
        name,
        reason:
          gap.reason ||
          "This capability may be missing.",
        solution:
          gap.solution ||
          "Add an appropriate component or workflow step.",
      };
    })
    .filter(Boolean);
}


// =============================================================
// NORMALIZE RECOMMENDATIONS
// =============================================================

function normalizeRecommendations(
  recommendations
) {
  if (!Array.isArray(recommendations)) {
    return [];
  }

  return recommendations
    .map((item) => {
      if (typeof item === "string") {
        const name =
          item.trim();

        if (
          !name ||
          /^recommended capability$/i.test(
            name
          )
        ) {
          return null;
        }

        return {
          name,
          reason:
            "Potentially useful addition to the workspace.",
          priority:
            "Medium",
        };
      }

      if (
        !item ||
        typeof item !== "object"
      ) {
        return null;
      }

      const name =
        item.name ||
        item.capability ||
        item.title ||
        "";

      if (!name) {
        return null;
      }

      return {
        name,
        reason:
          item.reason ||
          item.description ||
          "Potentially useful addition to the workspace.",
        priority:
          normalizePriority(
            item.priority
          ),
      };
    })
    .filter(Boolean);
}


// =============================================================
// NORMALIZE WORKFLOW
// =============================================================

function normalizeWorkflow(
  workflow
) {
  if (!Array.isArray(workflow)) {
    return [];
  }

  return workflow
    .map((step, index) => {
      if (typeof step === "string") {
        return {
          step:
            index + 1,
          component:
            step,
          action:
            step,
          reason:
            "",
        };
      }

      if (
        !step ||
        typeof step !== "object"
      ) {
        return null;
      }

      return {
        step:
          Number(step.step) ||
          index + 1,

        component:
          step.component ||
          step.name ||
          "Workspace",

        action:
          step.action ||
          "Execute workflow stage.",

        reason:
          step.reason ||
          "",
      };
    })
    .filter(Boolean);
}


// =============================================================
// DYNAMIC LAYERS
// =============================================================
//
// Layers are created from the actual components and workflow.
// They are NOT a fixed five-layer template.
// =============================================================

function createDynamicLayers({
  agents,
  tools,
  workflow,
  capabilities,
  gaps,
}) {
  const layers = [];

  const used = new Set();

  // ---------------------------------------------------------
  // Helper
  // ---------------------------------------------------------

  function addLayer(
    name,
    purpose,
    componentNames
  ) {
    const unique = [
      ...new Set(
        (componentNames || [])
          .filter(Boolean)
      ),
    ];

    if (unique.length === 0) {
      return;
    }

    const components =
      unique.map((name) => {
        const agent =
          agents.find(
            (item) =>
              item.name === name
          );

        if (agent) {
          used.add(name);

          return {
            name,
            type: "Agent",
            role:
              agent.role,
            reason:
              agent.reason,
          };
        }

        const tool =
          tools.find(
            (item) =>
              item.name === name
          );

        if (tool) {
          used.add(name);

          return {
            name,
            type: "Tool",
            role:
              tool.role,
            reason:
              tool.reason,
          };
        }

        return {
          name,
          type: "Tool",
          role:
            "Workspace component",
          reason:
            "Included as part of this functional layer.",
        };
      });

    layers.push({
      name,
      purpose,
      order:
        layers.length + 1,
      components,
      inputs:
        layers.length === 0
          ? [
              "User goal"
            ]
          : [
              "Previous layer output"
            ],
      outputs: [
        "Processed output for next stage",
      ],
    });
  }

  // ---------------------------------------------------------
  // Discover functional groups from component roles.
  // ---------------------------------------------------------

  const allAgents =
    agents || [];

  const allTools =
    tools || [];

  const discovery = [
    ...allAgents
      .filter((x) =>
        /research|discover|search|browser|scan|collect|gather|source/i.test(
          `${x.name} ${x.role}`
        )
      )
      .map(
        (x) => x.name
      ),

    ...allTools
      .filter((x) =>
        /research|search|browser|crawl|scrap|source|retrieve|discover/i.test(
          `${x.name} ${x.role}`
        )
      )
      .map(
        (x) => x.name
      ),
  ];

  addLayer(
    "Discovery",
    "Finds and gathers the information required to perform the user's work.",
    discovery
  );

  const reasoning = [
    ...allAgents
      .filter((x) =>
        /reason|analys|evaluate|compare|plan|decision|code|research|orchestrat/i.test(
          `${x.name} ${x.role}`
        )
      )
      .map(
        (x) => x.name
      ),

    ...allTools
      .filter((x) =>
        /model|llm|reason|analysis|orchestrat|processing/i.test(
          `${x.name} ${x.role}`
        )
      )
      .map(
        (x) => x.name
      ),
  ];

  addLayer(
    "Reasoning & Analysis",
    "Processes information, performs reasoning, evaluation, planning, and decisions.",
    reasoning
  );

  const memory = [
    ...allTools
      .filter((x) =>
        /memory|database|storage|knowledge|vector|store|retrieval/i.test(
          `${x.name} ${x.category} ${x.role}`
        )
      )
      .map(
        (x) => x.name
      ),

    ...allAgents
      .filter((x) =>
        /memory|knowledge/i.test(
          `${x.name} ${x.role}`
        )
      )
      .map(
        (x) => x.name
      ),
  ];

  addLayer(
    "Memory & Knowledge",
    "Stores and retrieves information needed for continued autonomous operation.",
    memory
  );

  const execution = [
    ...allAgents
      .filter((x) =>
        /automation|execute|action|browser|workflow|operation/i.test(
          `${x.name} ${x.role}`
        )
      )
      .map(
        (x) => x.name
      ),

    ...allTools
      .filter((x) =>
        /automation|execution|integration|workflow|api|browser|orchestrat/i.test(
          `${x.name} ${x.category} ${x.role}`
        )
      )
      .map(
        (x) => x.name
      ),
  ];

  addLayer(
    "Execution & Automation",
    "Carries out actions, integrations, and autonomous workflow execution.",
    execution
  );

  const output = [
    ...allAgents
      .filter((x) =>
        /report|writer|content|communication|deliver|publish|support|sales|marketing/i.test(
          `${x.name} ${x.role}`
        )
      )
      .map(
        (x) => x.name
      ),

    ...allTools
      .filter((x) =>
        /communication|notification|email|report|delivery|publish|productivity/i.test(
          `${x.name} ${x.category} ${x.role}`
        )
      )
      .map(
        (x) => x.name
      ),
  ];

  addLayer(
    "Output & Delivery",
    "Transforms completed work into useful outputs and delivers them.",
    output
  );

  const monitoring = [
    ...allAgents
      .filter((x) =>
        /monitor|review|critic|quality|supervis|control/i.test(
          `${x.name} ${x.role}`
        )
      )
      .map(
        (x) => x.name
      ),

    ...allTools
      .filter((x) =>
        /monitor|logging|observability|quality|alert|notification/i.test(
          `${x.name} ${x.category} ${x.role}`
        )
      )
      .map(
        (x) => x.name
      ),
  ];

  addLayer(
    "Monitoring & Recovery",
    "Monitors the workspace, detects failures, and supports recovery and quality control.",
    monitoring
  );

  // ---------------------------------------------------------
  // Put unused components into a useful additional layer.
  // ---------------------------------------------------------

  const remaining = [
    ...allAgents
      .map(
        (x) => x.name
      ),
    ...allTools
      .map(
        (x) => x.name
      ),
  ].filter(
    (name) => !used.has(name)
  );

  if (remaining.length > 0) {
    addLayer(
      "Supporting Components",
      "Provides additional capabilities required by the workspace.",
      remaining
    );
  }

  // ---------------------------------------------------------
  // If there are no components, create a capability layer.
  // ---------------------------------------------------------

  if (
    layers.length === 0 &&
    capabilities.length > 0
  ) {
    addLayer(
      "Core Workspace",
      "Provides the capabilities required for the user's goal.",
      capabilities.map(
        (x) => x.name
      )
    );
  }

  // ---------------------------------------------------------
  // If workflow provides useful stages, enrich layer inputs.
  // ---------------------------------------------------------

  if (
    workflow.length > 0 &&
    layers.length > 0
  ) {
    for (
      let i = 0;
      i < layers.length;
      i++
    ) {
      const step =
        workflow[i];

      if (step) {
        layers[i].workflow_step =
          step.action;
      }
    }
  }

  // ---------------------------------------------------------
  // Gap information.
  // ---------------------------------------------------------

  if (
    gaps.length > 0 &&
    layers.length > 0
  ) {
    layers[layers.length - 1].gaps =
      gaps.map(
        (gap) => gap.name
      );
  }

  return layers;
}


// =============================================================
// CONNECTIONS
// =============================================================

function createConnections(
  layers
) {
  const connections = [];

  for (
    let i = 0;
    i < layers.length - 1;
    i++
  ) {
    connections.push({
      from:
        layers[i].name,

      to:
        layers[i + 1].name,

      purpose:
        `Pass relevant output from ${layers[i].name} to ${layers[i + 1].name}.`,
    });
  }

  return connections;
}


// =============================================================
// COMPONENT EVALUATION
// =============================================================

function createComponentEvaluation(
  agents,
  tools
) {
  const result = [];

  for (const component of [
    ...agents,
    ...tools,
  ]) {
    result.push({
      component:
        component.name,

      responsibility:
        component.role,

      match:
        component.fit,

      evaluation:
        component.reason,
    });
  }

  return result;
}


// =============================================================
// SUMMARY
// =============================================================

function buildSummary({
  agents,
  tools,
  layers,
  goal,
}) {
  return (
    `The workspace for "${goal}" uses ` +
    `${agents.length} agents and ` +
    `${tools.length} tools across ` +
    `${layers.length} dynamically designed layers. ` +
    `The layers organize discovery, reasoning, memory, execution, delivery, monitoring, or other functions according to the actual components selected for the goal.`
  );
}


// =============================================================
// AUTONOMY LOGIC
// =============================================================

function buildAutonomyLogic(
  layers
) {
  if (!layers.length) {
    return "";
  }

  return (
    "The workspace operates as a connected pipeline in which " +
    layers
      .map(
        (layer) =>
          layer.name
      )
      .join(
        " → "
      ) +
    ". Each layer receives relevant output from the preceding stage and contributes to the next stage."
  );
}


// =============================================================
// FAILURE RECOVERY
// =============================================================

function buildFailureRecovery() {
  return (
    "Individual component failures should be isolated where possible. " +
    "The workflow should retry failed operations, use alternative components when available, " +
    "preserve intermediate results, and escalate unresolved issues for human review."
  );
}


// =============================================================
// HUMAN INVOLVEMENT
// =============================================================

function buildHumanInvolvement() {
  return (
    "Human involvement should be limited to decisions that require judgment, approval, " +
    "credentials, sensitive actions, or review of unresolved exceptions."
  );
}


// =============================================================
// NORMALIZE FIT
// =============================================================

function normalizeFit(
  value
) {
  const v =
    String(
      value || ""
    ).toLowerCase();

  if (v === "high") {
    return "High";
  }

  if (v === "low") {
    return "Low";
  }

  return "Medium";
}


// =============================================================
// NORMALIZE PRIORITY
// =============================================================

function normalizePriority(
  value
) {
  const v =
    String(
      value || ""
    ).toLowerCase();

  if (v === "high") {
    return "High";
  }

  if (v === "low") {
    return "Low";
  }

  return "Medium";
}


// =============================================================
// JSON RESPONSE
// =============================================================

function jsonResponse(
  data,
  status,
  corsHeaders
) {
  return new Response(
    JSON.stringify(
      data,
      null,
      2
    ),
    {
      status,
      headers: {
        ...corsHeaders,
        "Content-Type":
          "application/json",
      },
    }
  );
}
