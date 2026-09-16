export default {
  async fetch(request, env) {

    const cors = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type"
    };

    const out = (data, status = 200) =>
      new Response(
        JSON.stringify(data, null, 2),
        {
          status,
          headers: {
            ...cors,
            "Content-Type": "application/json",
            "Cache-Control": "no-store"
          }
        }
      );

    /*
    ============================================================
    OPTIONS
    ============================================================
    */

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: cors
      });
    }

    /*
    ============================================================
    GET
    PUBLIC AGENTS / TOOLS DIRECTORY ONLY
    Airtable is NOT used by Build My Stack.
    ============================================================
    */

    if (request.method === "GET") {

      try {

        if (!env.AIRTABLE_TOKEN) {
          return out(
            {
              error:
                "AIRTABLE_TOKEN is not configured on the Worker."
            },
            500
          );
        }

        const airtableUrl =
          "https://api.airtable.com/v0/appY6TPhOsmj3dIX8/" +
          encodeURIComponent("Table 1") +
          "?pageSize=100";

        const response =
          await fetch(
            airtableUrl,
            {
              headers: {
                Authorization:
                  `Bearer ${env.AIRTABLE_TOKEN}`,
                "Content-Type":
                  "application/json"
              }
            }
          );

        const text =
          await response.text();

        if (!response.ok) {

          return out(
            {
              error:
                "Failed to fetch the Agents / Tools directory from Airtable.",
              airtable_status:
                response.status,
              details:
                text.slice(0, 1000)
            },
            response.status
          );
        }

        const data =
          JSON.parse(text);

        const items =
          (data.records || []).map(
            record => {

              const fields =
                record.fields || {};

              return {
                id:
                  record.id,

                Name:
                  fields.Name ||
                  "Untitled",

                Type:
                  fields.Type ||
                  "Unknown",

                Description:
                  fields.Description ||
                  "",

                URL:
                  fields.URL ||
                  "",

                Category:
                  fields.Category ||
                  "Uncategorized",

                created:
                  record.createdTime ||
                  ""
              };
            }
          );

        return out(items);

      } catch (error) {

        return out(
          {
            error:
              error?.message ||
              "Unexpected directory error."
          },
          500
        );
      }
    }

    /*
    ============================================================
    POST
    BUILD MY STACK
    ============================================================
    */

    if (request.method !== "POST") {
      return out(
        {
          error:
            "Method not allowed."
        },
        405
      );
    }

    const pathname =
      new URL(request.url).pathname;

    if (pathname !== "/build-stack") {

      return out(
        {
          error:
            "Unknown endpoint."
        },
        404
      );
    }

    if (!env.OPENROUTER_KEY) {

      return out(
        {
          error:
            "OPENROUTER_KEY is not configured on the Worker."
        },
        500
      );
    }

    /*
    ============================================================
    READ REQUEST
    ============================================================
    */

    let body;

    try {

      body =
        await request.json();

    } catch {

      return out(
        {
          error:
            "Invalid JSON request."
        },
        400
      );
    }

    const goal =
      String(
        body?.goal || ""
      ).trim();

    if (!goal) {

      return out(
        {
          error:
            "A workspace goal is required."
        },
        400
      );
    }

    /*
    ============================================================
    FREE MODEL DISCOVERY
    ============================================================
    */

    async function getFreeModels() {

      const models = [
        "openrouter/free"
      ];

      try {

        const response =
          await fetch(
            "https://openrouter.ai/api/v1/models",
            {
              headers: {
                Authorization:
                  `Bearer ${env.OPENROUTER_KEY}`
              }
            }
          );

        if (!response.ok) {
          return models;
        }

        const data =
          await response.json();

        if (!Array.isArray(data.data)) {
          return models;
        }

        for (
          const model of data.data
        ) {

          const id =
            String(
              model?.id || ""
            ).trim();

          if (!id) {
            continue;
          }

          const promptPrice =
            String(
              model?.pricing?.prompt ??
              ""
            );

          const completionPrice =
            String(
              model?.pricing?.completion ??
              ""
            );

          const isFreeVariant =
            id.endsWith(":free");

          const isZeroPriced =
            promptPrice === "0" &&
            completionPrice === "0";

          if (
            isFreeVariant ||
            isZeroPriced
          ) {

            if (
              !models.includes(id)
            ) {
              models.push(id);
            }
          }
        }

      } catch {
        /*
        Keep openrouter/free.
        */
      }

      return models;
    }

    /*
    ============================================================
    JSON ARRAY EXTRACTION
    Same philosophy as Python scanner.
    ============================================================
    */

    function extractJsonArray(text) {

      if (!text) {
        return null;
      }

      let cleaned =
        String(text).trim();

      /*
      Direct JSON
      */

      try {

        const data =
          JSON.parse(cleaned);

        if (Array.isArray(data)) {
          return data;
        }

      } catch {}

      /*
      Remove markdown fences
      */

      cleaned =
        cleaned
          .replace(
            /^\s*```(?:json)?\s*/i,
            ""
          )
          .replace(
            /\s*```\s*$/i,
            ""
          )
          .trim();

      try {

        const data =
          JSON.parse(cleaned);

        if (Array.isArray(data)) {
          return data;
        }

      } catch {}

      /*
      Find first [ and last ]
      */

      const start =
        cleaned.indexOf("[");

      const end =
        cleaned.lastIndexOf("]");

      if (
        start !== -1 &&
        end !== -1 &&
        end > start
      ) {

        let candidate =
          cleaned.slice(
            start,
            end + 1
          );

        /*
        Remove trailing commas.
        */

        candidate =
          candidate.replace(
            /,\s*]/g,
            "]"
          );

        candidate =
          candidate.replace(
            /,\s*}/g,
            "}"
          );

        try {

          const data =
            JSON.parse(candidate);

          if (Array.isArray(data)) {
            return data;
          }

        } catch {}
      }

      return null;
    }

    /*
    ============================================================
    JSON OBJECT EXTRACTION
    ============================================================
    */

    function extractJsonObject(text) {

      if (!text) {
        return null;
      }

      let cleaned =
        String(text).trim();

      try {

        const data =
          JSON.parse(cleaned);

        if (
          data &&
          typeof data === "object" &&
          !Array.isArray(data)
        ) {
          return data;
        }

      } catch {}

      cleaned =
        cleaned
          .replace(
            /^\s*```(?:json)?\s*/i,
            ""
          )
          .replace(
            /\s*```\s*$/i,
            ""
          )
          .trim();

      try {

        const data =
          JSON.parse(cleaned);

        if (
          data &&
          typeof data === "object" &&
          !Array.isArray(data)
        ) {
          return data;
        }

      } catch {}

      const start =
        cleaned.indexOf("{");

      const end =
        cleaned.lastIndexOf("}");

      if (
        start !== -1 &&
        end !== -1 &&
        end > start
      ) {

        try {

          return JSON.parse(
            cleaned.slice(
              start,
              end + 1
            )
          );

        } catch {}
      }

      return null;
    }

    /*
    ============================================================
    OPENROUTER REQUEST
    IMPORTANT:
    No response_format.
    No tiny max_tokens.
    Same simple pattern as Python scanner.
    ============================================================
    */

    async function askModel(
      model,
      prompt
    ) {

      try {

        const response =
          await fetch(
            "https://openrouter.ai/api/v1/chat/completions",
            {
              method: "POST",

              headers: {
                Authorization:
                  `Bearer ${env.OPENROUTER_KEY}`,

                "Content-Type":
                  "application/json",

                "HTTP-Referer":
                  "https://autonomouswork.space",

                "X-Title":
                  "Autonomous Work Space"
              },

              body:
                JSON.stringify({
                  model,

                  messages: [
                    {
                      role:
                        "system",

                      content:
                        "Return ONLY valid JSON. No markdown. No code fences. No explanation. Only real existing products, projects and official websites. Do not invent products or URLs."
                    },

                    {
                      role:
                        "user",

                      content:
                        prompt
                    }
                  ],

                  temperature:
                    0.2
                })
            }
          );

        const raw =
          await response.text();

        if (!response.ok) {

          return {
            ok: false,

            reason:
              `HTTP ${response.status}`,

            details:
              raw.slice(
                0,
                1200
              )
          };
        }

        let data;

        try {

          data =
            JSON.parse(raw);

        } catch {

          return {
            ok: false,

            reason:
              "OpenRouter returned invalid JSON.",

            details:
              raw.slice(
                0,
                1200
              )
          };
        }

        let content =
          data?.choices?.[0]?.message?.content;

        /*
        Some providers return content blocks.
        */

        if (
          Array.isArray(content)
        ) {

          content =
            content
              .map(
                part => {

                  if (
                    typeof part ===
                    "string"
                  ) {
                    return part;
                  }

                  return String(
                    part?.text || ""
                  );
                }
              )
              .join("");
        }

        content =
          String(
            content || ""
          ).trim();

        if (!content) {

          return {
            ok: false,

            reason:
              "Model returned empty content.",

            details:
              raw.slice(
                0,
                1500
              )
          };
        }

        return {
          ok: true,
          content
        };

      } catch (error) {

        return {
          ok: false,

          reason:
            "OpenRouter request exception.",

          details:
            error?.message ||
            String(error)
        };
      }
    }

    /*
    ============================================================
    CLEAN DISCOVERED COMPONENTS
    ============================================================
    */

    function cleanComponents(
      items,
      type
    ) {

      const result = [];
      const seen = new Set();

      if (
        !Array.isArray(items)
      ) {
        return result;
      }

      for (
        const item of items
      ) {

        if (
          !item ||
          typeof item !== "object"
        ) {
          continue;
        }

        const name =
          String(
            item.name || ""
          ).trim();

        const description =
          String(
            item.description || ""
          ).trim();

        const url =
          String(
            item.url || ""
          ).trim();

        const category =
          String(
            item.category ||
            "General"
          ).trim();

        if (
          !name ||
          !description ||
          !url
        ) {
          continue;
        }

        try {

          const parsed =
            new URL(url);

          if (
            ![
              "http:",
              "https:"
            ].includes(
              parsed.protocol
            )
          ) {
            continue;
          }

        } catch {

          continue;
        }

        const key =
          name.toLowerCase();

        if (
          seen.has(key)
        ) {
          continue;
        }

        seen.add(key);

        result.push({
          name,
          type,
          category,
          description,
          url,

          availability:
            String(
              item.availability ||
              "Unknown"
            ),

          reason:
            String(
              item.reason || ""
            )
        });
      }

      return result;
    }

    /*
    ============================================================
    DISCOVER AGENTS OR TOOLS
    ============================================================
    */

    async function discoverType(
      type,
      models
    ) {

      const isAgent =
        type === "Agent";

      const categories =
        isAgent
          ? [
              "Research",
              "Coding",
              "Data",
              "Marketing",
              "Sales",
              "Customer Support",
              "Operations",
              "Browser",
              "Development",
              "Productivity"
            ]
          : [
              "Automation",
              "Orchestration",
              "Infrastructure",
              "Memory",
              "Database",
              "Communication",
              "Development",
              "Integration",
              "Monitoring",
              "Productivity"
            ];

      /*
      IMPORTANT:
      Ask for 4 rather than 6.

      This keeps the response comfortably inside
      free-model output limits while still giving
      the architecture enough real components.
      */

      const prompt =
        `Find 4 real, specific, currently existing ${
          isAgent
            ? "AI agents"
            : "AI tools or workflow platforms"
        } that are useful for this autonomous workspace goal.

GOAL:
${goal}

Rules:
- Only real existing products or open-source projects.
- Use official websites.
- Do not invent names.
- Do not invent URLs.
- Avoid duplicates.
- Choose products genuinely relevant to the goal.
- Categories must be exactly one of:
${categories.join(", ")}

Return ONLY a JSON array.

Each object MUST contain:
name
description
url
category
availability
reason

Description: one short factual sentence.
Reason: one short factual sentence explaining relevance.`;

      const failures = [];

      /*
      First try the official free router.

      Then try individually discovered free models.
      */

      const orderedModels = [
        "openrouter/free",
        ...models.filter(
          model =>
            model !==
            "openrouter/free"
        )
      ];

      for (
        const model of orderedModels.slice(
          0,
          8
        )
      ) {

        const response =
          await askModel(
            model,
            prompt
          );

        if (!response.ok) {

          failures.push({
            model,
            reason:
              response.reason,

            details:
              response.details
          });

          continue;
        }

        const parsed =
          extractJsonArray(
            response.content
          );

        const components =
          cleanComponents(
            parsed,
            type
          );

        if (
          components.length
        ) {

          return {
            items:
              components,

            model,

            failures
          };
        }

        failures.push({
          model,

          reason:
            "Model returned content but no valid components could be parsed.",

          details:
            response.content.slice(
              0,
              1000
            )
        });
      }

      return {
        items: [],
        model: null,
        failures
      };
    }

    /*
    ============================================================
    FALLBACK ARCHITECTURE
    If architecture reasoning fails, discovery still succeeds.
    ============================================================
    */

    function createFallbackArchitecture(
      components
    ) {

      const agents =
        components.filter(
          item =>
            item.type ===
            "Agent"
        );

      const tools =
        components.filter(
          item =>
            item.type ===
            "Tool"
        );

      const layers = [];

      if (
        agents.length
      ) {

        layers.push({
          number: 1,

          name:
            "Autonomous Agents",

          purpose:
            "Agents discovered specifically for the requested workspace goal.",

          why_needed:
            "These agents provide the autonomous execution capabilities required to perform the goal.",

          agents:
            agents.slice(
              0,
              4
            ),

          tools: []
        });
      }

      if (
        tools.length
      ) {

        layers.push({
          number:
            layers.length + 1,

          name:
            "Supporting Tools",

          purpose:
            "Tools discovered to support automation, integration, infrastructure and execution.",

          why_needed:
            "These tools provide supporting capabilities required to operate the autonomous workspace.",

          agents: [],

          tools:
            tools.slice(
              0,
              5
            )
        });
      }

      return {

        goal_summary:
          `Autonomous workspace designed for: ${goal}`,

        core_capabilities: [

          {
            name:
              "Autonomous execution",

            reason:
              "The workspace requires agents capable of performing meaningful work toward the stated goal."
          },

          {
            name:
              "Supporting automation",

            reason:
              "The workspace requires tools that enable automation, integration and reliable execution."
          }
        ],

        layers,

        gaps: [],

        recommendations: [],

        review: {

          summary:
            "The architecture was assembled from independently discovered real agents and tools. No unsupported external products were added.",

          improvements: [
            "The architecture can be refined further when additional reasoning capacity is available."
          ]
        },

        architecture_summary:
          "The workspace was created by independently discovering real agents and tools through OpenRouter free models. Airtable was not used as a source for Stack Builder discovery."
      };
    }

    /*
    ============================================================
    DISCOVER AGENTS
    ============================================================
    */

    const models =
      await getFreeModels();

    const agentResult =
      await discoverType(
        "Agent",
        models
      );

    /*
    ============================================================
    DISCOVER TOOLS
    ============================================================
    */

    const toolResult =
      await discoverType(
        "Tool",
        models
      );

    const components = [
      ...agentResult.items,
      ...toolResult.items
    ];

    /*
    ============================================================
    IF DISCOVERY FAILED
    RETURN REAL DIAGNOSTIC INFORMATION
    ============================================================
    */

    if (
      components.length === 0
    ) {

      return out(
        {
          success: false,

          error:
            "OpenRouter free-model discovery returned no usable components.",

          models_available:
            models,

          agents:
            agentResult.failures,

          tools:
            toolResult.failures
        },
        502
      );
    }

    /*
    ============================================================
    ARCHITECTURE PASS
    ============================================================
    */

    const catalog =
      components.map(
        item => ({
          name:
            item.name,

          type:
            item.type,

          category:
            item.category,

          description:
            item.description,

          url:
            item.url,

          availability:
            item.availability
        })
      );

    const architecturePrompt =
      `Design a practical autonomous workspace for this goal.

GOAL:
${goal}

AVAILABLE DISCOVERED COMPONENTS:
${JSON.stringify(
  catalog
)}

Use ONLY the components supplied above.

Return ONLY ONE valid JSON object.

Required structure:

{
  "goal_summary": "...",
  "core_capabilities": [
    {
      "name": "...",
      "reason": "..."
    }
  ],
  "layers": [
    {
      "number": 1,
      "name": "...",
      "purpose": "...",
      "why_needed": "...",
      "agents": [],
      "tools": []
    }
  ],
  "gaps": [
    {
      "capability": "...",
      "reason": "..."
    }
  ],
  "recommendations": [
    {
      "capability": "...",
      "reason": "..."
    }
  ],
  "review": {
    "summary": "...",
    "improvements": []
  },
  "architecture_summary": "..."
}

Rules:
- Design layers from the actual goal.
- Do not use a fixed template.
- Select only components that genuinely fit.
- Do not invent products.
- Do not invent URLs.
- Do not invent capabilities.
- Every selected component must include its actual name, category, URL, description and a reason for selection.
- Keep the architecture practical.
- Return JSON only.`;

    let architecture =
      null;

    let architectureModel =
      null;

    const architectureFailures =
      [];

    /*
    Try free models individually.
    */

    const architectureModels = [
      "openrouter/free",
      ...models.filter(
        model =>
          model !==
          "openrouter/free"
      )
    ];

    for (
      const model of architectureModels.slice(
        0,
        6
      )
    ) {

      const response =
        await askModel(
          model,
          architecturePrompt
        );

      if (!response.ok) {

        architectureFailures.push({
          model,
          reason:
            response.reason,

          details:
            response.details
        });

        continue;
      }

      const parsed =
        extractJsonObject(
          response.content
        );

      if (
        parsed &&
        Array.isArray(
          parsed.layers
        )
      ) {

        architecture =
          parsed;

        architectureModel =
          model;

        break;
      }

      architectureFailures.push({
        model,

        reason:
          "Invalid architecture JSON.",

        details:
          response.content.slice(
            0,
            1200
          )
      });
    }

    /*
    If reasoning architecture fails,
    NEVER throw away successful discovery.
    */

    if (!architecture) {

      architecture =
        createFallbackArchitecture(
          components
        );
    }

    /*
    ============================================================
    NORMALIZE ARCHITECTURE
    ============================================================
    */

    architecture.goal_summary =
      typeof architecture.goal_summary ===
      "string"
        ? architecture.goal_summary
        : `Autonomous workspace for: ${goal}`;

    architecture.core_capabilities =
      Array.isArray(
        architecture.core_capabilities
      )
        ? architecture.core_capabilities
        : [];

    architecture.layers =
      Array.isArray(
        architecture.layers
      )
        ? architecture.layers
        : [];

    architecture.gaps =
      Array.isArray(
        architecture.gaps
      )
        ? architecture.gaps
        : [];

    architecture.recommendations =
      Array.isArray(
        architecture.recommendations
      )
        ? architecture.recommendations
        : [];

    if (
      !architecture.review ||
      typeof architecture.review !==
        "object"
    ) {

      architecture.review = {
        summary: "",
        improvements: []
      };
    }

    architecture.review.improvements =
      Array.isArray(
        architecture.review.improvements
      )
        ? architecture.review.improvements
        : [];

    architecture.architecture_summary =
      typeof architecture.architecture_summary ===
      "string"
        ? architecture.architecture_summary
        : "";

    /*
    ============================================================
    FINAL RESPONSE
    ============================================================
    */

    return out(
      {
        success: true,

        architecture,

        discovery: {

          agents_found:
            agentResult.items.length,

          tools_found:
            toolResult.items.length,

          agent_model:
            agentResult.model,

          tool_model:
            toolResult.model,

          architecture_model:
            architectureModel,

          mode:
            "openrouter_free_independent_discovery"
        },

        failures: {

          agents:
            agentResult.failures,

          tools:
            toolResult.failures,

          architecture:
            architectureFailures
        }
      }
    );
  }
};
