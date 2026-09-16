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

    /*
    ============================================================
    GET
    ============================================================

    IMPORTANT:
    GET remains the Airtable-powered directory endpoint.

    The Stack Builder does NOT use this ecosystem data.

    Agents / Tools pages can continue using:
      GET /

    Stack Builder uses:
      POST /build-stack
    */

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
              status: response.status,
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
            error: error?.message || "Directory error",
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

    /*
    ============================================================
    POST /build-stack
    ============================================================

    THIS IS THE AUTONOMOUS WORKSPACE BUILDER.

    Airtable is NOT read here.

    Pipeline:

      USER GOAL
          ↓
      UNDERSTAND GOAL
          ↓
      IDENTIFY REQUIRED CAPABILITIES
          ↓
      FIND SUITABLE AGENTS + TOOLS
          ↓
      DESIGN INITIAL WORKSPACE
          ↓
      EVALUATE MATCHES
          ↓
      IDENTIFY GAPS
          ↓
      SOLVE GAPS
          ↓
      REFINE WORKSPACE
          ↓
      FINAL SELF-REVIEW
    */

    if (
      request.method === "POST" &&
      new URL(request.url).pathname === "/build-stack"
    ) {
      try {
        if (!env.OPENROUTER_API_KEY) {
          return jsonResponse(
            {
              error: "OPENROUTER_API_KEY is not configured.",
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
              error: "Invalid JSON request body.",
            },
            400,
            corsHeaders
          );
        }

        const userGoal =
          typeof body?.goal === "string"
            ? body.goal.trim()
            : "";

        if (!userGoal) {
          return jsonResponse(
            {
              error: "Please provide a workspace goal.",
            },
            400,
            corsHeaders
          );
        }

        /*
        ========================================================
        FREE MODEL DISCOVERY
        ========================================================
        */

        const freeModels = await discoverFreeModels(
          env.OPENROUTER_API_KEY
        );

        /*
        Always put OpenRouter's free router first.

        Then use explicit free models as fallbacks.

        This means:
          1. openrouter/free gets first opportunity.
          2. If it fails, OpenRouter can use our models array.
          3. If the response is unusable, we manually retry
             using another free model.
        */

        const modelList = uniqueModels([
          "openrouter/free",
          ...freeModels,
        ]);

        /*
        ========================================================
        PHASE 1
        GOAL + CAPABILITY ANALYSIS
        ========================================================
        */

        const phase1Prompt = `
You are the planning intelligence of an autonomous-workspace builder.

The user wants to build an autonomous workspace.

USER GOAL:
${userGoal}

Your job is to deeply understand the goal before selecting anything.

Determine:

1. What the user is actually trying to accomplish.
2. The desired end result.
3. The main workflow that must happen.
4. The capabilities required.
5. Which parts require AI agents.
6. Which parts require tools/infrastructure.
7. Which parts require automation/orchestration.
8. Which parts require browser or external-service interaction.
9. Which parts require memory, databases, communication, monitoring, etc.
10. Important constraints.
11. Potential bottlenecks.
12. What a successful autonomous workspace should ultimately be able to do.

Do NOT use Airtable.
Do NOT assume the user's existing directory is the available ecosystem.
Do NOT restrict yourself to any supplied list of products.

Return ONLY valid JSON.

Schema:

{
  "goal_understanding": {
    "summary": "",
    "desired_outcome": "",
    "primary_workflow": ""
  },
  "required_capabilities": [
    {
      "capability": "",
      "importance": "critical|important|optional",
      "reason": ""
    }
  ],
  "agent_requirements": [],
  "tool_requirements": [],
  "automation_requirements": [],
  "constraints": [],
  "potential_bottlenecks": []
}
`;

        const phase1 = await callLLMWithFallback({
          apiKey: env.OPENROUTER_API_KEY,
          models: modelList,
          prompt: phase1Prompt,
          maxTokens: 6500,
        });

        /*
        ========================================================
        PHASE 2
        FIND / DISCOVER SUITABLE AGENTS + TOOLS
        ========================================================
        */

        const phase2Prompt = `
You are the discovery and architecture intelligence of an autonomous-workspace builder.

USER GOAL:
${userGoal}

Here is the previous capability analysis:

${JSON.stringify(phase1.data, null, 2)}

Now FIND suitable agents, tools, platforms, frameworks and infrastructure
from your knowledge that could realistically satisfy the requirements.

This is NOT an Airtable lookup.

Think broadly across:

- AI agents
- coding agents
- research agents
- browser agents
- data agents
- automation platforms
- orchestration systems
- databases
- memory systems
- communication systems
- APIs
- infrastructure
- monitoring
- developer tools
- open-source systems
- SaaS tools
- AI-native products

For every proposed component:

- give the real product/project name
- explain what it does
- explain why it fits
- identify which capability it satisfies
- distinguish agent vs tool vs infrastructure
- identify important limitations
- avoid inventing products
- avoid inventing URLs
- do not claim something is free unless you are reasonably confident
- do not select a product merely because it is popular

The goal is NOT to produce a generic AI-tools list.

The goal is to find components that can actually work together
to accomplish THIS user's goal.

Prefer a smaller number of strong components over a huge list.

Return ONLY valid JSON.

Schema:

{
  "discovery_summary": "",
  "agents": [
    {
      "name": "",
      "type": "Agent",
      "category": "",
      "purpose": "",
      "capabilities_matched": [],
      "why_it_fits": "",
      "limitations": "",
      "confidence": "high|medium|low"
    }
  ],
  "tools": [
    {
      "name": "",
      "type": "Tool",
      "category": "",
      "purpose": "",
      "capabilities_matched": [],
      "why_it_fits": "",
      "limitations": "",
      "confidence": "high|medium|low"
    }
  ],
  "infrastructure": [],
  "alternatives": []
}
`;

        const phase2 = await callLLMWithFallback({
          apiKey: env.OPENROUTER_API_KEY,
          models: modelList,
          prompt: phase2Prompt,
          maxTokens: 8000,
        });

        /*
        ========================================================
        PHASE 3
        WORKSPACE DESIGN + GAP SOLVING
        ========================================================
        */

        const phase3Prompt = `
You are the autonomous workspace architect.

USER GOAL:
${userGoal}

GOAL ANALYSIS:
${JSON.stringify(phase1.data, null, 2)}

DISCOVERED COMPONENTS:
${JSON.stringify(phase2.data, null, 2)}

Now design the actual autonomous workspace.

Do NOT simply repeat the discovered components.

Evaluate whether they actually work together.

Perform these operations:

1. Map each required capability to one or more components.
2. Determine the role of every selected component.
3. Remove components that do not materially contribute.
4. Identify missing capabilities.
5. Identify weak matches.
6. Identify duplicated functionality.
7. Identify integration problems.
8. Identify orchestration requirements.
9. Identify memory/state requirements.
10. Identify monitoring/failure-recovery requirements.
11. Solve important capability gaps.
12. Where a discovered component is inadequate, propose a better alternative.
13. Produce a coherent end-to-end workflow.

The resulting system should be an AUTONOMOUS WORKSPACE,
not merely a collection of AI tools.

Return ONLY valid JSON.

Schema:

{
  "workspace_name": "",
  "workspace_purpose": "",
  "architecture_summary": "",
  "architecture_logic": [
    {
      "step": 1,
      "component": "",
      "role": "",
      "input": "",
      "process": "",
      "output": "",
      "reason": ""
    }
  ],
  "selected_agents": [],
  "selected_tools": [],
  "infrastructure": [],
  "capability_mapping": [
    {
      "capability": "",
      "component": "",
      "match": "strong|partial|weak|missing",
      "reason": ""
    }
  ],
  "gaps_found": [],
  "gap_solutions": [],
  "integration_plan": [],
  "failure_recovery": [],
  "monitoring": [],
  "alternatives": []
}
`;

        const phase3 = await callLLMWithFallback({
          apiKey: env.OPENROUTER_API_KEY,
          models: modelList,
          prompt: phase3Prompt,
          maxTokens: 9500,
        });

        /*
        ========================================================
        PHASE 4
        FINAL REBUILD + SELF REVIEW
        ========================================================
        */

        const phase4Prompt = `
You are the final autonomous-workspace reviewer and architect.

USER GOAL:
${userGoal}

INITIAL GOAL ANALYSIS:
${JSON.stringify(phase1.data, null, 2)}

DISCOVERY:
${JSON.stringify(phase2.data, null, 2)}

WORKSPACE ARCHITECTURE:
${JSON.stringify(phase3.data, null, 2)}

Now perform a rigorous final review.

Check:

1. Does the architecture actually accomplish the user's goal?
2. Does every critical capability have a solution?
3. Are any components unnecessary?
4. Are any components poorly matched?
5. Are there hidden capability gaps?
6. Are integrations realistic?
7. Is the workflow genuinely autonomous?
8. Can the system recover from failures?
9. Are human intervention points clearly identified?
10. Are there obvious simpler alternatives?
11. Are any product claims uncertain?
12. Are any recommendations based only on popularity rather than fit?

Then REBUILD the architecture where necessary.

Do not merely criticize the previous architecture.

Return the corrected final architecture.

Return ONLY valid JSON.

Schema:

{
  "workspace_name": "",
  "workspace_purpose": "",
  "architecture_summary": "",
  "architecture_logic": [
    {
      "step": 1,
      "component": "",
      "role": "",
      "input": "",
      "process": "",
      "output": "",
      "reason": ""
    }
  ],
  "selected_agents": [
    {
      "name": "",
      "purpose": "",
      "reason": ""
    }
  ],
  "selected_tools": [
    {
      "name": "",
      "purpose": "",
      "reason": ""
    }
  ],
  "infrastructure": [],
  "capability_mapping": [],
  "gaps_solved": [],
  "integration_plan": [],
  "failure_recovery": [],
  "human_intervention_points": [],
  "review": {
    "summary": "",
    "strengths": [],
    "remaining_limitations": [],
    "improvements": []
  },
  "recommendations": [],
  "external_recommendations": []
}
`;

        const phase4 = await callLLMWithFallback({
          apiKey: env.OPENROUTER_API_KEY,
          models: modelList,
          prompt: phase4Prompt,
          maxTokens: 10500,
        });

        /*
        ========================================================
        FINAL RESPONSE
        ========================================================
        */

        const finalArchitecture = normalizeArchitecture(
          phase4.data,
          phase3.data,
          phase2.data
        );

        return jsonResponse(
          {
            success: true,

            builder: {
              version: "LLM-Discovery-Builder-V4",
              airtable_used: false,
              external_search_engine_used: false,
              discovery_mode:
                "LLM knowledge-based discovery",
            },

            model_used: phase4.model || phase3.model || phase2.model,
            model_attempts:
              (phase1.attempts || 0) +
              (phase2.attempts || 0) +
              (phase3.attempts || 0) +
              (phase4.attempts || 0),

            phases: {
              goal_analysis: true,
              capability_analysis: true,
              discovery: true,
              architecture: true,
              gap_solving: true,
              final_review: true,
            },

            architecture: finalArchitecture,
          },
          200,
          corsHeaders
        );
      } catch (error) {
        console.error("BUILD STACK ERROR:", error);

        return jsonResponse(
          {
            success: false,
            error: error?.message || "Stack Builder failed.",
            hint:
              "The Builder uses only free OpenRouter models and does not use Airtable for stack generation.",
          },
          500,
          corsHeaders
        );
      }
    }

    return new Response("Not found", {
      status: 404,
      headers: corsHeaders,
    });
  },
};


/*
================================================================
FREE MODEL DISCOVERY
================================================================
*/

async function discoverFreeModels(apiKey) {
  try {
    const controller = new AbortController();

    const timeout = setTimeout(() => {
      controller.abort();
    }, 15000);

    const response = await fetch(
      "https://openrouter.ai/api/v1/models",
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        signal: controller.signal,
      }
    );

    clearTimeout(timeout);

    if (!response.ok) {
      return [];
    }

    const payload = await response.json();

    const models = Array.isArray(payload?.data)
      ? payload.data
      : [];

    const free = [];

    for (const model of models) {
      if (!model || !model.id) {
        continue;
      }

      const id = String(model.id);

      const promptPrice =
        Number(model.pricing?.prompt || 0);

      const completionPrice =
        Number(model.pricing?.completion || 0);

      const explicitFree =
        id.endsWith(":free");

      const zeroPrice =
        promptPrice === 0 &&
        completionPrice === 0;

      if (!explicitFree && !zeroPrice) {
        continue;
      }

      /*
      Prefer models that support normal chat generation.
      */

      const supported =
        Array.isArray(model.supported_parameters)
          ? model.supported_parameters
          : [];

      /*
      We don't require structured outputs because that can
      exclude otherwise usable free models.

      We only exclude obvious non-text models.
      */

      const outputModalities =
        Array.isArray(model.architecture?.output_modalities)
          ? model.architecture.output_modalities
          : [];

      if (
        outputModalities.length > 0 &&
        !outputModalities.includes("text")
      ) {
        continue;
      }

      free.push({
        id,
        contextLength:
          Number(model.context_length || 0),
        supportsTools:
          supported.includes("tools"),
      });
    }

    /*
    Prefer larger-context models and tool-capable models,
    while keeping everything free.
    */

    free.sort((a, b) => {
      if (a.supportsTools !== b.supportsTools) {
        return a.supportsTools ? -1 : 1;
      }

      return b.contextLength - a.contextLength;
    });

    return free
      .map((model) => model.id)
      .filter(Boolean)
      .slice(0, 20);
  } catch (error) {
    console.error(
      "FREE MODEL DISCOVERY ERROR:",
      error
    );

    return [];
  }
}


/*
================================================================
OPENROUTER LLM CALL WITH FREE-MODEL FALLBACK
================================================================
*/

async function callLLMWithFallback({
  apiKey,
  models,
  prompt,
  maxTokens = 8000,
}) {
  const unique = uniqueModels(models);

  if (!unique.length) {
    throw new Error(
      "No free OpenRouter models are available."
    );
  }

  /*
  --------------------------------------------------------------
  ATTEMPT 1
  --------------------------------------------------------------

  Use OpenRouter's native model fallback.

  If the primary model fails, OpenRouter automatically tries
  the next model in the models array.
  */

  try {
    const result = await callOpenRouter({
      apiKey,
      model: "openrouter/free",
      models: unique,
      prompt,
      maxTokens,
      timeoutMs: 45000,
    });

    if (result.data) {
      return {
        ...result,
        attempts: 1,
      };
    }
  } catch (error) {
    console.error(
      "Native OpenRouter fallback failed:",
      error
    );
  }

  /*
  --------------------------------------------------------------
  ATTEMPT 2
  --------------------------------------------------------------

  Explicitly try individual free models.

  This is the backup layer if the router returns a response
  that cannot be parsed or if the router itself fails.
  */

  const explicitModels = unique.filter(
    (model) => model !== "openrouter/free"
  );

  let attempts = 0;
  let lastError = null;

  for (const model of explicitModels) {
    attempts++;

    try {
      const result = await callOpenRouter({
        apiKey,
        model,
        models: null,
        prompt,
        maxTokens,
        timeoutMs: 40000,
      });

      if (result.data) {
        return {
          ...result,
          attempts,
        };
      }
    } catch (error) {
      lastError = error;

      console.error(
        `Free model failed: ${model}`,
        error
      );
    }

    /*
    Don't hammer the free pool.
    */

    if (attempts >= 8) {
      break;
    }
  }

  throw new Error(
    lastError?.message ||
      "All available free OpenRouter models failed."
  );
}


/*
================================================================
OPENROUTER REQUEST
================================================================
*/

async function callOpenRouter({
  apiKey,
  model,
  models,
  prompt,
  maxTokens,
  timeoutMs,
}) {
  const controller = new AbortController();

  const timeout = setTimeout(() => {
    controller.abort();
  }, timeoutMs);

  const body = {
    model,
    messages: [
      {
        role: "system",
        content:
          "You are a careful autonomous-workspace architect. Follow the requested JSON schema exactly. Do not add markdown fences around JSON. Do not invent products, URLs, capabilities, pricing, or facts.",
      },
      {
        role: "user",
        content: prompt,
      },
    ],
    temperature: 0.2,
    max_tokens: maxTokens,
  };

  /*
  OpenRouter native model fallback.

  The first model is attempted first and the next models are
  automatically tried if OpenRouter encounters a model/provider
  error such as rate limiting or unavailable provider.
  */

  if (Array.isArray(models) && models.length > 1) {
    body.models = models;
  }

  try {
    const response = await fetch(
      "https://openrouter.ai/api/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "HTTP-Referer":
            "https://autonomouswork-directory.pages.dev/",
          "X-Title": "Autonomous Work Space",
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      }
    );

    const rawText = await response.text();

    if (!response.ok) {
      throw new Error(
        `OpenRouter HTTP ${response.status}: ${rawText.slice(
          0,
          800
        )}`
      );
    }

    let payload;

    try {
      payload = JSON.parse(rawText);
    } catch {
      throw new Error(
        "OpenRouter returned invalid JSON."
      );
    }

    const content =
      extractAssistantContent(payload);

    if (!content) {
      throw new Error(
        "OpenRouter returned no assistant content."
      );
    }

    const parsed = extractJSON(content);

    if (!parsed) {
      throw new Error(
        "LLM response could not be converted into valid JSON."
      );
    }

    return {
      data: parsed,
      raw: content,
      model:
        payload.model ||
        model ||
        "unknown",
    };
  } finally {
    clearTimeout(timeout);
  }
}


/*
================================================================
ASSISTANT CONTENT EXTRACTION
================================================================
*/

function extractAssistantContent(payload) {
  const message =
    payload?.choices?.[0]?.message;

  if (!message) {
    return "";
  }

  const content = message.content;

  if (typeof content === "string") {
    return content.trim();
  }

  /*
  Some providers may return content blocks.
  */

  if (Array.isArray(content)) {
    return content
      .map((block) => {
        if (typeof block === "string") {
          return block;
        }

        if (
          block &&
          typeof block.text === "string"
        ) {
          return block.text;
        }

        if (
          block &&
          typeof block.content === "string"
        ) {
          return block.content;
        }

        return "";
      })
      .join("\n")
      .trim();
  }

  return "";
}


/*
================================================================
ROBUST JSON EXTRACTION
================================================================
*/

function extractJSON(text) {
  if (!text) {
    return null;
  }

  let cleaned = String(text).trim();

  /*
  Remove markdown fences.
  */

  cleaned = cleaned
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  /*
  Direct JSON attempt.
  */

  try {
    return JSON.parse(cleaned);
  } catch {}

  /*
  Find first object.
  */

  const objectStart =
    cleaned.indexOf("{");

  const objectEnd =
    cleaned.lastIndexOf("}");

  if (
    objectStart !== -1 &&
    objectEnd > objectStart
  ) {
    const candidate =
      cleaned.slice(
        objectStart,
        objectEnd + 1
      );

    try {
      return JSON.parse(candidate);
    } catch {}
  }

  /*
  Find first array.
  */

  const arrayStart =
    cleaned.indexOf("[");

  const arrayEnd =
    cleaned.lastIndexOf("]");

  if (
    arrayStart !== -1 &&
    arrayEnd > arrayStart
  ) {
    const candidate =
      cleaned.slice(
        arrayStart,
        arrayEnd + 1
      );

    try {
      return JSON.parse(candidate);
    } catch {}
  }

  return null;
}


/*
================================================================
NORMALIZE FINAL ARCHITECTURE
================================================================
*/

function normalizeArchitecture(
  finalData,
  previousArchitecture,
  discovery
) {
  const final =
    finalData && typeof finalData === "object"
      ? finalData
      : {};

  const previous =
    previousArchitecture &&
    typeof previousArchitecture === "object"
      ? previousArchitecture
      : {};

  const discovered =
    discovery &&
    typeof discovery === "object"
      ? discovery
      : {};

  const review =
    final.review &&
    typeof final.review === "object"
      ? final.review
      : {};

  return {
    workspace_name:
      final.workspace_name ||
      previous.workspace_name ||
      "Autonomous Workspace",

    workspace_purpose:
      final.workspace_purpose ||
      previous.workspace_purpose ||
      "",

    architecture_summary:
      final.architecture_summary ||
      previous.architecture_summary ||
      "",

    architecture_logic:
      Array.isArray(final.architecture_logic)
        ? final.architecture_logic
        : Array.isArray(previous.architecture_logic)
        ? previous.architecture_logic
        : [],

    selected_agents:
      Array.isArray(final.selected_agents)
        ? final.selected_agents
        : Array.isArray(previous.selected_agents)
        ? previous.selected_agents
        : discovered.agents || [],

    selected_tools:
      Array.isArray(final.selected_tools)
        ? final.selected_tools
        : Array.isArray(previous.selected_tools)
        ? previous.selected_tools
        : discovered.tools || [],

    infrastructure:
      Array.isArray(final.infrastructure)
        ? final.infrastructure
        : previous.infrastructure || [],

    capability_mapping:
      Array.isArray(final.capability_mapping)
        ? final.capability_mapping
        : previous.capability_mapping || [],

    gaps_solved:
      Array.isArray(final.gaps_solved)
        ? final.gaps_solved
        : previous.gap_solutions || [],

    integration_plan:
      Array.isArray(final.integration_plan)
        ? final.integration_plan
        : previous.integration_plan || [],

    failure_recovery:
      Array.isArray(final.failure_recovery)
        ? final.failure_recovery
        : previous.failure_recovery || [],

    human_intervention_points:
      Array.isArray(
        final.human_intervention_points
      )
        ? final.human_intervention_points
        : [],

    review: {
      summary:
        review.summary ||
        "The workspace was reviewed against the stated user goal.",

      strengths:
        Array.isArray(review.strengths)
          ? review.strengths
          : [],

      remaining_limitations:
        Array.isArray(
          review.remaining_limitations
        )
          ? review.remaining_limitations
          : [],

      improvements:
        Array.isArray(review.improvements)
          ? review.improvements
          : [],
    },

    recommendations:
      Array.isArray(final.recommendations)
        ? final.recommendations
        : [],

    external_recommendations:
      Array.isArray(
        final.external_recommendations
      )
        ? final.external_recommendations
        : [],
  };
}


/*
================================================================
MODEL UTILITIES
================================================================
*/

function uniqueModels(models) {
  const result = [];
  const seen = new Set();

  for (const model of models || []) {
    if (!model) {
      continue;
    }

    const id = String(model).trim();

    if (!id || seen.has(id)) {
      continue;
    }

    seen.add(id);
    result.push(id);
  }

  return result;
}


/*
================================================================
JSON RESPONSE HELPER
================================================================
*/

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
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      },
    }
  );
}
