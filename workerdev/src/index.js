export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // ------------------------------------------------------------
    // CORS
    // ------------------------------------------------------------
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "Content-Type": "application/json; charset=utf-8"
    };

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders
      });
    }

    // ------------------------------------------------------------
    // GET
    // Public Airtable directory endpoint
    // Used by Agents / Tools pages.
    // ------------------------------------------------------------
    if (request.method === "GET") {
      return await handleDirectoryRequest(env, corsHeaders);
    }

    // ------------------------------------------------------------
    // POST /build-stack
    // Build My Stack is COMPLETELY INDEPENDENT of Airtable.
    // It uses OpenRouter free models to discover suitable
    // agents/tools/services dynamically.
    // ------------------------------------------------------------
    if (request.method === "POST" && url.pathname === "/build-stack") {
      return await handleBuildStack(request, env, corsHeaders);
    }

    return jsonResponse(
      {
        error: "Not found",
        message: "Use GET for the directory or POST /build-stack for workspace generation."
      },
      404,
      corsHeaders
    );
  }
};


// ================================================================
// DIRECTORY
// ================================================================

async function handleDirectoryRequest(env, corsHeaders) {
  try {
    const airtableToken = env.AIRTABLE_TOKEN;
    const baseId = env.AIRTABLE_BASE_ID;
    const tableName = env.AIRTABLE_TABLE_NAME;

    if (!airtableToken || !baseId || !tableName) {
      return jsonResponse(
        {
          error: "Airtable configuration is missing."
        },
        500,
        corsHeaders
      );
    }

    const endpoint =
      `https://api.airtable.com/v0/${encodeURIComponent(baseId)}/${encodeURIComponent(tableName)}` +
      `?pageSize=100`;

    const response = await fetch(endpoint, {
      method: "GET",
      headers: {
        "Authorization": `Bearer ${airtableToken}`,
        "Content-Type": "application/json"
      }
    });

    const text = await response.text();

    if (!response.ok) {
      return jsonResponse(
        {
          error: "Airtable request failed.",
          status: response.status,
          details: safeErrorText(text)
        },
        502,
        corsHeaders
      );
    }

    let data;

    try {
      data = JSON.parse(text);
    } catch {
      return jsonResponse(
        {
          error: "Airtable returned invalid JSON."
        },
        502,
        corsHeaders
      );
    }

    const records = Array.isArray(data.records)
      ? data.records
      : [];

    const items = records.map(record => {
      const fields = record.fields || {};

      return {
        id: record.id || null,
        name: cleanString(fields.Name),
        type: cleanString(fields.Type),
        category: cleanString(fields.Category),
        description: cleanString(fields.Description),
        url: cleanString(fields.URL)
      };
    });

    return jsonResponse(
      {
        records: items,
        count: items.length
      },
      200,
      corsHeaders
    );

  } catch (error) {
    return jsonResponse(
      {
        error: "Directory request failed.",
        details: error?.message || String(error)
      },
      500,
      corsHeaders
    );
  }
}


// ================================================================
// BUILD STACK
// ================================================================

async function handleBuildStack(request, env, corsHeaders) {
  const startedAt = Date.now();

  try {
    if (!env.OPENROUTER_KEY) {
      return jsonResponse(
        {
          error: "OpenRouter is not configured.",
          message: "The OPENROUTER_KEY secret is missing from the Worker."
        },
        500,
        corsHeaders
      );
    }

    let body;

    try {
      body = await request.json();
    } catch {
      return jsonResponse(
        {
          error: "Invalid JSON request."
        },
        400,
        corsHeaders
      );
    }

    const goal = cleanString(body?.goal);

    if (!goal) {
      return jsonResponse(
        {
          error: "A workspace goal is required."
        },
        400,
        corsHeaders
      );
    }

    if (goal.length > 3000) {
      return jsonResponse(
        {
          error: "Workspace goal is too long.",
          message: "Please keep the goal under 3000 characters."
        },
        400,
        corsHeaders
      );
    }

    // ------------------------------------------------------------
    // IMPORTANT:
    // No Airtable data is loaded here.
    // The stack builder works independently.
    // ------------------------------------------------------------

    const result = await buildWithFreeModels(goal, env.OPENROUTER_KEY);

    if (!result.success) {
      return jsonResponse(
        {
          error: "Workspace build failed.",
          message: result.message,
          openrouter_error: result.openrouter_error || null,
          model_attempts: result.model_attempts || [],
          discovery_mode: "openrouter_free_models",
          elapsed_ms: Date.now() - startedAt
        },
        502,
        corsHeaders
      );
    }

    const workspace = normalizeWorkspace(
      result.workspace,
      goal
    );

    workspace.discovery_mode = "openrouter_free_models";
    workspace.model_used = result.model_used || null;
    workspace.model_attempts = result.model_attempts || [];
    workspace.elapsed_ms = Date.now() - startedAt;

    return jsonResponse(
      workspace,
      200,
      corsHeaders
    );

  } catch (error) {
    return jsonResponse(
      {
        error: "Workspace build failed.",
        message: error?.message || String(error),
        discovery_mode: "openrouter_free_models",
        elapsed_ms: Date.now() - startedAt
      },
      500,
      corsHeaders
    );
  }
}


// ================================================================
// OPENROUTER FREE MODEL ENGINE
// ================================================================

async function buildWithFreeModels(goal, apiKey) {
  const attempts = [];

  // ------------------------------------------------------------
  // FIRST:
  // Use the official OpenRouter Free Models Router.
  // ------------------------------------------------------------

  const routerResult = await callOpenRouter(
    "openrouter/free",
    goal,
    apiKey
  );

  attempts.push({
    model: "openrouter/free",
    status: routerResult.success ? "success" : "failed",
    error: routerResult.success
      ? null
      : routerResult.error
  });

  if (routerResult.success) {
    const parsed = parseWorkspaceResponse(routerResult.content);

    if (parsed) {
      return {
        success: true,
        workspace: parsed,
        model_used: routerResult.model || "openrouter/free",
        model_attempts: attempts
      };
    }

    attempts[attempts.length - 1].status = "invalid_json";
  }

  // ------------------------------------------------------------
  // SECOND:
  // Fetch current free models from OpenRouter.
  //
  // This avoids relying on a hardcoded list that may become stale.
  // ------------------------------------------------------------

  const freeModelsResult = await getFreeModels(apiKey);

  if (!freeModelsResult.success) {
    return {
      success: false,
      message:
        "OpenRouter Free Models Router failed and the current free-model list could not be retrieved.",
      openrouter_error:
        freeModelsResult.error ||
        routerResult.error ||
        "Unknown OpenRouter error.",
      model_attempts: attempts
    };
  }

  const models = freeModelsResult.models;

  // ------------------------------------------------------------
  // Try several current :free models.
  // ------------------------------------------------------------

  const maxIndividualAttempts = Math.min(
    models.length,
    8
  );

  for (let i = 0; i < maxIndividualAttempts; i++) {
    const model = models[i];

    if (!model || model === "openrouter/free") {
      continue;
    }

    const result = await callOpenRouter(
      model,
      goal,
      apiKey
    );

    attempts.push({
      model,
      status: result.success ? "success" : "failed",
      error: result.success
        ? null
        : result.error
    });

    if (!result.success) {
      continue;
    }

    const parsed = parseWorkspaceResponse(result.content);

    if (!parsed) {
      attempts[attempts.length - 1].status = "invalid_json";
      continue;
    }

    return {
      success: true,
      workspace: parsed,
      model_used: result.model || model,
      model_attempts: attempts
    };
  }

  return {
    success: false,
    message:
      "All currently available free OpenRouter models failed to return a usable workspace.",
    openrouter_error:
      attempts.length
        ? attempts[attempts.length - 1].error
        : "No usable free model was available.",
    model_attempts: attempts
  };
}


// ================================================================
// CALL OPENROUTER
// ================================================================

async function callOpenRouter(model, goal, apiKey) {
  const endpoint =
    "https://openrouter.ai/api/v1/chat/completions";

  const systemPrompt = `
You are the architecture engine for Autonomous Work Space.

Your task is to design a practical autonomous-work system for the user's goal.

You MUST independently discover suitable real-world AI agents, tools, platforms, services, open-source projects, or products.

Do NOT use Airtable.
Do NOT assume a fixed catalog.
Do NOT say that you are limited to a directory.
Do NOT invent products, companies, URLs, capabilities, or availability.

Prefer free, open-source, self-hostable, or genuinely free options when appropriate.

Return ONLY valid JSON.
No markdown.
No code fences.
No explanation outside the JSON.

The JSON must have exactly these top-level fields:

{
  "goal_summary": "short summary",
  "core_capabilities": [],
  "discovered_components": [],
  "layers": [],
  "gaps": [],
  "recommendations": [],
  "review": {},
  "architecture_summary": "short practical explanation"
}

Each discovered_components item MUST have:

{
  "name": "",
  "type": "Agent or Tool",
  "category": "",
  "url": "",
  "availability": "Free, Freemium, Paid, Open Source, Unknown, or Other",
  "reason": ""
}

Rules:

1. Only recommend real products, projects, agents, tools, or services.
2. Never fabricate a name or URL.
3. Use the official website or official project URL when known.
4. If you are not confident about a URL, use an empty string rather than inventing one.
5. Do not force every category to have a component.
6. Components must directly help accomplish the user's goal.
7. Agents and tools may be from different companies/projects.
8. Layers should describe the actual architecture needed for this goal.
9. Identify meaningful capability gaps.
10. Recommendations should explain practical next steps.
11. The review should identify weaknesses, unnecessary components, and possible improvements.
12. Keep the result concise enough to fit within the response limit.

User goal:

${goal}
`;

  const payload = {
    model,
    messages: [
      {
        role: "system",
        content: systemPrompt
      },
      {
        role: "user",
        content:
          "Build the autonomous workspace for this goal. Return only the requested JSON."
      }
    ],
    max_tokens: 5000,
    temperature: 0.2
  };

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://autonomouswork.space",
        "X-Title": "Autonomous Work Space"
      },
      body: JSON.stringify(payload)
    });

    const rawText = await response.text();

    if (!response.ok) {
      return {
        success: false,
        error: extractOpenRouterError(
          rawText,
          response.status
        )
      };
    }

    let data;

    try {
      data = JSON.parse(rawText);
    } catch {
      return {
        success: false,
        error:
          "OpenRouter returned a non-JSON HTTP response."
      };
    }

    const content =
      data?.choices?.[0]?.message?.content;

    if (!content) {
      return {
        success: false,
        error:
          data?.error?.message ||
          "OpenRouter returned no assistant content."
      };
    }

    return {
      success: true,
      content,
      model:
        data?.model ||
        model
    };

  } catch (error) {
    return {
      success: false,
      error:
        error?.message ||
        String(error)
    };
  }
}


// ================================================================
// GET CURRENT FREE MODELS
// ================================================================

async function getFreeModels(apiKey) {
  try {
    const response = await fetch(
      "https://openrouter.ai/api/v1/models",
      {
        method: "GET",
        headers: {
          "Authorization": `Bearer ${apiKey}`
        }
      }
    );

    const text = await response.text();

    if (!response.ok) {
      return {
        success: false,
        error: extractOpenRouterError(
          text,
          response.status
        ),
        models: []
      };
    }

    let data;

    try {
      data = JSON.parse(text);
    } catch {
      return {
        success: false,
        error: "Invalid response from OpenRouter Models API.",
        models: []
      };
    }

    const allModels =
      Array.isArray(data?.data)
        ? data.data
        : [];

    const freeModels = allModels
      .filter(model => {
        const id = cleanString(model?.id);

        if (!id) {
          return false;
        }

        if (id === "openrouter/free") {
          return false;
        }

        // Explicit :free variant.
        if (id.endsWith(":free")) {
          return true;
        }

        // Some model listings expose zero pricing
        // without a :free suffix.
        const prompt =
          parseFloat(model?.pricing?.prompt);

        const completion =
          parseFloat(model?.pricing?.completion);

        return (
          Number.isFinite(prompt) &&
          Number.isFinite(completion) &&
          prompt === 0 &&
          completion === 0
        );
      })
      .map(model => model.id)
      .filter(Boolean);

    // Remove duplicates while preserving order.
    const uniqueModels = [
      ...new Set(freeModels)
    ];

    return {
      success: true,
      models: uniqueModels
    };

  } catch (error) {
    return {
      success: false,
      error:
        error?.message ||
        String(error),
      models: []
    };
  }
}


// ================================================================
// RESPONSE PARSER
// ================================================================

function parseWorkspaceResponse(content) {
  if (!content) {
    return null;
  }

  let text = String(content).trim();

  // ------------------------------------------------------------
  // Remove markdown fences if a model ignored the instruction.
  // ------------------------------------------------------------

  text = text
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  // ------------------------------------------------------------
  // Direct JSON
  // ------------------------------------------------------------

  try {
    const parsed = JSON.parse(text);

    if (isUsableWorkspace(parsed)) {
      return parsed;
    }
  } catch {
    // Continue to repair attempt.
  }

  // ------------------------------------------------------------
  // Extract the outermost JSON object.
  // ------------------------------------------------------------

  const firstBrace = text.indexOf("{");
  const lastBrace = text.lastIndexOf("}");

  if (
    firstBrace !== -1 &&
    lastBrace !== -1 &&
    lastBrace > firstBrace
  ) {
    const candidate =
      text.slice(
        firstBrace,
        lastBrace + 1
      );

    try {
      const parsed = JSON.parse(candidate);

      if (isUsableWorkspace(parsed)) {
        return parsed;
      }
    } catch {
      // Continue.
    }
  }

  return null;
}


// ================================================================
// WORKSPACE VALIDATION
// ================================================================

function isUsableWorkspace(value) {
  if (!value || typeof value !== "object") {
    return false;
  }

  const hasComponents =
    Array.isArray(value.discovered_components);

  const hasLayers =
    Array.isArray(value.layers);

  const hasGoal =
    typeof value.goal_summary === "string";

  return (
    hasGoal &&
    (hasComponents || hasLayers)
  );
}


// ================================================================
// NORMALIZATION
// ================================================================

function normalizeWorkspace(workspace, goal) {
  const discovered =
    Array.isArray(workspace?.discovered_components)
      ? workspace.discovered_components
      : [];

  const components = discovered
    .map(item => {
      if (!item || typeof item !== "object") {
        return null;
      }

      const type =
        normalizeType(item.type);

      return {
        name: cleanString(item.name),
        type,
        category: cleanString(item.category),
        url: normalizeUrl(item.url),
        availability:
          cleanString(item.availability) ||
          "Unknown",
        reason:
          cleanString(item.reason)
      };
    })
    .filter(item => item && item.name);

  const layers =
    Array.isArray(workspace?.layers)
      ? workspace.layers.map((layer, index) => {
          if (!layer || typeof layer !== "object") {
            return {
              name: `Layer ${index + 1}`,
              purpose: "",
              components: []
            };
          }

          return {
            name:
              cleanString(layer.name) ||
              `Layer ${index + 1}`,

            purpose:
              cleanString(
                layer.purpose ||
                layer.description
              ),

            components:
              Array.isArray(layer.components)
                ? layer.components
                    .map(cleanString)
                    .filter(Boolean)
                : []
          };
        })
      : [];

  const agents =
    components.filter(
      item =>
        item.type.toLowerCase() === "agent"
    );

  const tools =
    components.filter(
      item =>
        item.type.toLowerCase() === "tool"
    );

  return {
    goal: goal,

    goal_summary:
      cleanString(workspace?.goal_summary) ||
      goal,

    core_capabilities:
      normalizeStringArray(
        workspace?.core_capabilities
      ),

    discovered_components:
      components,

    agents,

    tools,

    layers,

    gaps:
      normalizeStringArray(
        workspace?.gaps
      ),

    recommendations:
      normalizeStringArray(
        workspace?.recommendations
      ),

    review:
      normalizeReview(
        workspace?.review
      ),

    architecture_summary:
      cleanString(
        workspace?.architecture_summary
      ) ||
      "The workspace was assembled dynamically from currently available free AI ecosystem components."
  };
}


// ================================================================
// REVIEW NORMALIZATION
// ================================================================

function normalizeReview(review) {
  if (!review || typeof review !== "object") {
    return {
      summary: "",
      strengths: [],
      weaknesses: [],
      improvements: []
    };
  }

  return {
    summary:
      cleanString(review.summary) ||
      cleanString(review.overview),

    strengths:
      normalizeStringArray(
        review.strengths
      ),

    weaknesses:
      normalizeStringArray(
        review.weaknesses
      ),

    improvements:
      normalizeStringArray(
        review.improvements
      )
  };
}


// ================================================================
// HELPERS
// ================================================================

function normalizeType(type) {
  const value =
    cleanString(type).toLowerCase();

  if (value.includes("agent")) {
    return "Agent";
  }

  if (value.includes("tool")) {
    return "Tool";
  }

  return "Tool";
}


function normalizeUrl(value) {
  const url = cleanString(value);

  if (!url) {
    return "";
  }

  if (
    url.startsWith("https://") ||
    url.startsWith("http://")
  ) {
    return url;
  }

  return "";
}


function normalizeStringArray(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map(item => {
      if (
        typeof item === "string"
      ) {
        return item.trim();
      }

      if (
        item &&
        typeof item === "object"
      ) {
        return (
          cleanString(item.text) ||
          cleanString(item.description) ||
          cleanString(item.name)
        );
      }

      return "";
    })
    .filter(Boolean);
}


function cleanString(value) {
  if (
    value === null ||
    value === undefined
  ) {
    return "";
  }

  return String(value).trim();
}


function extractOpenRouterError(text, status) {
  let message = "";

  try {
    const data = JSON.parse(text);

    message =
      data?.error?.message ||
      data?.message ||
      data?.error ||
      "";
  } catch {
    message = text;
  }

  message = cleanString(message);

  if (!message) {
    message =
      `OpenRouter HTTP ${status}`;
  }

  // Keep Worker error responses reasonably small.
  if (message.length > 1000) {
    message =
      message.slice(0, 1000) +
      "...";
  }

  return message;
}


function safeErrorText(text) {
  let value = cleanString(text);

  if (value.length > 1000) {
    value =
      value.slice(0, 1000) +
      "...";
  }

  return value;
}


function jsonResponse(data, status, corsHeaders) {
  return new Response(
    JSON.stringify(
      data,
      null,
      2
    ),
    {
      status,
      headers: corsHeaders
    }
  );
}
