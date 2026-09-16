export default {
  async fetch(request, env) {
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };

    // ========================================================
    // CORS
    // ========================================================

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders,
      });
    }

    // ========================================================
    // GET
    // ========================================================
    // Airtable remains ONLY for the public directory.
    //
    // The Stack Builder does NOT use Airtable.
    // ========================================================

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

    // ========================================================
    // POST /build-stack
    // ========================================================

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

        // ====================================================
        // DISCOVER FREE OPENROUTER MODELS
        // ====================================================

        const freeModels = await discoverFreeModels(env);

        // ====================================================
        // BUILD MODEL FALLBACK LIST
        // ====================================================

        const fallbackModels = buildFallbackModels(freeModels);

        // ====================================================
        // SYSTEM PROMPT
        // ====================================================

        const systemPrompt = `
You are the core intelligence engine for Autonomous Work Space.

Your task is to transform a user's natural-language work goal into a practical autonomous workspace.

The workspace should be designed specifically around the user's goal.

Do not assume that the workspace must use a predefined directory.

You may identify suitable agents, tools, platforms, services, infrastructure, databases, APIs, automation systems, research systems, coding systems, communication systems, memory systems, orchestration systems, and other technologies from your knowledge.

The architecture should be realistic and internally consistent.

Think through the complete problem before producing the final JSON.

Your internal process should include:

1. Understand the user's goal.
2. Determine what work actually needs to be performed.
3. Identify the capabilities required.
4. Identify suitable agents and tools.
5. Design the workspace architecture.
6. Organize the architecture into logical layers.
7. Evaluate whether each selected component matches its responsibility.
8. Identify capability gaps.
9. Solve those gaps.
10. Rebuild or improve the architecture where necessary.
11. Perform a final self-review.
12. Return the final architecture.

IMPORTANT:

- Do not add components simply to make the architecture look impressive.
- Use only components that have a meaningful role.
- A small architecture is acceptable when the goal is simple.
- A complex architecture is acceptable when the goal genuinely requires it.
- Distinguish agents from tools.
- Agents perform reasoning, decision-making, research, creation, analysis, or autonomous work.
- Tools provide capabilities, infrastructure, integrations, storage, communication, execution, monitoring, scheduling, retrieval, etc.
- Think about repeated autonomous operation.
- Think about inputs, processing, decisions, actions, outputs, memory, monitoring and recovery when relevant.
- Do not invent nonexistent products.
- If uncertain about an exact product capability, describe the required capability rather than inventing unsupported details.
- Keep the final architecture internally consistent.
- Components mentioned in the layers should correspond to the agents/tools in the architecture.
- Capability recommendations must have actual names and explanations.
- Never use generic placeholder text such as "Recommended capability".
- Layers must be dynamically designed around the actual workflow. Do not always use the same fixed number of layers.

The output MUST be valid JSON.

Return this exact overall structure:

{
  "goal": "...",

  "goal_understanding": "...",

  "required_capabilities": [
    {
      "capability": "...",
      "reason": "..."
    }
  ],

  "agents": [
    {
      "name": "...",
      "type": "Agent",
      "category": "...",
      "role": "...",
      "reason": "...",
      "fit": "High|Medium|Low"
    }
  ],

  "tools": [
    {
      "name": "...",
      "type": "Tool",
      "category": "...",
      "role": "...",
      "reason": "...",
      "fit": "High|Medium|Low"
    }
  ],

  "layers": [
    {
      "name": "...",
      "purpose": "...",
      "order": 1,
      "components": [
        {
          "name": "...",
          "type": "Agent|Tool",
          "role": "...",
          "reason": "..."
        }
      ],
      "inputs": ["..."],
      "outputs": ["..."]
    }
  ],

  "architecture_summary": "...",

  "workflow": [
    {
      "step": 1,
      "component": "...",
      "action": "...",
      "reason": "..."
    }
  ],

  "component_evaluation": [
    {
      "component": "...",
      "responsibility": "...",
      "match": "High|Medium|Low",
      "evaluation": "..."
    }
  ],

  "capability_gaps": [
    {
      "gap": "...",
      "impact": "...",
      "solution": "..."
    }
  ],

  "gap_solutions": [
    {
      "problem": "...",
      "solution": "...",
      "components_added_or_changed": ["..."]
    }
  ],

  "final_architecture": {
    "agents": ["..."],
    "tools": ["..."],
    "connections": [
      {
        "from": "...",
        "to": "...",
        "purpose": "..."
      }
    ]
  },

  "autonomy_logic": "...",

  "failure_recovery": "...",

  "human_involvement": "...",

  "recommendations": [
    {
      "name": "...",
      "reason": "...",
      "priority": "High|Medium|Low"
    }
  ],

  "external_recommendations": [
    {
      "name": "...",
      "type": "Agent|Tool|Platform|Service|Other",
      "reason": "...",
      "use_for": "..."
    }
  ],

  "review": {
    "summary": "...",
    "strengths": [
      "..."
    ],
    "improvements": [
      "..."
    ],
    "remaining_gaps": [
      "..."
    ]
  }
}

VERY IMPORTANT:

The "layers" array is required.

Do not return an empty layers array unless the goal genuinely requires no architecture.

Every layer must represent a real functional stage or subsystem of the workspace.

The number of layers must be determined by the goal.

The "recommendations" array must contain objects with:
- name
- reason
- priority

The "external_recommendations" array must contain objects with:
- name
- type
- reason
- use_for

Never return repeated generic text.

Return ONLY JSON.
Do not return markdown.
Do not return code fences.
Do not provide commentary outside the JSON.
`;

        // ====================================================
        // USER PROMPT
        // ====================================================

        const userPrompt = `
USER WORKSPACE GOAL:

${goal}

Design the complete autonomous workspace for this goal.

Internally perform:

GOAL UNDERSTANDING
→ CAPABILITY IDENTIFICATION
→ AGENT AND TOOL DISCOVERY
→ ARCHITECTURE DESIGN
→ DYNAMIC LAYER DESIGN
→ COMPONENT EVALUATION
→ GAP IDENTIFICATION
→ GAP SOLVING
→ FINAL ARCHITECTURE
→ SELF-REVIEW

The final JSON must represent the complete result of that process.
`;

        // ====================================================
        // CALL OPENROUTER
        // ====================================================

        const result = await callOpenRouter({
          env,
          systemPrompt,
          userPrompt,
          fallbackModels,
        });

        if (!result.ok) {
          return jsonResponse(
            {
              error: "The workspace could not be built.",
              details: result.error,
              model_attempts: result.attempts || [],
            },
            502,
            corsHeaders
          );
        }

        // ====================================================
        // PARSE JSON
        // ====================================================

        let architecture;

        try {
          architecture = extractJSON(result.content);
        } catch (error) {
          return jsonResponse(
            {
              error: "The AI returned an invalid workspace result.",
              details: error?.message || String(error),
              model_used: result.model,
              model_attempts: result.attempts || [],
              raw_preview: String(result.content || "").slice(0, 3000),
            },
            502,
            corsHeaders
          );
        }

        // ====================================================
        // NORMALIZE FRONTEND STRUCTURE
        // ====================================================

        architecture = normalizeArchitecture(
          architecture,
          goal,
          result.model,
          result.attempts
        );

        // ====================================================
        // RETURN
        // ====================================================

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

    // ========================================================
    // UNKNOWN ROUTE
    // ========================================================

    return new Response("Not found", {
      status: 404,
      headers: corsHeaders,
    });
  },
};


// ============================================================
// FREE MODEL DISCOVERY
// ============================================================

async function discoverFreeModels(env) {
  const modelsUrl = "https://openrouter.ai/api/v1/models";

  try {
    const response = await fetch(modelsUrl, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${env.OPENROUTER_API_KEY}`,
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      return [];
    }

    const data = await response.json();

    const models = Array.isArray(data?.data)
      ? data.data
      : [];

    const freeModels = [];

    for (const model of models) {
      const id = model?.id;

      if (!id || typeof id !== "string") {
        continue;
      }

      // Explicit free model variants.
      if (id.endsWith(":free")) {
        freeModels.push(id);
        continue;
      }

      // Explicitly zero-priced models.
      const promptPrice = model?.pricing?.prompt;
      const completionPrice = model?.pricing?.completion;

      if (
        (promptPrice === "0" || promptPrice === 0) &&
        (completionPrice === "0" || completionPrice === 0)
      ) {
        freeModels.push(id);
      }
    }

    return [...new Set(freeModels)];
  } catch {
    return [];
  }
}


// ============================================================
// MODEL FALLBACK LIST
// ============================================================

function buildFallbackModels(freeModels) {
  const models = [];

  // First choice.
  models.push("openrouter/free");

  // Explicitly discovered free models.
  for (const model of freeModels || []) {
    if (!model || typeof model !== "string") {
      continue;
    }

    if (model === "openrouter/free") {
      continue;
    }

    if (!models.includes(model)) {
      models.push(model);
    }
  }

  // Avoid an unnecessarily huge fallback request.
  return models.slice(0, 25);
}


// ============================================================
// OPENROUTER CALL
// ============================================================

async function callOpenRouter({
  env,
  systemPrompt,
  userPrompt,
  fallbackModels,
}) {
  const apiKey = env.OPENROUTER_API_KEY;

  if (!apiKey) {
    return {
      ok: false,
      error: "OPENROUTER_API_KEY is not configured.",
      attempts: [],
    };
  }

  const models =
    Array.isArray(fallbackModels) && fallbackModels.length
      ? fallbackModels
      : ["openrouter/free"];

  const attempts = [];

  // ----------------------------------------------------------
  // FIRST:
  // Native OpenRouter fallback.
  // ----------------------------------------------------------

  const nativeResult = await requestOpenRouter({
    apiKey,
    models,
    systemPrompt,
    userPrompt,
  });

  attempts.push(...nativeResult.attempts);

  if (nativeResult.ok) {
    return nativeResult;
  }

  // ----------------------------------------------------------
  // SECOND:
  // Explicit individual free-model recovery.
  // ----------------------------------------------------------

  for (const model of models) {
    if (!model || model === "openrouter/free") {
      continue;
    }

    const result = await requestOpenRouter({
      apiKey,
      models: [model],
      systemPrompt,
      userPrompt,
    });

    attempts.push(...result.attempts);

    if (result.ok) {
      return {
        ...result,
        attempts,
      };
    }
  }

  return {
    ok: false,
    error:
      nativeResult.error ||
      "All available free OpenRouter model attempts failed.",
    attempts,
  };
}


// ============================================================
// SINGLE OPENROUTER REQUEST
// ============================================================

async function requestOpenRouter({
  apiKey,
  models,
  systemPrompt,
  userPrompt,
}) {
  const url =
    "https://openrouter.ai/api/v1/chat/completions";

  const attempts = [];

  const controller = new AbortController();

  // 90-second timeout.
  const timeout = setTimeout(() => {
    controller.abort();
  }, 90000);

  try {
    const response = await fetch(url, {
      method: "POST",
      signal: controller.signal,

      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer":
          "https://autonomouswork-directory.pages.dev/",
        "X-Title": "Autonomous Work Space",
      },

      body: JSON.stringify({
        models,

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

        max_tokens: 10000,
      }),
    });

    clearTimeout(timeout);

    const rawText = await response.text();

    if (!response.ok) {
      attempts.push({
        models,
        success: false,
        status: response.status,
        error: rawText.slice(0, 1500),
      });

      return {
        ok: false,
        error:
          `OpenRouter request failed with HTTP ${response.status}.`,
        attempts,
      };
    }

    let data;

    try {
      data = JSON.parse(rawText);
    } catch {
      attempts.push({
        models,
        success: false,
        status: response.status,
        error:
          "OpenRouter returned invalid JSON.",
      });

      return {
        ok: false,
        error:
          "OpenRouter returned invalid JSON.",
        attempts,
      };
    }

    const content = extractAssistantContent(data);

    if (!content) {
      attempts.push({
        models,
        success: false,
        status: response.status,
        error:
          "No assistant content returned.",
      });

      return {
        ok: false,
        error:
          "OpenRouter returned no assistant content.",
        attempts,
      };
    }

    const modelUsed =
      data?.model ||
      data?.choices?.[0]?.model ||
      models?.[0] ||
      "unknown";

    attempts.push({
      models,
      success: true,
      status: response.status,
      model: modelUsed,
    });

    return {
      ok: true,
      content,
      model: modelUsed,
      attempts,
    };
  } catch (error) {
    clearTimeout(timeout);

    const message =
      error?.name === "AbortError"
        ? "OpenRouter request timed out after 90 seconds."
        : error?.message || String(error);

    attempts.push({
      models,
      success: false,
      error: message,
    });

    return {
      ok: false,
      error: message,
      attempts,
    };
  }
}


// ============================================================
// EXTRACT ASSISTANT CONTENT
// ============================================================

function extractAssistantContent(data) {
  const message =
    data?.choices?.[0]?.message;

  if (!message) {
    return "";
  }

  const content = message.content;

  if (typeof content === "string") {
    return content.trim();
  }

  if (Array.isArray(content)) {
    let combined = "";

    for (const block of content) {
      if (typeof block === "string") {
        combined += block;
        continue;
      }

      if (typeof block?.text === "string") {
        combined += block.text;
        continue;
      }

      if (typeof block?.content === "string") {
        combined += block.content;
      }
    }

    return combined.trim();
  }

  return "";
}


// ============================================================
// JSON EXTRACTION
// ============================================================

function extractJSON(text) {
  if (!text || typeof text !== "string") {
    throw new Error("Empty AI response.");
  }

  let cleaned = text.trim();

  // Remove markdown fences if a model added them.
  cleaned = cleaned
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  // Try entire response.
  try {
    return JSON.parse(cleaned);
  } catch {
    // Continue.
  }

  const firstObject = cleaned.indexOf("{");

  if (firstObject === -1) {
    throw new Error(
      "No JSON object found in AI response."
    );
  }

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (
    let i = firstObject;
    i < cleaned.length;
    i++
  ) {
    const char = cleaned[i];

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
          cleaned.slice(firstObject, i + 1);

        try {
          return JSON.parse(candidate);
        } catch {
          break;
        }
      }
    }
  }

  throw new Error(
    "Could not parse a valid JSON object from AI response."
  );
}


// ============================================================
// NORMALIZE ARCHITECTURE
// ============================================================

function normalizeArchitecture(
  architecture,
  goal,
  modelUsed,
  attempts
) {
  if (
    !architecture ||
    typeof architecture !== "object"
  ) {
    architecture = {};
  }

  // ----------------------------------------------------------
  // BASIC
  // ----------------------------------------------------------

  architecture.goal =
    architecture.goal || goal;

  architecture.goal_understanding =
    architecture.goal_understanding ||
    "The AI analyzed the requested workspace goal.";

  // ----------------------------------------------------------
  // CAPABILITIES
  // ----------------------------------------------------------

  architecture.required_capabilities =
    normalizeCapabilities(
      architecture.required_capabilities
    );

  // ----------------------------------------------------------
  // AGENTS
  // ----------------------------------------------------------

  architecture.agents =
    normalizeComponents(
      architecture.agents,
      "Agent"
    );

  // ----------------------------------------------------------
  // TOOLS
  // ----------------------------------------------------------

  architecture.tools =
    normalizeComponents(
      architecture.tools,
      "Tool"
    );

  // ----------------------------------------------------------
  // LAYERS
  // ----------------------------------------------------------

  architecture.layers =
    normalizeLayers(
      architecture.layers,
      architecture.agents,
      architecture.tools,
      architecture.workflow,
      architecture.goal_understanding
    );

  // ----------------------------------------------------------
  // ARCHITECTURE SUMMARY
  // ----------------------------------------------------------

  architecture.architecture_summary =
    architecture.architecture_summary ||
    buildArchitectureSummary(
      architecture.layers,
      architecture.agents,
      architecture.tools
    );

  // ----------------------------------------------------------
  // WORKFLOW
  // ----------------------------------------------------------

  architecture.workflow =
    normalizeWorkflow(
      architecture.workflow,
      architecture.layers
    );

  // ----------------------------------------------------------
  // COMPONENT EVALUATION
  // ----------------------------------------------------------

  architecture.component_evaluation =
    Array.isArray(
      architecture.component_evaluation
    )
      ? architecture.component_evaluation
      : [];

  // ----------------------------------------------------------
  // GAPS
  // ----------------------------------------------------------

  architecture.capability_gaps =
    Array.isArray(
      architecture.capability_gaps
    )
      ? architecture.capability_gaps
      : [];

  architecture.gap_solutions =
    Array.isArray(
      architecture.gap_solutions
    )
      ? architecture.gap_solutions
      : [];

  // ----------------------------------------------------------
  // FINAL ARCHITECTURE
  // ----------------------------------------------------------

  if (
    !architecture.final_architecture ||
    typeof architecture.final_architecture !==
      "object"
  ) {
    architecture.final_architecture = {};
  }

  architecture.final_architecture.agents =
    Array.isArray(
      architecture.final_architecture.agents
    )
      ? architecture.final_architecture.agents
      : architecture.agents.map(
          (agent) => agent.name
        );

  architecture.final_architecture.tools =
    Array.isArray(
      architecture.final_architecture.tools
    )
      ? architecture.final_architecture.tools
      : architecture.tools.map(
          (tool) => tool.name
        );

  architecture.final_architecture.connections =
    Array.isArray(
      architecture.final_architecture.connections
    )
      ? architecture.final_architecture.connections
      : [];

  // ----------------------------------------------------------
  // RECOMMENDATIONS
  // ----------------------------------------------------------

  architecture.recommendations =
    normalizeRecommendations(
      architecture.recommendations
    );

  // ----------------------------------------------------------
  // EXTERNAL RECOMMENDATIONS
  // ----------------------------------------------------------

  architecture.external_recommendations =
    normalizeExternalRecommendations(
      architecture.external_recommendations
    );

  // ----------------------------------------------------------
  // REVIEW
  // ----------------------------------------------------------

  if (
    !architecture.review ||
    typeof architecture.review !== "object"
  ) {
    architecture.review = {};
  }

  architecture.review.summary =
    architecture.review.summary ||
    "The workspace was reviewed for capability coverage, component fit, gaps, and practical autonomy.";

  architecture.review.strengths =
    Array.isArray(
      architecture.review.strengths
    )
      ? architecture.review.strengths
      : [];

  architecture.review.improvements =
    Array.isArray(
      architecture.review.improvements
    )
      ? architecture.review.improvements
      : [];

  architecture.review.remaining_gaps =
    Array.isArray(
      architecture.review.remaining_gaps
    )
      ? architecture.review.remaining_gaps
      : [];

  // ----------------------------------------------------------
  // OTHER OPERATIONAL FIELDS
  // ----------------------------------------------------------

  architecture.autonomy_logic =
    architecture.autonomy_logic || "";

  architecture.failure_recovery =
    architecture.failure_recovery || "";

  architecture.human_involvement =
    architecture.human_involvement || "";

  // ----------------------------------------------------------
  // DIAGNOSTICS
  // ----------------------------------------------------------

  architecture.model_used =
    modelUsed || "unknown";

  architecture.model_attempts =
    Array.isArray(attempts)
      ? attempts
      : [];

  architecture.builder_version = "V7";

  architecture.builder_mode =
    "LLM-first dynamic workspace discovery";

  return architecture;
}


// ============================================================
// NORMALIZE CAPABILITIES
// ============================================================

function normalizeCapabilities(capabilities) {
  if (!Array.isArray(capabilities)) {
    return [];
  }

  return capabilities
    .map((item) => {
      if (typeof item === "string") {
        return {
          capability: item,
          reason:
            "This capability is relevant to the workspace goal.",
        };
      }

      if (!item || typeof item !== "object") {
        return null;
      }

      const capability =
        item.capability ||
        item.name ||
        item.title ||
        "";

      if (!capability) {
        return null;
      }

      return {
        capability,
        reason:
          item.reason ||
          item.description ||
          "This capability is required by the workspace.",
      };
    })
    .filter(Boolean);
}


// ============================================================
// NORMALIZE COMPONENTS
// ============================================================

function normalizeComponents(
  components,
  defaultType
) {
  if (!Array.isArray(components)) {
    return [];
  }

  return components
    .map((item) => {
      if (typeof item === "string") {
        return {
          name: item,
          type: defaultType,
          category: "General",
          role: item,
          reason:
            "Selected because it can contribute to the workspace.",
          fit: "Medium",
        };
      }

      if (!item || typeof item !== "object") {
        return null;
      }

      const name =
        item.name ||
        item.title ||
        item.component ||
        "";

      if (!name) {
        return null;
      }

      return {
        name,
        type:
          item.type ||
          defaultType,
        category:
          item.category ||
          "General",
        role:
          item.role ||
          item.purpose ||
          item.responsibility ||
          name,
        reason:
          item.reason ||
          item.description ||
          "Selected because it can contribute to the workspace.",
        fit:
          normalizeFit(item.fit),
      };
    })
    .filter(Boolean);
}


// ============================================================
// NORMALIZE LAYERS
// ============================================================

function normalizeLayers(
  layers,
  agents,
  tools,
  workflow,
  goalUnderstanding
) {
  // ----------------------------------------------------------
  // If the LLM supplied layers, preserve them.
  // ----------------------------------------------------------

  if (Array.isArray(layers) && layers.length > 0) {
    return layers
      .map((layer, index) => {
        if (!layer || typeof layer !== "object") {
          return null;
        }

        const name =
          layer.name ||
          layer.title ||
          `Layer ${index + 1}`;

        const components =
          Array.isArray(layer.components)
            ? layer.components
                .map((component) => {
                  if (
                    typeof component === "string"
                  ) {
                    return {
                      name: component,
                      type: "Tool",
                      role: "Workspace component",
                      reason:
                        "Used within this layer.",
                    };
                  }

                  if (
                    !component ||
                    typeof component !== "object"
                  ) {
                    return null;
                  }

                  return {
                    name:
                      component.name ||
                      component.component ||
                      "Component",
                    type:
                      component.type ||
                      "Tool",
                    role:
                      component.role ||
                      component.purpose ||
                      "",
                    reason:
                      component.reason ||
                      "",
                  };
                })
                .filter(Boolean)
            : [];

        return {
          name,
          purpose:
            layer.purpose ||
            layer.description ||
            "Functional layer of the autonomous workspace.",
          order:
            Number.isFinite(Number(layer.order))
              ? Number(layer.order)
              : index + 1,
          components,
          inputs:
            Array.isArray(layer.inputs)
              ? layer.inputs
              : [],
          outputs:
            Array.isArray(layer.outputs)
              ? layer.outputs
              : [],
        };
      })
      .filter(Boolean)
      .sort((a, b) => a.order - b.order);
  }

  // ----------------------------------------------------------
  // FALLBACK:
  // Dynamically construct layers from the architecture.
  //
  // This is NOT a fixed five-layer architecture.
  // It derives layers from the actual components/workflow.
  // ----------------------------------------------------------

  const generated = [];

  const agentList = Array.isArray(agents)
    ? agents
    : [];

  const toolList = Array.isArray(tools)
    ? tools
    : [];

  const workflowList = Array.isArray(workflow)
    ? workflow
    : [];

  // Group agents/tools by their apparent responsibilities.

  const groups = [];

  const addGroup = (
    name,
    purpose,
    componentNames
  ) => {
    const uniqueNames = [
      ...new Set(
        componentNames.filter(Boolean)
      ),
    ];

    if (uniqueNames.length === 0) {
      return;
    }

    groups.push({
      name,
      purpose,
      componentNames: uniqueNames,
    });
  };

  // ----------------------------------------------------------
  // Discovery / input
  // ----------------------------------------------------------

  const discovery = [
    ...agentList
      .filter((x) =>
        /discover|research|search|collect|scan|browse|gather|source/i.test(
          `${x.name} ${x.role}`
        )
      )
      .map((x) => x.name),

    ...toolList
      .filter((x) =>
        /search|browser|research|crawl|scrape|discover|retrieve|source/i.test(
          `${x.name} ${x.role}`
        )
      )
      .map((x) => x.name),
  ];

  addGroup(
    "Discovery",
    "Collects the information, inputs, sources, or signals required by the workspace.",
    discovery
  );

  // ----------------------------------------------------------
  // Processing / reasoning
  // ----------------------------------------------------------

  const reasoning = [
    ...agentList
      .filter((x) =>
        /analys|reason|research|decision|evaluate|compare|code|plan|orchestrat/i.test(
          `${x.name} ${x.role}`
        )
      )
      .map((x) => x.name),

    ...toolList
      .filter((x) =>
        /llm|model|reason|analysis|processing|orchestrat/i.test(
          `${x.name} ${x.role}`
        )
      )
      .map((x) => x.name),
  ];

  addGroup(
    "Reasoning & Processing",
    "Processes information, performs reasoning, evaluation, planning, or decision-making.",
    reasoning
  );

  // ----------------------------------------------------------
  // Memory / storage
  // ----------------------------------------------------------

  const memory = [
    ...toolList
      .filter((x) =>
        /memory|database|storage|knowledge|vector|store|retrieval/i.test(
          `${x.name} ${x.category} ${x.role}`
        )
      )
      .map((x) => x.name),

    ...agentList
      .filter((x) =>
        /memory|knowledge/i.test(
          `${x.name} ${x.role}`
        )
      )
      .map((x) => x.name),
  ];

  addGroup(
    "Memory & Knowledge",
    "Stores and retrieves information needed for persistent autonomous operation.",
    memory
  );

  // ----------------------------------------------------------
  // Execution / automation
  // ----------------------------------------------------------

  const execution = [
    ...agentList
      .filter((x) =>
        /automation|execute|operation|action|browser|workflow|agent/i.test(
          `${x.name} ${x.role}`
        )
      )
      .map((x) => x.name),

    ...toolList
      .filter((x) =>
        /automation|execution|integration|workflow|orchestration|browser|api/i.test(
          `${x.name} ${x.category} ${x.role}`
        )
      )
      .map((x) => x.name),
  ];

  addGroup(
    "Execution & Automation",
    "Carries out actions, integrations, workflows, and autonomous execution.",
    execution
  );

  // ----------------------------------------------------------
  // Output / delivery
  // ----------------------------------------------------------

  const delivery = [
    ...agentList
      .filter((x) =>
        /report|writer|content|communication|support|marketing|sales|deliver/i.test(
          `${x.name} ${x.role}`
        )
      )
      .map((x) => x.name),

    ...toolList
      .filter((x) =>
        /communication|notification|email|report|delivery|publish|productivity/i.test(
          `${x.name} ${x.category} ${x.role}`
        )
      )
      .map((x) => x.name),
  ];

  addGroup(
    "Output & Delivery",
    "Transforms completed work into useful outputs and delivers them to the intended destination.",
    delivery
  );

  // ----------------------------------------------------------
  // Monitoring / recovery
  // ----------------------------------------------------------

  const monitoring = [
    ...agentList
      .filter((x) =>
        /monitor|quality|critic|review|supervis|control/i.test(
          `${x.name} ${x.role}`
        )
      )
      .map((x) => x.name),

    ...toolList
      .filter((x) =>
        /monitor|logging|observability|quality|alert|notification/i.test(
          `${x.name} ${x.category} ${x.role}`
        )
      )
      .map((x) => x.name),
  ];

  addGroup(
    "Monitoring & Recovery",
    "Checks workspace performance, detects failures, and supports recovery or quality control.",
    monitoring
  );

  // ----------------------------------------------------------
  // If no semantic groups were possible, derive layers from
  // the actual workflow.
  // ----------------------------------------------------------

  if (
    groups.length === 0 &&
    workflowList.length > 0
  ) {
    for (
      let i = 0;
      i < workflowList.length;
      i++
    ) {
      const step = workflowList[i];

      if (!step) {
        continue;
      }

      const component =
        typeof step === "string"
          ? step
          : step.component ||
            step.name ||
            `Step ${i + 1}`;

      addGroup(
        `Workflow Step ${i + 1}`,
        typeof step === "object"
          ? step.action ||
            step.reason ||
            "Functional workflow stage."
          : "Functional workflow stage.",
        [component]
      );
    }
  }

  // ----------------------------------------------------------
  // Absolute final fallback.
  // ----------------------------------------------------------

  if (groups.length === 0) {
    const allComponents = [
      ...agentList.map((x) => x.name),
      ...toolList.map((x) => x.name),
    ];

    if (allComponents.length > 0) {
      addGroup(
        "Core Workspace",
        goalUnderstanding ||
          "Core functional architecture for the requested workspace.",
        allComponents
      );
    }
  }

  // ----------------------------------------------------------
  // Convert groups into frontend layer objects.
  // ----------------------------------------------------------

  for (let i = 0; i < groups.length; i++) {
    const group = groups[i];

    const components = group.componentNames.map(
      (name) => {
        const agent = agentList.find(
          (x) => x.name === name
        );

        if (agent) {
          return {
            name: agent.name,
            type: "Agent",
            role: agent.role,
            reason: agent.reason,
          };
        }

        const tool = toolList.find(
          (x) => x.name === name
        );

        if (tool) {
          return {
            name: tool.name,
            type: "Tool",
            role: tool.role,
            reason: tool.reason,
          };
        }

        return {
          name,
          type: "Tool",
          role: "Workspace component",
          reason:
            "Included as part of this functional layer.",
        };
      }
    );

    generated.push({
      name: group.name,
      purpose: group.purpose,
      order: i + 1,
      components,
      inputs:
        i === 0
          ? ["User goal or incoming information"]
          : [
              `Output from ${generated[i - 1]?.name || "previous layer"}`,
            ],
      outputs: [
        i < groups.length - 1
          ? `Input for ${groups[i + 1]?.name || "next layer"}`
          : "Final workspace output",
      ],
    });
  }

  return generated;
}


// ============================================================
// NORMALIZE WORKFLOW
// ============================================================

function normalizeWorkflow(
  workflow,
  layers
) {
  if (
    Array.isArray(workflow) &&
    workflow.length > 0
  ) {
    return workflow.map((step, index) => {
      if (typeof step === "string") {
        return {
          step: index + 1,
          component: step,
          action: step,
          reason:
            "Part of the autonomous workflow.",
        };
      }

      if (!step || typeof step !== "object") {
        return {
          step: index + 1,
          component: "Workspace",
          action: "Execute workflow stage.",
          reason: "",
        };
      }

      return {
        step:
          Number(step.step) || index + 1,
        component:
          step.component ||
          step.name ||
          "Workspace",
        action:
          step.action ||
          step.description ||
          "Execute workflow stage.",
        reason:
          step.reason ||
          "",
      };
    });
  }

  // Generate workflow from layers if LLM did not provide one.
  return (layers || []).map(
    (layer, index) => ({
      step: index + 1,
      component: layer.name,
      action: layer.purpose,
      reason:
        `This layer performs the ${layer.name.toLowerCase()} function of the workspace.`,
    })
  );
}


// ============================================================
// NORMALIZE RECOMMENDATIONS
// ============================================================

function normalizeRecommendations(
  recommendations
) {
  if (!Array.isArray(recommendations)) {
    return [];
  }

  return recommendations
    .map((item) => {
      if (typeof item === "string") {
        const cleaned = item.trim();

        if (
          !cleaned ||
          /^recommended capability$/i.test(
            cleaned
          )
        ) {
          return null;
        }

        return {
          name: cleaned,
          reason:
            "This capability may improve the workspace.",
          priority: "Medium",
        };
      }

      if (!item || typeof item !== "object") {
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
          item.explanation ||
          "This recommendation may improve the workspace.",
        priority:
          normalizePriority(
            item.priority
          ),
      };
    })
    .filter(Boolean);
}


// ============================================================
// NORMALIZE EXTERNAL RECOMMENDATIONS
// ============================================================

function normalizeExternalRecommendations(
  recommendations
) {
  if (!Array.isArray(recommendations)) {
    return [];
  }

  return recommendations
    .map((item) => {
      if (typeof item === "string") {
        const cleaned = item.trim();

        if (!cleaned) {
          return null;
        }

        return {
          name: cleaned,
          type: "Other",
          reason:
            "Potential external component identified for the workspace.",
          use_for:
            "Potentially useful workspace capability.",
        };
      }

      if (!item || typeof item !== "object") {
        return null;
      }

      const name =
        item.name ||
        item.product ||
        item.tool ||
        item.capability ||
        "";

      if (!name) {
        return null;
      }

      return {
        name,
        type:
          item.type ||
          "Other",
        reason:
          item.reason ||
          item.description ||
          "Potential external component identified for the workspace.",
        use_for:
          item.use_for ||
          item.role ||
          item.purpose ||
          "Potentially useful workspace capability.",
      };
    })
    .filter(Boolean);
}


// ============================================================
// NORMALIZE FIT
// ============================================================

function normalizeFit(value) {
  const valueString =
    String(value || "").toLowerCase();

  if (valueString === "high") {
    return "High";
  }

  if (valueString === "low") {
    return "Low";
  }

  return "Medium";
}


// ============================================================
// NORMALIZE PRIORITY
// ============================================================

function normalizePriority(value) {
  const valueString =
    String(value || "").toLowerCase();

  if (valueString === "high") {
    return "High";
  }

  if (valueString === "low") {
    return "Low";
  }

  return "Medium";
}


// ============================================================
// ARCHITECTURE SUMMARY FALLBACK
// ============================================================

function buildArchitectureSummary(
  layers,
  agents,
  tools
) {
  const layerCount =
    Array.isArray(layers)
      ? layers.length
      : 0;

  const agentCount =
    Array.isArray(agents)
      ? agents.length
      : 0;

  const toolCount =
    Array.isArray(tools)
      ? tools.length
      : 0;

  if (layerCount === 0) {
    return `The workspace uses ${agentCount} agents and ${toolCount} tools.`;
  }

  const layerNames = layers
    .map((layer) => layer.name)
    .filter(Boolean)
    .join(", ");

  return (
    `The workspace uses ${agentCount} agents and ` +
    `${toolCount} tools organized across ${layerCount} ` +
    `dynamically designed layers: ${layerNames}.`
  );
}


// ============================================================
// JSON RESPONSE
// ============================================================

function jsonResponse(
  data,
  status,
  corsHeaders
) {
  return new Response(
    JSON.stringify(data, null, 2),
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
