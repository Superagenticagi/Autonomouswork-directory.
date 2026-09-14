
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
          `https://airtable.com{BASE_ID}/${encodeURIComponent(TABLE_NAME)}?maxRecords=100`;

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
      const ecosystem = Array.isArray(body.ecosystem) ? body.ecosystem : [];

      if (!goal) {
        return new Response(
          JSON.stringify({ error: "A workspace goal is required." }),
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
          JSON.stringify({ error: "No ecosystem data was supplied." }),
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
       * STAGE 1: ARCHITECTURE SYNTHESIS PROMPTS
       * ============================================================
       */
      const synthesisSystemPrompt = `
You are the autonomous workspace architect for "Autonomous Work Space".
Your job is to transform a user's real-world goal into a practical, deeply reasoned autonomous workspace architecture.
This is NOT a simple directory recommendation task.
Select agents and tools ONLY from the supplied catalog. Never invent components.
Return ONLY valid JSON matching the requested schema. Do not include markdown wraps or text outside the JSON structure.
`;

      const synthesisUserPrompt = `
USER WORKSPACE GOAL:
${goal}

CURRENT AUTONOMOUS WORK SPACE CATALOG:
${JSON.stringify(catalog, null, 2)}

Analyze the user's goal carefully. Determine what the workspace needs to accomplish and map out the core capabilities.
Then construct a dynamic, multi-layered architecture using only appropriate catalog components.

Return JSON using exactly this structure:
{
  "goal_summary": "Detailed explanation of what the user is trying to build.",
  "core_capabilities": [
    {
      "name": "capability name",
      "reason": "Detailed explanation of why this capability is genuinely required."
    }
  ],
  "layers": [
    {
      "number": 1,
      "name": "meaningful layer name",
      "purpose": "Detailed explanation of what this layer handles.",
      "why_needed": "Why this layer is necessary for this specific goal.",
      "agents": [
        {
          "name": "exact catalog name",
          "reason": "Why this catalog agent was selected."
        }
      ],
      "tools": [
        {
          "name": "exact catalog name",
          "reason": "Why this catalog tool was selected."
        }
      ]
    }
  ]
}
`;

      /*
       * ============================================================
       * STAGE 2: VIRTUAL SIMULATION & STRESS TEST PROMPTS
       * ============================================================
       */
      const simulationSystemPrompt = `
You are an Autonomous Systems QA Engine. Your job is to take a proposed stack architecture and simulate transaction payloads passing sequentially through the tools.
You evaluate payload alignment, protocol blocks (e.g. JSON vs CSV friction), closed API obstacles, and single points of failure.
Return ONLY valid JSON matching the requested schema. Do not include markdown wraps or text outside the JSON structure.
`;

      const buildSimulationUserPrompt = (draftStack) => `
Analyze this proposed architecture stack for integration friction and structural capability gaps:

${JSON.stringify(draftStack, null, 2)}

Run a comprehensive "cognitive payload dry-run" across the layers. Verify if tools can realistically exchange data with each other without manual intervention.

Return JSON using exactly this structure:
{
  "simulation_passed": true,
  "data_flow_trace": "Detailed text mapping out step-by-step how a transactional payload moves cleanly through the generated layers.",
  "gaps": [
    {
      "capability": "missing or weak capability link",
      "reason": "Detailed explanation of why the current integration pipeline faces a block or limitation here."
    }
  ],
  "recommendations": [
    {
      "capability": "capability that could be improved",
      "reason": "Explain what kind of stronger capability, agent, or tool would improve the workspace."
    }
  ],
  "review": {
    "summary": "Critical self-review detailing the architectural weak spots, security/latency risks, and total performance fitness.",
    "improvements": [
      "Concrete improvement option 1",
      "Concrete improvement option 2"
    ]
  }
}
`;

      /*
       * ============================================================
       * FREE MODEL DISCOVERY (Your Original Engine Logic)
       * ============================================================
       */
      async function getFreeModels() {
        try {
          const response = await fetch("https://openrouter.ai", {
            headers: {
              Authorization: `Bearer ${env.OPENROUTER_KEY}`,
            },
          });

          if (!response.ok) return [];
          const data = await response.json();
          if (!Array.isArray(data.data)) return [];

          const freeModels = data.data
            .filter((model) => {
              const id = String(model.id || "");
              if (id.endsWith(":free")) return true;

              const promptPrice = Number(model?.pricing?.prompt || 0);
              const completionPrice = Number(model?.pricing?.completion || 0);
              return promptPrice === 0 && completionPrice === 0;
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
const modelCandidates = ["openrouter/free", ...discoveredFreeModels];
const uniqueModels = [...new Set(modelCandidates)];
const MAX_MODEL_ATTEMPTS = Math.min(uniqueModels.length, 8);
/*
* ============================================================
* UNIVERSAL LLM INVOKER WITH CLEANUP
* ============================================================
*/
async function callModel(model, systemPrompt, userPrompt) {
const response = await fetch("openrouter.ai", {
method: "POST",
headers: {
Authorization: Bearer ${env.OPENROUTER_KEY},
"Content-Type": "application/json",
"HTTP-Referer": "https://autonomouswork.space",
"X-Title": "Autonomous Work Space Builder",
},
body: JSON.stringify({
model,
messages: [
{ role: "system", content: systemPrompt },
{ role: "user", content: userPrompt },
],
temperature: 0.1,
max_tokens: 4000,
}),
});
const responseText = await response.text();
if (!response.ok) return null;
let data;
try {
data = JSON.parse(responseText);
} catch {
return null;
}
let content = data?.choices?.[0]?.message?.content;
if (Array.isArray(content)) {
content = content.map((part) => (typeof part === "string" ? part : part?.text || "")).join("");
}
content = String(content || "").trim();
// Strip unexpected markdown code block tags if the model returned them
content = content.replace(/^json\s*/i, "").replace(/\s*$/, "").trim();
try {
return JSON.parse(content);
} catch {
// Fallback parser attempt if trailing fragments exist
const start = content.indexOf("{");
const end = content.lastIndexOf("}");
if (start !== -1 && end !== -1 && end > start) {
try {
return JSON.parse(content.slice(start, end + 1));
} catch {
return null;
}
}
return null;
}
}
/*
* ============================================================
* RUN PIPELINE ACROSS ELIGIBLE FREE MODELS
* ============================================================
*/
let finalArchitecture = null;
let successfulModel = "";
let attempts = 0;
const failures = [];
for (const model of uniqueModels.slice(0, MAX_MODEL_ATTEMPTS)) {
attempts++;
// Pass 1: Build initial architecture blueprint
const draftStack = await callModel(model, synthesisSystemPrompt, synthesisUserPrompt);
if (!draftStack || !draftStack.layers) {
failures.push({ model, stage: "Synthesis Failed or Malformed JSON" });
continue;
}
// Pass 2: Autonomously simulate data pipelines and evaluate structural friction
const simulationResult = await callModel(model, simulationSystemPrompt, buildSimulationUserPrompt(draftStack));
if (!simulationResult || !simulationResult.review) {
failures.push({ model, stage: "Simulation Failed or Malformed JSON" });
continue;
}
// Pass 3: Assemble everything clean back into the front-end layout contract
finalArchitecture = {
goal_summary: draftStack.goal_summary || "Pipeline generation finished.",
core_capabilities: draftStack.core_capabilities || [],
layers: draftStack.layers || [],
gaps: simulationResult.gaps || [],
recommendations: simulationResult.recommendations || [],
review: simulationResult.review || { summary: "", improvements: [] },
architecture_summary: simulationResult.data_flow_trace || ""
};
successfulModel = model;
break; // Stop running down the candidate chain because an architecture passed checking completely
}
/*
* ============================================================
* ERROR HANDLING / EMPTY RETURNS
* ============================================================
*/
if (!finalArchitecture) {
return new Response(
JSON.stringify({
error: "All available free reasoning models failed to process the autonomous pipeline loops.",
attempts,
models_tried: uniqueModels.slice(0, MAX_MODEL_ATTEMPTS),
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
* RETURN FINAL BLUEPRINT TRACE TO FRONTEND
* ============================================================
*/
return new Response(
JSON.stringify(
{
success: true,
architecture: finalArchitecture,
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
error: error?.message || "Unexpected autonomous workflow orchestration error.",
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
