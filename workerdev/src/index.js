export default {
  async fetch(request, env) {
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };

    // ---------------------------------------------------------
    // CORS PREFLIGHT
    // ---------------------------------------------------------
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders,
      });
    }

    // ---------------------------------------------------------
    // GET
    // ---------------------------------------------------------
    // IMPORTANT:
    // GET remains connected to Airtable because the directory
    // pages still need Airtable data.
    //
    // The Stack Builder does NOT use this data.
    // ---------------------------------------------------------
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

    // ---------------------------------------------------------
    // POST /build-stack
    // ---------------------------------------------------------
    // IMPORTANT:
    // The Stack Builder is completely independent of Airtable.
    //
    // It receives the user's goal and asks the LLM to:
    //
    // 1. Understand the goal
    // 2. Identify required capabilities
    // 3. Find suitable agents/tools from its knowledge
    // 4. Design the workspace
    // 5. Evaluate component matches
    // 6. Identify capability gaps
    // 7. Solve the gaps
    // 8. Produce the final architecture
    // 9. Perform a final self-review
    // ---------------------------------------------------------
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

        // -----------------------------------------------------
        // DISCOVER CURRENT FREE OPENROUTER MODELS
        // -----------------------------------------------------
        const freeModels = await discoverFreeModels(env);

        // -----------------------------------------------------
        // BUILD MODEL FALLBACK LIST
        // -----------------------------------------------------
        //
        // openrouter/free is attempted first.
        //
        // Then explicitly discovered free models are supplied
        // to OpenRouter as native fallbacks.
        // -----------------------------------------------------
        const fallbackModels = buildFallbackModels(freeModels);

        // -----------------------------------------------------
        // MAIN BUILDER PROMPT
        // -----------------------------------------------------
        const systemPrompt = `
You are the intelligence engine for Autonomous Work Space.

Your job is to transform a user's natural-language work goal into a practical autonomous workspace architecture.

You are NOT limited to a predefined directory.

You should use your own knowledge of AI agents, AI tools, automation platforms, APIs, infrastructure, databases, communication systems, browsers, coding systems, research systems, memory systems, orchestration systems, and other relevant technologies.

The user wants the most appropriate components for the goal.

Think carefully about the actual work that must be performed rather than simply matching keywords.

Your reasoning process should cover:

1. Understand the user's goal.
2. Identify the work that needs to happen.
3. Identify the capabilities required.
4. Find suitable agents and tools from your knowledge.
5. Consider alternatives where appropriate.
6. Select components that can realistically perform the required work.
7. Design how the components interact.
8. Evaluate whether each component actually matches its responsibility.
9. Identify missing capabilities or weaknesses.
10. Solve those gaps by adding, replacing, or restructuring components.
11. Produce a final coherent autonomous workspace.
12. Perform a final self-review for practicality, completeness, unnecessary complexity, and obvious capability gaps.

IMPORTANT:

- Do not assume that every goal needs many components.
- Do not add components merely to make the architecture look sophisticated.
- Prefer simple architectures when they are sufficient.
- Use multiple components when the workflow genuinely requires them.
- Clearly distinguish agents from tools.
- Agents perform reasoning or autonomous work.
- Tools provide capabilities, services, infrastructure, integrations, storage, communication, execution, monitoring, etc.
- Components may be external products or technologies that are appropriate for the goal.
- Explain why each important component is included.
- If a capability is difficult to automate fully, explicitly identify the limitation.
- Do not invent nonexistent products.
- If uncertain about a product detail, describe the capability rather than inventing a specific feature.
- Think about how the workspace could operate repeatedly with minimal human intervention.
- Think about inputs, processing, decisions, actions, outputs, memory, monitoring, and failure recovery where relevant.

Return ONLY valid JSON.

The JSON must follow this structure:

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
    "..."
  ],

  "external_recommendations": [
    "..."
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

The final answer must be internally coherent.

The agents, tools, workflow, architecture, gaps, gap solutions, and final architecture must describe the same workspace.

Do not output markdown.
Do not wrap the JSON in code fences.
`;

        const userPrompt = `
USER WORKSPACE GOAL:

${goal}

Build the complete autonomous workspace for this goal.

Do the discovery, architecture design, component evaluation, gap solving, rebuilding, and final self-review internally before returning the final JSON.
`;

        // -----------------------------------------------------
        // CALL OPENROUTER
        // -----------------------------------------------------
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

        // -----------------------------------------------------
        // PARSE LLM JSON
        // -----------------------------------------------------
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
              raw_preview: String(result.content || "").slice(0, 2000),
            },
            502,
            corsHeaders
          );
        }

        // -----------------------------------------------------
        // NORMALIZE OUTPUT
        // -----------------------------------------------------
        architecture = normalizeArchitecture(
          architecture,
          goal,
          result.model,
          result.attempts
        );

        // -----------------------------------------------------
        // RETURN FINAL WORKSPACE
        // -----------------------------------------------------
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

    // ---------------------------------------------------------
    // UNKNOWN ROUTE
    // ---------------------------------------------------------
    return new Response("Not found", {
      status: 404,
      headers: corsHeaders,
    });
  },
};


// ============================================================
// OPENROUTER FREE MODEL DISCOVERY
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

    const models = Array.isArray(data?.data) ? data.data : [];

    const free = [];

    for (const model of models) {
      const id = model?.id;

      if (!id || typeof id !== "string") {
        continue;
      }

      // Explicit :free models
      if (id.endsWith(":free")) {
        free.push(id);
        continue;
      }

      // Models whose pricing is explicitly zero
      const promptPrice = model?.pricing?.prompt;
      const completionPrice = model?.pricing?.completion;

      if (
        (promptPrice === "0" || promptPrice === 0) &&
        (completionPrice === "0" || completionPrice === 0)
      ) {
        free.push(id);
      }
    }

    return [...new Set(free)];
  } catch {
    return [];
  }
}


// ============================================================
// BUILD FALLBACK MODEL LIST
// ============================================================

function buildFallbackModels(freeModels) {
  const result = [];

  // Always attempt the OpenRouter Free Models Router first.
  result.push("openrouter/free");

  // Then use explicitly discovered free models.
  for (const model of freeModels || []) {
    if (!model || typeof model !== "string") {
      continue;
    }

    if (model === "openrouter/free") {
      continue;
    }

    if (!result.includes(model)) {
      result.push(model);
    }
  }

  // Keep the fallback list reasonably small.
  // The OpenRouter free router itself can already select
  // an appropriate free model.
  return result.slice(0, 25);
}


// ============================================================
// OPENROUTER REQUEST
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
  // FIRST TRY:
  // Use OpenRouter's native model fallback mechanism.
  //
  // If a model fails, OpenRouter can automatically try the
  // next model in this array.
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
  // SECOND TRY:
  // Explicitly try each free model individually.
  //
  // This is an additional recovery layer in case the native
  // fallback request itself fails.
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
  const url = "https://openrouter.ai/api/v1/chat/completions";

  const attempts = [];

  const controller = new AbortController();

  // Long enough for free models to reason without making the
  // request excessively easy to kill.
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
        "HTTP-Referer": "https://autonomouswork-directory.pages.dev/",
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

        // Deliberately NOT using response_format here.
        // Some free models have inconsistent structured-output
        // support.
        temperature: 0.2,

        // Large enough for architecture JSON but not excessive.
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
        error: rawText.slice(0, 1000),
      });

      return {
        ok: false,
        error: `OpenRouter request failed with HTTP ${response.status}.`,
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
        error: "OpenRouter returned invalid JSON.",
      });

      return {
        ok: false,
        error: "OpenRouter returned invalid JSON.",
        attempts,
      };
    }

    const content = extractAssistantContent(data);

    if (!content) {
      attempts.push({
        models,
        success: false,
        status: response.status,
        error: "No assistant content returned.",
      });

      return {
        ok: false,
        error: "OpenRouter returned no assistant content.",
        attempts,
      };
    }

    const modelUsed =
      data?.model ||
      data?.choices?.[0]?.model ||
      (Array.isArray(models) ? models[0] : "unknown");

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
  const message = data?.choices?.[0]?.message;

  if (!message) {
    return "";
  }

  const content = message.content;

  if (typeof content === "string") {
    return content.trim();
  }

  // Some models/providers can return content as blocks.
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
// ROBUST JSON EXTRACTION
// ============================================================

function extractJSON(text) {
  if (!text || typeof text !== "string") {
    throw new Error("Empty AI response.");
  }

  let cleaned = text.trim();

  // Remove markdown code fences if a model ignored the
  // instruction and returned ```json ... ```
  cleaned = cleaned
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  // First attempt: entire response is JSON.
  try {
    return JSON.parse(cleaned);
  } catch {
    // Continue to extraction.
  }

  // Locate the first JSON object.
  const firstObject = cleaned.indexOf("{");

  if (firstObject === -1) {
    throw new Error("No JSON object found in AI response.");
  }

  // Balanced-brace extraction.
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = firstObject; i < cleaned.length; i++) {
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
    } else if (char === "}") {
      depth--;

      if (depth === 0) {
        const candidate = cleaned.slice(firstObject, i + 1);

        try {
          return JSON.parse(candidate);
        } catch {
          break;
        }
      }
    }
  }

  throw new Error("Could not parse a valid JSON object from AI response.");
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
  if (!architecture || typeof architecture !== "object") {
    architecture = {};
  }

  // ----------------------------------------------------------
  // Basic fields
  // ----------------------------------------------------------

  architecture.goal =
    architecture.goal ||
    goal;

  architecture.goal_understanding =
    architecture.goal_understanding ||
    "The AI analyzed the requested workspace goal.";

  architecture.required_capabilities =
    Array.isArray(architecture.required_capabilities)
      ? architecture.required_capabilities
      : [];

  architecture.agents =
    Array.isArray(architecture.agents)
      ? architecture.agents
      : [];

  architecture.tools =
    Array.isArray(architecture.tools)
      ? architecture.tools
      : [];

  architecture.workflow =
    Array.isArray(architecture.workflow)
      ? architecture.workflow
      : [];

  architecture.component_evaluation =
    Array.isArray(architecture.component_evaluation)
      ? architecture.component_evaluation
      : [];

  architecture.capability_gaps =
    Array.isArray(architecture.capability_gaps)
      ? architecture.capability_gaps
      : [];

  architecture.gap_solutions =
    Array.isArray(architecture.gap_solutions)
      ? architecture.gap_solutions
      : [];

  architecture.recommendations =
    Array.isArray(architecture.recommendations)
      ? architecture.recommendations
      : [];

  architecture.external_recommendations =
    Array.isArray(architecture.external_recommendations)
      ? architecture.external_recommendations
      : [];

  // ----------------------------------------------------------
  // Architecture summary
  // ----------------------------------------------------------

  architecture.architecture_summary =
    architecture.architecture_summary ||
    architecture.final_architecture?.summary ||
    "The workspace architecture was generated around the user's requested goal.";

  // ----------------------------------------------------------
  // Final architecture
  // ----------------------------------------------------------

  if (
    !architecture.final_architecture ||
    typeof architecture.final_architecture !== "object"
  ) {
    architecture.final_architecture = {};
  }

  architecture.final_architecture.agents =
    Array.isArray(architecture.final_architecture.agents)
      ? architecture.final_architecture.agents
      : architecture.agents.map((agent) => agent.name);

  architecture.final_architecture.tools =
    Array.isArray(architecture.final_architecture.tools)
      ? architecture.final_architecture.tools
      : architecture.tools.map((tool) => tool.name);

  architecture.final_architecture.connections =
    Array.isArray(architecture.final_architecture.connections)
      ? architecture.final_architecture.connections
      : [];

  // ----------------------------------------------------------
  // Review
  // ----------------------------------------------------------

  if (
    !architecture.review ||
    typeof architecture.review !== "object"
  ) {
    architecture.review = {};
  }

  architecture.review.summary =
    architecture.review.summary ||
    "The proposed workspace was reviewed for capability coverage, component fit, gaps, and practical autonomy.";

  architecture.review.strengths =
    Array.isArray(architecture.review.strengths)
      ? architecture.review.strengths
      : [];

  architecture.review.improvements =
    Array.isArray(architecture.review.improvements)
      ? architecture.review.improvements
      : [];

  architecture.review.remaining_gaps =
    Array.isArray(architecture.review.remaining_gaps)
      ? architecture.review.remaining_gaps
      : [];

  // ----------------------------------------------------------
  // Operational fields
  // ----------------------------------------------------------

  architecture.autonomy_logic =
    architecture.autonomy_logic || "";

  architecture.failure_recovery =
    architecture.failure_recovery || "";

  architecture.human_involvement =
    architecture.human_involvement || "";

  // ----------------------------------------------------------
  // Diagnostics
  // ----------------------------------------------------------

  architecture.model_used =
    modelUsed || "unknown";

  architecture.model_attempts =
    Array.isArray(attempts)
      ? attempts
      : [];

  architecture.builder_version =
    "V6";

  architecture.builder_mode =
    "LLM-first external discovery";

  return architecture;
}


// ============================================================
// JSON RESPONSE HELPER
// ============================================================

function jsonResponse(data, status, corsHeaders) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });
}
