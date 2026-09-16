export default {
  async fetch(request, env) {

    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };

    const json = (data, status = 200) =>
      new Response(
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


    /*
    ============================================================
    OPTIONS
    ============================================================
    */

    if (request.method === "OPTIONS") {
      return new Response(
        null,
        {
          status: 204,
          headers: corsHeaders,
        }
      );
    }


    /*
    ============================================================
    GET
    ============================================================

    GET is ONLY for the public Agents / Tools directory.

    Airtable is NOT used by Build My Stack.
    ============================================================
    */

    if (request.method === "GET") {

      try {

        if (!env.AIRTABLE_TOKEN) {

          return json(
            {
              error:
                "AIRTABLE_TOKEN is not configured on the Worker."
            },
            500
          );

        }


        const BASE_ID =
          "appY6TPhOsmj3dIX8";

        const TABLE_NAME =
          "Table 1";


        const response =
          await fetch(
            `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(TABLE_NAME)}?pageSize=100`,
            {
              headers: {
                Authorization:
                  `Bearer ${env.AIRTABLE_TOKEN}`,
              },
            }
          );


        const text =
          await response.text();


        if (!response.ok) {

          return json(
            {
              error:
                "Failed to fetch the Agents / Tools directory from Airtable.",

              airtable_status:
                response.status,

              details:
                text.slice(0, 1000),
            },
            response.status
          );

        }


        let data;

        try {

          data =
            JSON.parse(text);

        } catch {

          return json(
            {
              error:
                "Airtable returned invalid JSON."
            },
            502
          );

        }


        const items =
          Array.isArray(data.records)

            ? data.records.map(
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
                      "",
                  };

                }
              )

            : [];


        return json(
          items,
          200
        );


      } catch (error) {

        return json(
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
    ONLY POST /build-stack
    ============================================================
    */

    if (request.method !== "POST") {

      return json(
        {
          error:
            "Method not allowed."
        },
        405
      );

    }


    const url =
      new URL(request.url);


    if (
      url.pathname !==
      "/build-stack"
    ) {

      return json(
        {
          error:
            "Unknown endpoint."
        },
        404
      );

    }


    /*
    ============================================================
    OPENROUTER KEY
    ============================================================
    */

    if (!env.OPENROUTER_KEY) {

      return json(
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

      return json(
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

      return json(
        {
          error:
            "A workspace goal is required."
        },
        400
      );

    }


    /*
    ============================================================
    GET FREE MODELS
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
                  `Bearer ${env.OPENROUTER_KEY}`,
              },
            }
          );


        if (!response.ok) {

          return models;

        }


        const data =
          await response.json();


        const availableModels =
          Array.isArray(data?.data)
            ? data.data
            : [];


        for (
          const model
          of availableModels
        ) {

          const id =
            String(
              model?.id || ""
            );


          const promptPrice =
            Number(
              model?.pricing?.prompt ??
              NaN
            );


          const completionPrice =
            Number(
              model?.pricing?.completion ??
              NaN
            );


          const isFree =
            id.endsWith(":free") ||
            (
              promptPrice === 0 &&
              completionPrice === 0
            );


          if (
            id &&
            isFree &&
            !models.includes(id)
          ) {

            models.push(id);

          }

        }


      } catch {

        /*
        openrouter/free remains available
        as the first candidate.
        */

      }


      return models;

    }


    /*
    ============================================================
    PARSE JSON ARRAY
    ============================================================
    */

    function parseArray(text) {

      if (!text) {

        return null;

      }


      let cleaned =
        String(text).trim();


      /*
      Direct JSON
      */

      try {

        const parsed =
          JSON.parse(cleaned);


        if (
          Array.isArray(parsed)
        ) {

          return parsed;

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

        const parsed =
          JSON.parse(cleaned);


        if (
          Array.isArray(parsed)
        ) {

          return parsed;

        }

      } catch {}


      /*
      Extract array from surrounding text
      */

      const start =
        cleaned.indexOf("[");


      const end =
        cleaned.lastIndexOf("]");


      if (
        start !== -1 &&
        end > start
      ) {

        let candidate =
          cleaned.slice(
            start,
            end + 1
          );


        candidate =
          candidate.replace(
            /,\s*]/g,
            "]"
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


      return null;

    }


    /*
    ============================================================
    VALIDATE URL
    ============================================================
    */

    function validUrl(value) {

      try {

        const parsed =
          new URL(
            String(value || "")
          );


        return (
          parsed.protocol ===
            "http:" ||

          parsed.protocol ===
            "https:"
        );

      } catch {

        return false;

      }

    }


    /*
    ============================================================
    CLEAN COMPONENT
    ============================================================
    */

    function cleanComponent(
      item,
      expectedType,
      seen
    ) {

      if (
        !item ||
        typeof item !==
          "object"
      ) {

        return null;

      }


      const name =
        String(
          item.name || ""
        ).trim();


      const description =
        String(
          item.description || ""
        ).trim();


      const itemUrl =
        String(
          item.url || ""
        ).trim();


      const category =
        String(
          item.category || ""
        ).trim();


      if (
        !name ||
        !description ||
        !validUrl(itemUrl)
      ) {

        return null;

      }


      const key =
        name.toLowerCase();


      if (
        seen.has(key)
      ) {

        return null;

      }


      seen.add(key);


      return {

        name,

        type:
          expectedType,

        category:
          category ||
          "General",

        description,

        url:
          itemUrl,

        availability:
          String(
            item.availability ||
            "Unknown"
          ).trim(),

        reason:
          String(
            item.reason ||
            ""
          ).trim(),

      };

    }


    /*
    ============================================================
    OPENROUTER REQUEST
    ============================================================

    Deliberately simple.

    This follows the same basic request structure
    used by the working PythonAnywhere scanner.

    No response_format.
    No models fallback array.
    ============================================================
    */

    async function callModel(
      model,
      prompt,
      maxTokens
    ) {

      try {

        const response =
          await fetch(
            "https://openrouter.ai/api/v1/chat/completions",
            {

              method:
                "POST",

              headers: {

                Authorization:
                  `Bearer ${env.OPENROUTER_KEY}`,

                "Content-Type":
                  "application/json",

                "HTTP-Referer":
                  "https://autonomouswork.space",

                "X-Title":
                  "Autonomous Work Space",

              },


              body:
                JSON.stringify(
                  {

                    model,

                    messages: [

                      {
                        role:
                          "system",

                        content:
                          "Return ONLY valid JSON. No markdown. No code fences. No explanation. Do not invent products or URLs.",
                      },


                      {
                        role:
                          "user",

                        content:
                          prompt,
                      },

                    ],


                    temperature:
                      0.2,


                    max_tokens:
                      maxTokens,

                  }
                ),

            }
          );


        const raw =
          await response.text();


        if (!response.ok) {

          return {

            ok:
              false,

            reason:
              `HTTP ${response.status}`,

            details:
              raw.slice(
                0,
                1500
              ),

          };

        }


        let data;

        try {

          data =
            JSON.parse(raw);

        } catch {

          return {

            ok:
              false,

            reason:
              "OpenRouter returned invalid JSON.",

            details:
              raw.slice(
                0,
                1500
              ),

          };

        }


        let content =
          data
            ?.choices
            ?. [0]
            ?.message
            ?.content;


        /*
        Some models can return content
        as an array of blocks.
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
                    part?.text ||
                    ""
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

            ok:
              false,

            reason:
              "Model returned empty content.",

            details:
              JSON.stringify(
                data
              ).slice(
                0,
                1500
              ),

          };

        }


        return {

          ok:
            true,

          content,

        };


      } catch (error) {

        return {

          ok:
            false,

          reason:
            "OpenRouter request exception.",

          details:
            error?.message ||
            String(error),

        };

      }

    }


    /*
    ============================================================
    DISCOVER AGENTS OR TOOLS
    ============================================================
    */

    async function discoverType(
      type,
      needed,
      models
    ) {

      const categories =
        type === "Agent"

          ? "Research, Coding, Data, Marketing, Sales, Customer Support, Operations, Browser, Development, Productivity"

          : "Automation, Orchestration, Infrastructure, Memory, Database, Communication, Development, Integration, Monitoring, Productivity";


      const prompt = `

Find exactly ${needed} real, specific, currently existing ${
        type === "Agent"
          ? "AI agents"
          : "AI tools or platforms"
      } that could be useful for autonomous workspaces.

USER'S WORKSPACE GOAL:

${goal}

Only return products, platforms, or projects that actually exist.

Use their official website URL.

Do not invent names.

Do not invent products.

Do not invent URLs.

Do not return generic concepts.

Avoid duplicates.

Categories must be exactly one of:

${categories}

Return ONLY a JSON array.

Each object must contain:

name
description
url
category
availability
reason

Keep descriptions short and factual.

Keep reasons short and factual.

`;


      const failures =
        [];


      /*
      Try openrouter/free first,
      exactly like the Python scanner approach.
      */

      for (
        const model
        of models.slice(
          0,
          8
        )
      ) {

        const result =
          await callModel(
            model,
            prompt,
            2200
          );


        if (
          !result.ok
        ) {

          failures.push(
            {
              model,
              reason:
                result.reason,
              details:
                result.details,
            }
          );

          continue;

        }


        const parsed =
          parseArray(
            result.content
          );


        if (!parsed) {

          failures.push(
            {
              model,
              reason:
                "Could not parse JSON array.",
              details:
                result.content.slice(
                  0,
                  500
                ),
            }
          );

          continue;

        }


        const seen =
          new Set();


        const accepted =
          [];


        for (
          const item
          of parsed
        ) {

          const cleaned =
            cleanComponent(
              item,
              type,
              seen
            );


          if (
            cleaned
          ) {

            accepted.push(
              cleaned
            );

          }


          if (
            accepted.length >=
            needed
          ) {

            break;

          }

        }


        if (
          accepted.length
        ) {

          return {

            ok:
              true,

            items:
              accepted,

            model,

            failures,

          };

        }


        failures.push(
          {
            model,
            reason:
              "Model returned no valid components.",
          }
        );

      }


      return {

        ok:
          false,

        items:
          [],

        failures,

      };

    }


    /*
    ============================================================
    BUILD ARCHITECTURE
    ============================================================
    */

    async function buildArchitecture(
      components,
      models
    ) {

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

          })
        );


      const prompt = `

Build an autonomous workspace architecture for this goal:

${goal}

The following agents and tools were independently discovered through OpenRouter:

${JSON.stringify(
  catalog
)}

Use ONLY these discovered components.

Do NOT invent additional products.

Design the architecture around the actual goal.

Do not use a fixed seven-layer template.

Create only the layers actually needed.

Return ONLY one valid JSON object.

Use this structure:

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

      "agents": [
        {
          "name": "...",
          "category": "...",
          "url": "...",
          "description": "...",
          "reason": "..."
        }
      ],

      "tools": [
        {
          "name": "...",
          "category": "...",
          "url": "...",
          "description": "...",
          "reason": "..."
        }
      ]
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
    "improvements": [
      "..."
    ]
  },

  "architecture_summary": "..."
}

Every selected component must come from the supplied list.

Every selected component must have a concrete reason.

If an important capability cannot be covered, report it in gaps.

Do not invent a product to fill a gap.

`;


      const failures =
        [];


      for (
        const model
        of models.slice(
          0,
          8
        )
      ) {

        const result =
          await callModel(
            model,
            prompt,
            5000
          );


        if (
          !result.ok
        ) {

          failures.push(
            {
              model,
              reason:
                result.reason,
              details:
                result.details,
            }
          );

          continue;

        }


        let architecture =
          null;


        /*
        First try direct JSON.
        */

        try {

          architecture =
            JSON.parse(
              result.content
            );

        } catch {}


        /*
        If there is surrounding text,
        extract the JSON object.
        */

        if (
          !architecture
        ) {

          const start =
            result.content.indexOf(
              "{"
            );


          const end =
            result.content.lastIndexOf(
              "}"
            );


          if (
            start !== -1 &&
            end > start
          ) {

            try {

              architecture =
                JSON.parse(
                  result.content.slice(
                    start,
                    end + 1
                  )
                );

            } catch {}

          }

        }


        if (
          architecture &&
          typeof architecture ===
            "object" &&
          Array.isArray(
            architecture.layers
          )
        ) {

          return {

            ok:
              true,

            architecture,

            model,

            failures,

          };

        }


        failures.push(
          {
            model,
            reason:
              "Model returned an invalid architecture object.",
            details:
              result.content.slice(
                0,
                700
              ),
          }
        );

      }


      return {

        ok:
          false,

        failures,

      };

    }


    /*
    ============================================================
    FALLBACK ARCHITECTURE
    ============================================================

    This is only used if discovery succeeded but
    the architecture-reasoning pass failed.

    This prevents the entire Stack Builder from failing.
    ============================================================
    */

    function fallbackArchitecture(
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


      const layers =
        [];


      if (
        agents.length
      ) {

        layers.push(
          {

            number:
              1,

            name:
              "Autonomous Agents",

            purpose:
              "Agents that perform the autonomous work required by the workspace.",

            why_needed:
              "These agents provide the primary autonomous execution capabilities discovered for the requested goal.",

            agents:
              agents.slice(
                0,
                4
              ),

            tools:
              [],

          }
        );

      }


      if (
        tools.length
      ) {

        layers.push(
          {

            number:
              layers.length + 1,

            name:
              "Workspace Tools",

            purpose:
              "Tools and platforms supporting execution, automation, integration, or infrastructure.",

            why_needed:
              "These tools provide supporting capabilities for operating the autonomous workspace.",

            agents:
              [],

            tools:
              tools.slice(
                0,
                5
              ),

          }
        );

      }


      return {

        goal_summary:
          `An autonomous workspace assembled around this objective: ${goal}`,

        core_capabilities:
          [

            {
              name:
                "Autonomous task execution",

              reason:
                "The workspace requires agents capable of carrying out meaningful work toward the stated objective.",
            },

            {
              name:
                "Supporting execution",

              reason:
                "The workspace requires tools that help execute, automate, integrate, or support the work.",
            },

          ],


        layers,


        gaps:
          layers.length

            ? []

            : [

                {
                  capability:
                    "Usable discovered components",

                  reason:
                    "The discovery models did not return enough valid components to assemble the workspace.",
                },

              ],


        recommendations:
          [],


        review:
          {

            summary:
              "The workspace was assembled from independently discovered components. A deeper architecture reasoning pass was unavailable, so this fallback does not invent relationships or capabilities.",

            improvements:
              [

                "Run the build again when a free reasoning model is available for a deeper architecture pass.",

              ],

          },


        architecture_summary:
          "The workspace was created independently of Airtable by discovering real agents and tools through OpenRouter free models.",

      };

    }


    /*
    ============================================================
    START FREE MODEL DISCOVERY
    ============================================================
    */

    const models =
      await getFreeModels();


    /*
    ============================================================
    DISCOVER AGENTS
    ============================================================
    */

    const agentResult =
      await discoverType(
        "Agent",
        6,
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
        6,
        models
      );


    /*
    ============================================================
    COMBINE RESULTS
    ============================================================
    */

    const components =
      [

        ...(agentResult.items || []),

        ...(toolResult.items || []),

      ];


    /*
    ============================================================
    NOTHING FOUND
    ============================================================
    */

    if (
      !components.length
    ) {

      return json(
        {

          error:
            "OpenRouter free models did not return any usable agents or tools.",

          agent_failures:
            agentResult.failures ||
            [],

          tool_failures:
            toolResult.failures ||
            [],

          models_tried:
            models.slice(
              0,
              8
            ),

        },
        502
      );

    }


    /*
    ============================================================
    BUILD ARCHITECTURE
    ============================================================
    */

    const architectureResult =
      await buildArchitecture(
        components,
        models
      );


    const architecture =
      architectureResult.ok

        ? architectureResult.architecture

        : fallbackArchitecture(
            components
          );


    /*
    ============================================================
    NORMALIZE ARCHITECTURE
    ============================================================
    */

    if (
      !Array.isArray(
        architecture.core_capabilities
      )
    ) {

      architecture.core_capabilities =
        [];

    }


    if (
      !Array.isArray(
        architecture.layers
      )
    ) {

      architecture.layers =
        [];

    }


    if (
      !Array.isArray(
        architecture.gaps
      )
    ) {

      architecture.gaps =
        [];

    }


    if (
      !Array.isArray(
        architecture.recommendations
      )
    ) {

      architecture.recommendations =
        [];

    }


    if (
      !architecture.review ||
      typeof architecture.review !==
        "object"
    ) {

      architecture.review =
        {
          summary:
            "",
          improvements:
            [],
        };

    }


    if (
      !Array.isArray(
        architecture.review.improvements
      )
    ) {

      architecture.review.improvements =
        [];

    }


    if (
      typeof architecture.architecture_summary !==
      "string"
    ) {

      architecture.architecture_summary =
        "";

    }


    /*
    ============================================================
    FINAL RESPONSE
    ============================================================
    */

    return json(
      {

        success:
          true,

        architecture,


        discovery:
          {

            agents_found:
              agentResult.items?.length ||
              0,

            tools_found:
              toolResult.items?.length ||
              0,

            agent_model:
              agentResult.model ||
              null,

            tool_model:
              toolResult.model ||
              null,

            architecture_model:
              architectureResult.model ||
              null,

            mode:
              "openrouter_free_independent_discovery",

          },


        failures:
          {

            agents:
              agentResult.failures ||
              [],

            tools:
              toolResult.failures ||
              [],

            architecture:
              architectureResult.failures ||
              [],

          },

      }
    );

  }
};
