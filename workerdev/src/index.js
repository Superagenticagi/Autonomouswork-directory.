export default {
  async fetch(request, env) {
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };

    /*
    ============================================================
    CORS PREFLIGHT
    ============================================================
    */

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders,
      });
    }

    /*
    ============================================================
    GET /
    ============================================================

    Airtable remains ONLY the directory source.

    This is used by:
      - Agents page
      - Tools page
      - Directory-related frontend functions

    The Stack Builder DOES NOT use this data.
    */

    if (request.method === "GET") {
      try {
        const BASE_ID = "appY6TPhOsmj3dIX8";
        const TABLE_NAME = "Table 1";

        const airtableUrl =
          `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(
            TABLE_NAME
          )}?maxRecords=100`;

        const response = await fetch(airtableUrl, {
          method: "GET",
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
              status: response.status,
              details: errorText.slice(0, 500),
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
          Category:
            record.fields?.Category || "Uncategorized",
          created: record.createdTime,
        }));

        return new Response(
          JSON.stringify(items, null, 2),
          {
            status: 200,
            headers: {
              ...corsHeaders,
              "Content-Type": "application/json",
              "Cache-Control": "public, max-age=300",
            },
          }
        );
      } catch (error) {
        return new Response(
          JSON.stringify({
            error:
              error?.message ||
              "Airtable directory error",
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

    THIS IS THE ACTUAL STACK BUILDER.

    Airtable is NOT accessed here.

    No DuckDuckGo.
    No Google.
    No Bing.
    No Tavily.
    No external search API.

    The LLM itself:

      1. Understands the goal
      2. Identifies required capabilities
      3. Finds suitable agents/tools from its knowledge
      4. Evaluates those components
      5. Designs the workspace
      6. Checks capability coverage
      7. Finds gaps
      8. Solves gaps
      9. Refines the architecture
      10. Performs final self-review

    ONE MAIN LLM REQUEST
    + automatic free-model fallback
    + explicit free-model recovery if necessary
    */

    if (
      request.method === "POST" &&
      new URL(request.url).pathname === "/build-stack"
    ) {
      try {
        /*
        --------------------------------------------------------
        Validate OpenRouter key
        --------------------------------------------------------
        */

        if (!env.OPENROUTER_API_KEY) {
          return jsonResponse(
            {
              success: false,
              error:
                "OPENROUTER_API_KEY is not configured.",
            },
            500,
            corsHeaders
          );
        }

        /*
        --------------------------------------------------------
        Parse request
        --------------------------------------------------------
        */

        let body;

        try {
          body = await request.json();
        } catch {
          return jsonResponse(
            {
              success: false,
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
              success: false,
              error:
                "Please provide a workspace goal.",
            },
            400,
            corsHeaders
          );
        }

        /*
        --------------------------------------------------------
        Discover currently available FREE models
        --------------------------------------------------------
        */

        const freeModels =
          await discoverFreeModels(
            env.OPENROUTER_API_KEY
          );

        /*
        --------------------------------------------------------
        Build free-model fallback chain
        --------------------------------------------------------

        openrouter/free goes first.

        If it fails, explicit free models are available
        as fallback candidates.
        */

        const models = uniqueModels([
          "openrouter/free",
          ...freeModels,
        ]);

        /*
        --------------------------------------------------------
        MAIN BUILDER PROMPT
        --------------------------------------------------------

        This is deliberately a single coherent reasoning task.

        The model is NOT forced to perform six separate API
        calls. It gets the entire problem and solves it as
        one architecture problem.
        */

        const prompt = `
You are the core intelligence behind an autonomous workspace
builder called "Autonomous Work Space".

Your task is to design a complete autonomous workspace for the
USER GOAL below.

USER GOAL:
${userGoal}

============================================================
IMPORTANT OPERATING RULES
============================================================

1. DO NOT use Airtable.

Airtable is only the separate directory/database used by the
website's Agents and Tools pages.

The Stack Builder is completely independent of that directory.

2. DO NOT use DuckDuckGo.

3. DO NOT use Google search.

4. DO NOT use Bing search.

5. DO NOT use Tavily, Serper, Exa, or another external search API.

6. Do not claim that you performed live web research.

7. "Find agents and tools" means identify suitable real-world
agents, tools, platforms, frameworks and infrastructure from
your own knowledge and reasoning.

8. Do not invent products.

9. Do not invent capabilities.

10. Do not invent URLs.

11. Do not claim a product is free unless you are reasonably
confident.

12. The objective is NOT to produce a generic AI tools list.

The objective is to construct a coherent autonomous workspace
that can actually accomplish THIS user's goal.

============================================================
STEP 1 — UNDERSTAND THE GOAL
============================================================

Determine:

- What the user actually wants to accomplish.
- The desired final outcome.
- The major workflow.
- The inputs.
- The outputs.
- The important constraints.
- What "autonomous" means for this particular goal.

============================================================
STEP 2 — IDENTIFY REQUIRED CAPABILITIES
============================================================

Determine every important capability required.

Consider categories such as:

- research
- reasoning
- planning
- coding
- browser interaction
- data collection
- data processing
- automation
- orchestration
- APIs
- communication
- memory
- databases
- monitoring
- scheduling
- document handling
- content generation
- validation
- error recovery
- human approval

Do not force categories that are irrelevant.

Separate:

- critical capabilities
- important capabilities
- optional capabilities

============================================================
STEP 3 — FIND SUITABLE AGENTS AND TOOLS
============================================================

Now identify real agents, tools, platforms, frameworks and
infrastructure that could satisfy the required capabilities.

Think broadly.

Potential types include:

AGENTS:
- research agents
- coding agents
- browser agents
- data agents
- marketing agents
- sales agents
- customer-support agents
- operations agents
- general-purpose AI agents

TOOLS:
- automation platforms
- orchestration systems
- databases
- memory systems
- APIs
- communication tools
- monitoring systems
- developer tools
- infrastructure
- workflow systems

For each candidate explain:

- name
- type
- category
- purpose
- capability provided
- why it fits THIS goal
- limitations
- confidence

Do NOT simply select famous products.

Select components because they solve an actual requirement.

Prefer a smaller coherent stack over a huge collection.

============================================================
STEP 4 — DESIGN THE WORKSPACE
============================================================

Build the actual workspace architecture.

Determine:

- which agent performs each major task
- which tool supports each task
- how information moves between components
- where memory/state is stored
- how orchestration happens
- how failures are handled
- where human approval is required
- how the workflow reaches the desired outcome

The architecture should represent an actual workflow.

Do not merely list products.

============================================================
STEP 5 — EVALUATE COMPONENT MATCHES
============================================================

For every critical capability determine:

- which component handles it
- whether the match is strong, partial, weak or missing
- why

Look for:

- unnecessary components
- duplicate capabilities
- weak components
- integration problems
- missing infrastructure
- missing automation
- missing memory
- missing monitoring
- missing failure recovery

============================================================
STEP 6 — IDENTIFY GAPS
============================================================

After designing the first architecture, actively challenge it.

Ask:

"What would prevent this workspace from actually accomplishing
the user's goal?"

Identify every meaningful gap.

Do not hide weaknesses.

============================================================
STEP 7 — SOLVE THE GAPS
============================================================

For each important gap:

- propose a solution
- identify a suitable replacement/additional component
  when necessary
- explain how the solution fits into the architecture
- remove components that become unnecessary
- improve the workflow where appropriate

Do not solve gaps by adding random tools.

============================================================
STEP 8 — REBUILD THE ARCHITECTURE
============================================================

Produce the improved final architecture after gap solving.

The final architecture must be internally coherent.

Every critical capability should have a practical solution.

============================================================
STEP 9 — FINAL SELF-REVIEW
============================================================

Perform one final review.

Answer:

- Does this actually accomplish the user's goal?
- Are all critical capabilities covered?
- Are the selected agents/tools appropriate?
- Are integrations realistic?
- Is the system genuinely autonomous?
- Where does human intervention remain necessary?
- What are the remaining limitations?
- What could still be improved?

Do not merely criticize the architecture.

Return the corrected final architecture.

============================================================
OUTPUT RULE
============================================================

Return ONLY valid JSON.

No markdown.

No code fences.

No commentary outside the JSON.

Use this exact structure:

{
  "workspace_name": "",
  "workspace_purpose": "",

  "goal_understanding": {
    "summary": "",
    "desired_outcome": "",
    "primary_workflow": "",
    "inputs": [],
    "outputs": [],
    "constraints": [],
    "autonomy_definition": ""
  },

  "required_capabilities": [
    {
      "capability": "",
      "importance": "critical|important|optional",
      "reason": ""
    }
  ],

  "discovery": {
    "summary": "",

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

    "infrastructure": [
      {
        "name": "",
        "purpose": "",
        "reason": ""
      }
    ],

    "alternatives": []
  },

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

  "capability_mapping": [
    {
      "capability": "",
      "component": "",
      "match": "strong|partial|weak|missing",
      "reason": ""
    }
  ],

  "gaps_found": [
    {
      "gap": "",
      "impact": "",
      "reason": ""
    }
  ],

  "gap_solutions": [
    {
      "gap": "",
      "solution": "",
      "component": "",
      "reason": ""
    }
  ],

  "integration_plan": [],

  "failure_recovery": [],

  "monitoring": [],

  "human_intervention_points": [],

  "recommendations": [],

  "external_recommendations": [],

  "review": {
    "summary": "",
    "strengths": [],
    "remaining_limitations": [],
    "improvements": []
  }
}
`;

        /*
        ========================================================
        CALL LLM
        ========================================================
        */

        const result =
          await callLLMWithFallback({
            apiKey:
              env.OPENROUTER_API_KEY,

            models,

            prompt,

            maxTokens: 12000,
          });

        /*
        ========================================================
        NORMALIZE RESULT
        ========================================================
        */

        const architecture =
          normalizeArchitecture(
            result.data
          );

        /*
        ========================================================
        RETURN RESULT
        ========================================================
        */

        return jsonResponse(
          {
            success: true,

            builder: {
              version:
                "LLM-First-Builder-V5",

              airtable_used: false,

              external_search_used: false,

              discovery_mode:
                "LLM knowledge-based discovery",

              pipeline:
                [
                  "Goal understanding",
                  "Capability identification",
                  "Agent and tool discovery",
                  "Workspace architecture",
                  "Component evaluation",
                  "Gap identification",
                  "Gap solving",
                  "Architecture refinement",
                  "Final self-review",
                ],
            },

            model_used:
              result.model ||
              "openrouter/free",

            model_attempts:
              result.attempts || 1,

            architecture,
          },
          200,
          corsHeaders
        );
      } catch (error) {
        console.error(
          "STACK BUILDER ERROR:",
          error
        );

        return jsonResponse(
          {
            success: false,

            error:
              error?.message ||
              "The workspace could not be built.",

            details:
              "The Builder uses the LLM directly and does not use Airtable, DuckDuckGo, or another external search engine.",

            retryable: true,
          },
          500,
          corsHeaders
        );
      }
    }

    /*
    ============================================================
    UNKNOWN ROUTE
    ============================================================
    */

    return new Response(
      "Not found",
      {
        status: 404,
        headers: corsHeaders,
      }
    );
  },
};


/*
================================================================
DISCOVER FREE OPENROUTER MODELS
================================================================

Uses OpenRouter's official Models API.

The Builder does not assume a fixed list of free models.

It discovers currently available zero-cost models and creates
a fallback pool.

================================================================
*/

async function discoverFreeModels(apiKey) {
  try {
    const controller =
      new AbortController();

    const timeout =
      setTimeout(() => {
        controller.abort();
      }, 12000);

    const response =
      await fetch(
        "https://openrouter.ai/api/v1/models",
        {
          method: "GET",

          headers: {
            Authorization:
              `Bearer ${apiKey}`,

            "Content-Type":
              "application/json",
          },

          signal: controller.signal,
        }
      );

    clearTimeout(timeout);

    if (!response.ok) {
      return [];
    }

    const payload =
      await response.json();

    const models =
      Array.isArray(payload?.data)
        ? payload.data
        : [];

    const freeModels = [];

    for (const model of models) {
      if (!model?.id) {
        continue;
      }

      const id =
        String(model.id);

      /*
      OpenRouter explicitly identifies
      free variants with :free.

      Also detect models whose prompt
      and completion prices are zero.
      */

      const promptPrice =
        Number(
          model.pricing?.prompt || 0
        );

      const completionPrice =
        Number(
          model.pricing?.completion || 0
        );

      const isFreeVariant =
        id.endsWith(":free");

      const isZeroPriced =
        promptPrice === 0 &&
        completionPrice === 0;

      if (
        !isFreeVariant &&
        !isZeroPriced
      ) {
        continue;
      }

      /*
      Avoid obviously non-text output models.
      */

      const outputModalities =
        Array.isArray(
          model.architecture
            ?.output_modalities
        )
          ? model.architecture
              .output_modalities
          : [];

      if (
        outputModalities.length > 0 &&
        !outputModalities.includes(
          "text"
        )
      ) {
        continue;
      }

      freeModels.push({
        id,

        contextLength:
          Number(
            model.context_length || 0
          ),

        supportedParameters:
          Array.isArray(
            model.supported_parameters
          )
            ? model.supported_parameters
            : [],
      });
    }

    /*
    Prefer larger-context models.

    This matters because the Builder prompt
    is intentionally detailed.
    */

    freeModels.sort(
      (a, b) =>
        b.contextLength -
        a.contextLength
    );

    /*
    Keep a reasonable fallback pool.

    We don't need dozens of models.
    */

    return freeModels
      .map(
        (model) =>
          model.id
      )
      .filter(Boolean)
      .slice(0, 15);
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
LLM CALL WITH FREE MODEL FALLBACK
================================================================
*/

async function callLLMWithFallback({
  apiKey,
  models,
  prompt,
  maxTokens,
}) {
  const modelList =
    uniqueModels(models);

  if (!modelList.length) {
    throw new Error(
      "No free OpenRouter models were found."
    );
  }

  /*
  --------------------------------------------------------------
  FIRST ATTEMPT
  --------------------------------------------------------------

  OpenRouter's own free router is first.

  We also give OpenRouter a fallback models array.

  If the selected model/provider fails because of things such
  as rate limits, temporary unavailability, or provider errors,
  OpenRouter can move through the fallback list.
  */

  try {
    const result =
      await callOpenRouter({
        apiKey,

        model:
          "openrouter/free",

        models:
          modelList,

        prompt,

        maxTokens,

        timeoutMs:
          55000,
      });

    if (result.data) {
      return {
        ...result,
        attempts: 1,
      };
    }
  } catch (error) {
    console.error(
      "Primary free-model attempt failed:",
      error
    );
  }

  /*
  --------------------------------------------------------------
  SECONDARY FALLBACK
  --------------------------------------------------------------

  If the OpenRouter free router itself fails,
  explicitly try individual free models.

  This provides another layer of resilience.
  */

  const explicitModels =
    modelList.filter(
      (model) =>
        model !==
        "openrouter/free"
    );

  let attempts = 0;

  let lastError =
    null;

  /*
  Try up to 6 explicit free models.

  This prevents a single build from hammering
  the entire free model pool.
  */

  for (
    const model
    of explicitModels.slice(0, 6)
  ) {
    attempts++;

    try {
      const result =
        await callOpenRouter({
          apiKey,

          model,

          models: null,

          prompt,

          maxTokens,

          timeoutMs:
            45000,
        });

      if (result.data) {
        return {
          ...result,

          attempts:
            attempts + 1,
        };
      }
    } catch (error) {
      lastError =
        error;

      console.error(
        `Explicit free model failed: ${model}`,
        error
      );
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
  const controller =
    new AbortController();

  const timeout =
    setTimeout(() => {
      controller.abort();
    }, timeoutMs);

  try {
    const requestBody = {
      model,

      messages: [
        {
          role: "system",

          content:
            "You are the core intelligence of an autonomous workspace builder. Follow the user's requested schema exactly. Return valid JSON only. Do not use markdown fences. Do not invent products, capabilities, URLs, pricing, or facts.",
        },

        {
          role: "user",

          content: prompt,
        },
      ],

      /*
      Keep temperature low so the architecture
      remains consistent and structured.
      */

      temperature: 0.15,

      max_tokens:
        maxTokens,
    };

    /*
    OpenRouter native model fallback.

    The first model is attempted first and
    fallback models may be tried automatically
    when a model/provider request fails.
    */

    if (
      Array.isArray(models) &&
      models.length > 1
    ) {
      requestBody.models =
        models;
    }

    const response =
      await fetch(
        "https://openrouter.ai/api/v1/chat/completions",
        {
          method: "POST",

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

          body:
            JSON.stringify(
              requestBody
            ),

          signal:
            controller.signal,
        }
      );

    const rawText =
      await response.text();

    if (!response.ok) {
      throw new Error(
        `OpenRouter HTTP ${response.status}: ${rawText.slice(
          0,
          1000
        )}`
      );
    }

    let payload;

    try {
      payload =
        JSON.parse(rawText);
    } catch {
      throw new Error(
        "OpenRouter returned invalid JSON."
      );
    }

    const content =
      extractAssistantContent(
        payload
      );

    if (!content) {
      throw new Error(
        "OpenRouter returned no assistant content."
      );
    }

    const parsed =
      extractJSON(content);

    if (!parsed) {
      throw new Error(
        "The LLM returned a response that could not be parsed as JSON."
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
EXTRACT ASSISTANT CONTENT
================================================================
*/

function extractAssistantContent(
  payload
) {
  const message =
    payload?.choices?.[0]?.message;

  if (!message) {
    return "";
  }

  const content =
    message.content;

  if (
    typeof content ===
    "string"
  ) {
    return content.trim();
  }

  /*
  Some providers may return
  content blocks instead of a string.
  */

  if (
    Array.isArray(content)
  ) {
    return content
      .map((block) => {
        if (
          typeof block ===
          "string"
        ) {
          return block;
        }

        if (
          block &&
          typeof block.text ===
            "string"
        ) {
          return block.text;
        }

        if (
          block &&
          typeof block.content ===
            "string"
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

  let cleaned =
    String(text).trim();

  /*
  Remove accidental markdown fences.
  */

  cleaned =
    cleaned
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

  /*
  Direct parse.
  */

  try {
    return JSON.parse(
      cleaned
    );
  } catch {}

  /*
  Extract object from surrounding
  explanatory text.
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
      return JSON.parse(
        candidate
      );
    } catch {}
  }

  /*
  Extract array if necessary.
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
      return JSON.parse(
        candidate
      );
    } catch {}
  }

  return null;
}


/*
================================================================
NORMALIZE ARCHITECTURE
================================================================

This protects the frontend if the LLM omits an optional
field or returns an empty array.

================================================================
*/

function normalizeArchitecture(
  data
) {
  const source =
    data &&
    typeof data ===
      "object"
      ? data
      : {};

  const discovery =
    source.discovery &&
    typeof source.discovery ===
      "object"
      ? source.discovery
      : {};

  const review =
    source.review &&
    typeof source.review ===
      "object"
      ? source.review
      : {};

  return {
    workspace_name:
      source.workspace_name ||
      "Autonomous Workspace",

    workspace_purpose:
      source.workspace_purpose ||
      "",

    goal_understanding:
      source.goal_understanding ||
      {
        summary: "",
        desired_outcome: "",
        primary_workflow: "",
        inputs: [],
        outputs: [],
        constraints: [],
        autonomy_definition: "",
      },

    required_capabilities:
      Array.isArray(
        source.required_capabilities
      )
        ? source.required_capabilities
        : [],

    discovery: {
      summary:
        discovery.summary ||
        "",

      agents:
        Array.isArray(
          discovery.agents
        )
          ? discovery.agents
          : [],

      tools:
        Array.isArray(
          discovery.tools
        )
          ? discovery.tools
          : [],

      infrastructure:
        Array.isArray(
          discovery.infrastructure
        )
          ? discovery.infrastructure
          : [],

      alternatives:
        Array.isArray(
          discovery.alternatives
        )
          ? discovery.alternatives
          : [],
    },

    architecture_summary:
      source.architecture_summary ||
      "",

    architecture_logic:
      Array.isArray(
        source.architecture_logic
      )
        ? source.architecture_logic
        : [],

    selected_agents:
      Array.isArray(
        source.selected_agents
      )
        ? source.selected_agents
        : [],

    selected_tools:
      Array.isArray(
        source.selected_tools
      )
        ? source.selected_tools
        : [],

    capability_mapping:
      Array.isArray(
        source.capability_mapping
      )
        ? source.capability_mapping
        : [],

    gaps_found:
      Array.isArray(
        source.gaps_found
      )
        ? source.gaps_found
        : [],

    gap_solutions:
      Array.isArray(
        source.gap_solutions
      )
        ? source.gap_solutions
        : [],

    integration_plan:
      Array.isArray(
        source.integration_plan
      )
        ? source.integration_plan
        : [],

    failure_recovery:
      Array.isArray(
        source.failure_recovery
      )
        ? source.failure_recovery
        : [],

    monitoring:
      Array.isArray(
        source.monitoring
      )
        ? source.monitoring
        : [],

    human_intervention_points:
      Array.isArray(
        source.human_intervention_points
      )
        ? source.human_intervention_points
        : [],

    recommendations:
      Array.isArray(
        source.recommendations
      )
        ? source.recommendations
        : [],

    external_recommendations:
      Array.isArray(
        source.external_recommendations
      )
        ? source.external_recommendations
        : [],

    /*
    These fields are important because your
    existing Stack page expects them.
    */

    review: {
      summary:
        review.summary ||
        "The workspace was reviewed against the stated goal.",

      strengths:
        Array.isArray(
          review.strengths
        )
          ? review.strengths
          : [],

      remaining_limitations:
        Array.isArray(
          review.remaining_limitations
        )
          ? review.remaining_limitations
          : [],

      improvements:
        Array.isArray(
          review.improvements
        )
          ? review.improvements
          : [],
    },
  };
}


/*
================================================================
UNIQUE MODEL LIST
================================================================
*/

function uniqueModels(
  models
) {
  const result = [];

  const seen =
    new Set();

  for (
    const model
    of models || []
  ) {
    if (!model) {
      continue;
    }

    const id =
      String(model).trim();

    if (
      !id ||
      seen.has(id)
    ) {
      continue;
    }

    seen.add(id);

    result.push(id);
  }

  return result;
}


/*
================================================================
JSON RESPONSE
================================================================
*/

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

        "Cache-Control":
          "no-store",
      },
    }
  );
}
