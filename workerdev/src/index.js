export default {
  async fetch(request, env) {
    const url = new URL(request.url);

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

    // ==========================================================
    // PUBLIC DIRECTORY
    // ==========================================================

    if (request.method === "GET") {
      return await getDirectory(env, corsHeaders);
    }

    // ==========================================================
    // BUILD MY STACK
    // ==========================================================

    if (
      request.method === "POST" &&
      url.pathname === "/build-stack"
    ) {
      return await buildStack(request, env, corsHeaders);
    }

    return json(
      {
        error: "Not found"
      },
      404,
      corsHeaders
    );
  }
};


// ============================================================
// GET AIRTABLE DIRECTORY
// ============================================================

async function getDirectory(env, corsHeaders) {
  try {
    if (
      !env.AIRTABLE_TOKEN ||
      !env.AIRTABLE_BASE_ID ||
      !env.AIRTABLE_TABLE_NAME
    ) {
      return json(
        {
          error: "Airtable configuration is missing."
        },
        500,
        corsHeaders
      );
    }

    const endpoint =
      `https://api.airtable.com/v0/` +
      `${encodeURIComponent(env.AIRTABLE_BASE_ID)}/` +
      `${encodeURIComponent(env.AIRTABLE_TABLE_NAME)}` +
      `?pageSize=100`;

    const response = await fetch(endpoint, {
      method: "GET",
      headers: {
        "Authorization":
          `Bearer ${env.AIRTABLE_TOKEN}`
      }
    });

    const text = await response.text();

    if (!response.ok) {
      return json(
        {
          error: "Airtable request failed.",
          status: response.status,
          details: text.slice(0, 1000)
        },
        502,
        corsHeaders
      );
    }

    let data;

    try {
      data = JSON.parse(text);
    } catch {
      return json(
        {
          error: "Invalid Airtable response."
        },
        502,
        corsHeaders
      );
    }

    const records =
      Array.isArray(data.records)
        ? data.records
        : [];

    const output = records.map(record => {
      const fields = record.fields || {};

      return {
        id: record.id || "",
        name: clean(fields.Name),
        type: clean(fields.Type),
        category: clean(fields.Category),
        description: clean(fields.Description),
        url: clean(fields.URL)
      };
    });

    return json(
      {
        records: output,
        count: output.length
      },
      200,
      corsHeaders
    );

  } catch (error) {
    return json(
      {
        error: "Directory request failed.",
        details:
          error?.message ||
          String(error)
      },
      500,
      corsHeaders
    );
  }
}


// ============================================================
// BUILD STACK
// ============================================================

async function buildStack(
  request,
  env,
  corsHeaders
) {
  const started = Date.now();

  try {
    if (!env.OPENROUTER_KEY) {
      return json(
        {
          error: "Workspace build failed.",
          message:
            "OPENROUTER_KEY is missing from the Worker."
        },
        500,
        corsHeaders
      );
    }

    let body;

    try {
      body = await request.json();
    } catch {
      return json(
        {
          error: "Workspace build failed.",
          message: "Invalid JSON request."
        },
        400,
        corsHeaders
      );
    }

    const goal = clean(body?.goal);

    if (!goal) {
      return json(
        {
          error: "Workspace build failed.",
          message:
            "Please enter a workspace goal."
        },
        400,
        corsHeaders
      );
    }

    if (goal.length > 3000) {
      return json(
        {
          error: "Workspace build failed.",
          message:
            "Please keep the workspace goal below 3000 characters."
        },
        400,
        corsHeaders
      );
    }

    // --------------------------------------------------------
    // IMPORTANT:
    // Airtable is NOT used here.
    // --------------------------------------------------------

    const discovery =
      await discoverComponents(
        goal,
        env.OPENROUTER_KEY
      );

    if (!discovery.success) {
      return json(
        {
          error: "Workspace build failed.",
          message:
            discovery.message ||
            "OpenRouter could not discover suitable agents and tools.",

          openrouter_error:
            discovery.error || null,

          model_attempts:
            discovery.model_attempts || [],

          discovery_mode:
            "openrouter_free_models",

          elapsed_ms:
            Date.now() - started
        },
        502,
        corsHeaders
      );
    }

    const workspace =
      createWorkspace(
        goal,
        discovery.components,
        discovery.model_used,
        discovery.model_attempts
      );

    workspace.discovery_mode =
      "openrouter_free_models";

    workspace.elapsed_ms =
      Date.now() - started;

    return json(
      workspace,
      200,
      corsHeaders
    );

  } catch (error) {
    return json(
      {
        error: "Workspace build failed.",
        message:
          error?.message ||
          String(error),

        discovery_mode:
          "openrouter_free_models",

        elapsed_ms:
          Date.now() - started
      },
      500,
      corsHeaders
    );
  }
}


// ============================================================
// DISCOVER AGENTS + TOOLS
//
// This intentionally follows the proven PythonAnywhere
// approach:
//
// simple prompt
// simple JSON array
// free models
// validate afterwards
// ============================================================

async function discoverComponents(
  goal,
  apiKey
) {
  const attempts = [];

  // ----------------------------------------------------------
  // First try the official Free Models Router.
  // ----------------------------------------------------------

  const routerResult =
    await queryOpenRouter(
      "openrouter/free",
      buildDiscoveryPrompt(goal),
      apiKey
    );

  attempts.push({
    model: "openrouter/free",
    status:
      routerResult.success
        ? "success"
        : "failed",
    error:
      routerResult.success
        ? null
        : routerResult.error
  });

  if (routerResult.success) {
    const components =
      parseArray(
        routerResult.content
      );

    const valid =
      validateComponents(
        components
      );

    if (valid.length > 0) {
      return {
        success: true,
        components: valid,
        model_used:
          routerResult.model ||
          "openrouter/free",
        model_attempts: attempts
      };
    }

    attempts[
      attempts.length - 1
    ].status = "invalid_response";
  }

  // ----------------------------------------------------------
  // If Free Router failed, retrieve current free models.
  // This is essentially the same strategy used by PythonAnywhere.
  // ----------------------------------------------------------

  const models =
    await getFreeModels(apiKey);

  if (!models.length) {
    return {
      success: false,
      message:
        "OpenRouter Free Models Router failed and no individual free models could be retrieved.",
      error:
        routerResult.error ||
        "No free OpenRouter models available.",
      model_attempts: attempts
    };
  }

  // ----------------------------------------------------------
  // Try current individual free models.
  // ----------------------------------------------------------

  const maxAttempts =
    Math.min(models.length, 8);

  for (
    let i = 0;
    i < maxAttempts;
    i++
  ) {
    const model = models[i];

    if (
      !model ||
      model === "openrouter/free"
    ) {
      continue;
    }

    const result =
      await queryOpenRouter(
        model,
        buildDiscoveryPrompt(goal),
        apiKey
      );

    attempts.push({
      model,
      status:
        result.success
          ? "success"
          : "failed",
      error:
        result.success
          ? null
          : result.error
    });

    if (!result.success) {
      continue;
    }

    const components =
      parseArray(
        result.content
      );

    const valid =
      validateComponents(
        components
      );

    if (valid.length > 0) {
      return {
        success: true,
        components: valid,
        model_used:
          result.model ||
          model,
        model_attempts: attempts
      };
    }

    attempts[
      attempts.length - 1
    ].status = "invalid_response";
  }

  return {
    success: false,

    message:
      "All available free OpenRouter models failed to return usable agent/tool discovery results.",

    error:
      attempts.length
        ? attempts[
            attempts.length - 1
          ].error
        : "No usable model response.",

    model_attempts:
      attempts
  };
}


// ============================================================
// DISCOVERY PROMPT
// ============================================================

function buildDiscoveryPrompt(goal) {
  return `
Find real AI agents and tools that can help accomplish this user's goal:

"${goal}"

The purpose is to build an autonomous work stack.

Find approximately 6 to 12 of the most relevant real-world
AI agents, tools, platforms, services, or open-source projects.

IMPORTANT:

1. Only include REAL existing products, projects, agents,
   platforms or services.

2. Do NOT invent names.

3. Do NOT invent URLs.

4. Prefer official websites.

5. Do not return generic concepts.

6. Do not return fictional products.

7. Components must be relevant to the user's actual goal.

8. Include both AI agents and useful tools when appropriate.

9. A component can be Free, Freemium, Paid, Open Source,
   or Unknown. Do not falsely claim something is free.

10. If you are not confident about a URL, return an empty
    string instead of inventing one.

11. Do not force a component into the result simply to
    increase the number.

12. Return ONLY a valid JSON array.

Each object must contain exactly:

{
  "name": "product or project name",
  "type": "Agent or Tool",
  "category": "relevant category",
  "description": "short factual description",
  "url": "official URL",
  "availability": "Free/Freemium/Paid/Open Source/Unknown",
  "reason": "why this component is relevant to the goal"
}

Return JSON only.
No markdown.
No code fences.
No explanation outside the JSON.
`;
}


// ============================================================
// OPENROUTER REQUEST
//
// Deliberately kept close to the working PythonAnywhere
// implementation.
// ============================================================

async function queryOpenRouter(
  model,
  prompt,
  apiKey
) {
  const endpoint =
    "https://openrouter.ai/api/v1/chat/completions";

  const payload = {
    model: model,

    messages: [
      {
        role: "system",
        content:
          "Return ONLY a valid JSON array. " +
          "No markdown. No code fences. " +
          "No explanation. " +
          "Only real existing products and official websites. " +
          "Do not invent products, companies or URLs."
      },

      {
        role: "user",
        content: prompt
      }
    ],

    temperature: 0.2
  };

  try {
    const response =
      await fetch(
        endpoint,
        {
          method: "POST",

          headers: {
            "Authorization":
              `Bearer ${apiKey}`,

            "Content-Type":
              "application/json"
          },

          body:
            JSON.stringify(payload)
        }
      );

    const text =
      await response.text();

    if (!response.ok) {
      return {
        success: false,
        error:
          extractError(
            text,
            response.status
          )
      };
    }

    let data;

    try {
      data =
        JSON.parse(text);
    } catch {
      return {
        success: false,
        error:
          "OpenRouter returned invalid JSON."
      };
    }

    const choices =
      data?.choices || [];

    if (!choices.length) {
      return {
        success: false,
        error:
          data?.error?.message ||
          "OpenRouter returned no choices."
      };
    }

    const content =
      choices[0]?.message?.content;

    if (!content) {
      return {
        success: false,
        error:
          "OpenRouter returned empty content."
      };
    }

    return {
      success: true,
      content:
        String(content).trim(),

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


// ============================================================
// CURRENT FREE MODELS
// ============================================================

async function getFreeModels(apiKey) {
  try {
    const response =
      await fetch(
        "https://openrouter.ai/api/v1/models",
        {
          method: "GET",

          headers: {
            "Authorization":
              `Bearer ${apiKey}`
          }
        }
      );

    if (!response.ok) {
      return [];
    }

    const data =
      await response.json();

    if (!Array.isArray(data?.data)) {
      return [];
    }

    const models =
      data.data
        .filter(model => {
          const id =
            String(
              model?.id || ""
            );

          if (!id) {
            return false;
          }

          if (
            id === "openrouter/free"
          ) {
            return false;
          }

          // Same basic :free detection
          // used by the Python scanner.
          if (
            id.endsWith(":free")
          ) {
            return true;
          }

          const promptPrice =
            Number(
              model?.pricing?.prompt ||
              0
            );

          const completionPrice =
            Number(
              model?.pricing?.completion ||
              0
            );

          return (
            promptPrice === 0 &&
            completionPrice === 0
          );
        })
        .map(model => model.id)
        .filter(Boolean);

    return [
      ...new Set(models)
    ];

  } catch {
    return [];
  }
}


// ============================================================
// PARSE JSON ARRAY
// ============================================================

function parseArray(content) {
  if (!content) {
    return null;
  }

  let text =
    String(content).trim();

  // Remove markdown fences if necessary.
  text =
    text.replace(
      /^\s*```(?:json)?\s*/i,
      ""
    );

  text =
    text.replace(
      /\s*```\s*$/i,
      ""
    );

  text =
    text.trim();

  // Direct JSON.
  try {
    const parsed =
      JSON.parse(text);

    if (
      Array.isArray(parsed)
    ) {
      return parsed;
    }
  } catch {}

  // Extract first [ and last ].
  const start =
    text.indexOf("[");

  const end =
    text.lastIndexOf("]");

  if (
    start !== -1 &&
    end !== -1 &&
    end > start
  ) {
    const candidate =
      text.slice(
        start,
        end + 1
      );

    try {
      const parsed =
        JSON.parse(candidate);

      if (
        Array.isArray(parsed)
      ) {
        return parsed;
      }
    } catch {}
  }

  // Conservative trailing-comma repair.
  const repaired =
    text
      .replace(
        /,\s*]/g,
        "]"
      )
      .replace(
        /,\s*}/g,
        "}"
      );

  try {
    const parsed =
      JSON.parse(repaired);

    if (
      Array.isArray(parsed)
    ) {
      return parsed;
    }
  } catch {}

  return null;
}


// ============================================================
// VALIDATE DISCOVERED COMPONENTS
// ============================================================

function validateComponents(items) {
  if (!Array.isArray(items)) {
    return [];
  }

  const seen =
    new Set();

  const valid = [];

  for (const item of items) {
    if (
      !item ||
      typeof item !== "object"
    ) {
      continue;
    }

    const name =
      clean(item.name);

    if (!name) {
      continue;
    }

    const key =
      name.toLowerCase();

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);

    const type =
      normalizeType(
        item.type
      );

    const url =
      normalizeUrl(
        item.url
      );

    const description =
      clean(
        item.description
      );

    const reason =
      clean(
        item.reason
      );

    if (!description) {
      continue;
    }

    valid.push({
      name,

      type,

      category:
        clean(
          item.category
        ) || "Other",

      description,

      url,

      availability:
        clean(
          item.availability
        ) || "Unknown",

      reason
    });
  }

  return valid;
}


// ============================================================
// CREATE THE STACK
//
// No second expensive LLM architecture request.
//
// The free model discovers the components.
// The Worker organizes those discovered components.
// ============================================================

function createWorkspace(
  goal,
  components,
  modelUsed,
  attempts
) {
  const agents =
    components.filter(
      item =>
        item.type === "Agent"
    );

  const tools =
    components.filter(
      item =>
        item.type === "Tool"
    );

  const capabilities =
    deriveCapabilities(
      components
    );

  const layers =
    deriveLayers(
      components,
      goal
    );

  const gaps =
    deriveGaps(
      components
    );

  const recommendations =
    deriveRecommendations(
      components,
      agents,
      tools
    );

  const review =
    createReview(
      components,
      agents,
      tools
    );

  return {
    goal,

    goal_summary:
      summarizeGoal(goal),

    core_capabilities:
      capabilities,

    discovered_components:
      components,

    agents,

    tools,

    layers,

    gaps,

    recommendations,

    review,

    architecture_summary:
      createArchitectureSummary(
        goal,
        components,
        layers
      ),

    model_used:
      modelUsed || null,

    model_attempts:
      attempts || []
  };
}


// ============================================================
// CAPABILITY DERIVATION
// ============================================================

function deriveCapabilities(
  components
) {
  const values = [];

  for (const item of components) {
    const category =
      clean(
        item.category
      );

    if (
      category &&
      !values.includes(category)
    ) {
      values.push(category);
    }
  }

  return values.slice(0, 10);
}


// ============================================================
// DYNAMIC LAYERS
// ============================================================

function deriveLayers(
  components,
  goal
) {
  const layers = [];

  const agents =
    components.filter(
      x => x.type === "Agent"
    );

  const tools =
    components.filter(
      x => x.type === "Tool"
    );

  if (agents.length) {
    layers.push({
      name: "Agent Layer",

      purpose:
        "AI agents perform the autonomous reasoning and task execution required by the workspace.",

      components:
        agents.map(
          x => x.name
        )
    });
  }

  if (tools.length) {
    layers.push({
      name: "Tool & Execution Layer",

      purpose:
        "Tools provide the automation, integration, development, communication, data, or infrastructure capabilities required by the agents.",

      components:
        tools.map(
          x => x.name
        )
    });
  }

  if (
    components.some(
      x =>
        /automation|orchestration|workflow/i
          .test(
            `${x.category} ${x.description}`
          )
    )
  ) {
    layers.push({
      name: "Automation Layer",

      purpose:
        "Automation components connect tasks into repeatable autonomous workflows.",

      components:
        components
          .filter(
            x =>
              /automation|orchestration|workflow/i
                .test(
                  `${x.category} ${x.description}`
                )
          )
          .map(
            x => x.name
          )
    });
  }

  if (
    components.some(
      x =>
        /database|memory|data/i
          .test(
            `${x.category} ${x.description}`
          )
    )
  ) {
    layers.push({
      name: "Data & Memory Layer",

      purpose:
        "Relevant data or memory systems support persistent information and context.",

      components:
        components
          .filter(
            x =>
              /database|memory|data/i
                .test(
                  `${x.category} ${x.description}`
                )
          )
          .map(
            x => x.name
          )
    });
  }

  if (!layers.length) {
    layers.push({
      name: "Execution Layer",

      purpose:
        `Components selected to help accomplish the goal: ${goal}`,

      components:
        components.map(
          x => x.name
        )
    });
  }

  return layers;
}


// ============================================================
// GAPS
// ============================================================

function deriveGaps(
  components
) {
  const gaps = [];

  if (!components.length) {
    gaps.push({
      capability:
        "Component discovery",

      reason:
        "No suitable components were discovered."
    });
  }

  const agents =
    components.filter(
      x => x.type === "Agent"
    );

  const tools =
    components.filter(
      x => x.type === "Tool"
    );

  if (!agents.length) {
    gaps.push({
      capability:
        "Autonomous agent execution",

      reason:
        "No AI agent was discovered for the requested goal."
    });
  }

  if (!tools.length) {
    gaps.push({
      capability:
        "Supporting tools",

      reason:
        "No supporting tool was discovered for the requested goal."
    });
  }

  return gaps;
}


// ============================================================
// RECOMMENDATIONS
// ============================================================

function deriveRecommendations(
  components,
  agents,
  tools
) {
  const recommendations = [];

  if (agents.length) {
    recommendations.push(
      "Use the selected agent or agents for the core autonomous task execution."
    );
  }

  if (tools.length) {
    recommendations.push(
      "Connect the supporting tools to the agents according to their specific responsibilities."
    );
  }

  if (
    components.some(
      x =>
        /automation|orchestration/i
          .test(
            `${x.category} ${x.description}`
          )
    )
  ) {
    recommendations.push(
      "Use the discovered automation or orchestration capability to connect the workflow into repeatable steps."
    );
  }

  if (
    components.length >= 5
  ) {
    recommendations.push(
      "Start with the smallest useful combination of components and add additional components only when the workflow requires them."
    );
  }

  return recommendations;
}


// ============================================================
// SELF REVIEW
// ============================================================

function createReview(
  components,
  agents,
  tools
) {
  let summary;

  if (!components.length) {
    summary =
      "The workspace could not identify suitable components, so additional discovery is required.";
  } else {
    summary =
      `The workspace discovered ${components.length} relevant components, including ${agents.length} agent(s) and ${tools.length} tool(s). The architecture is based on those discovered capabilities rather than a fixed catalog.`;
  }

  const improvements = [];

  if (
    components.length < 4
  ) {
    improvements.push(
      "Additional discovery may be useful if the goal requires capabilities not represented by the current results."
    );
  }

  improvements.push(
    "Validate the selected services and their current availability before deploying a production workflow."
  );

  return {
    summary,

    strengths: [
      "Components were discovered dynamically from the user's goal.",
      "The workspace is not dependent on the Airtable directory."
    ],

    weaknesses: [
      "Free-model discovery depends on the current availability and capabilities of OpenRouter free models."
    ],

    improvements
  };
}


// ============================================================
// ARCHITECTURE SUMMARY
// ============================================================

function createArchitectureSummary(
  goal,
  components,
  layers
) {
  const componentNames =
    components
      .map(
        x => x.name
      )
      .join(", ");

  const layerNames =
    layers
      .map(
        x => x.name
      )
      .join(", ");

  return (
    `The workspace was generated specifically for the goal: "${goal}". ` +
    `The discovery process identified ${components.length} relevant ecosystem components: ${componentNames || "none"}. ` +
    `The resulting architecture is organized around the capabilities represented by those components rather than a fixed directory template. ` +
    `The resulting layers are: ${layerNames}. ` +
    `Agents are intended to perform autonomous work while supporting tools provide the execution, integration, data, automation, or infrastructure capabilities required by the workflow.`
  );
}


// ============================================================
// GOAL SUMMARY
// ============================================================

function summarizeGoal(goal) {
  return (
    `Create an autonomous work system capable of accomplishing: ${goal}`
  );
}


// ============================================================
// TYPE NORMALIZATION
// ============================================================

function normalizeType(type) {
  const value =
    clean(type).toLowerCase();

  if (
    value.includes("agent")
  ) {
    return "Agent";
  }

  return "Tool";
}


// ============================================================
// URL NORMALIZATION
// ============================================================

function normalizeUrl(url) {
  const value =
    clean(url);

  if (!value) {
    return "";
  }

  if (
    value.startsWith(
      "https://"
    ) ||
    value.startsWith(
      "http://"
    )
  ) {
    return value;
  }

  return "";
}


// ============================================================
// STRING CLEANING
// ============================================================

function clean(value) {
  if (
    value === null ||
    value === undefined
  ) {
    return "";
  }

  return String(value).trim();
}


// ============================================================
// ERROR EXTRACTION
// ============================================================

function extractError(
  text,
  status
) {
  let message = "";

  try {
    const data =
      JSON.parse(text);

    message =
      data?.error?.message ||
      data?.message ||
      "";
  } catch {
    message =
      text || "";
  }

  message =
    clean(message);

  if (!message) {
    message =
      `OpenRouter HTTP ${status}`;
  }

  if (
    message.length > 1000
  ) {
    message =
      message.slice(
        0,
        1000
      ) + "...";
  }

  return message;
}


// ============================================================
// JSON RESPONSE
// ============================================================

function json(
  data,
  status,
  headers
) {
  return new Response(
    JSON.stringify(
      data,
      null,
      2
    ),
    {
      status,
      headers
    }
  );
}
