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
      return new Response(
        JSON.stringify({
          error: "Method not allowed.",
        }),
        {
          status: 405,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json",
          },
        }
      );
    }

    try {
      /*
      ==========================================================
      GET
      ----------------------------------------------------------
      Keeps the public Airtable directory endpoint working.
      Stack Builder does NOT use Airtable.
      ==========================================================
      */

      if (request.method === "GET") {
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
              error: "Airtable request failed.",
              status: response.status,
              details: errorText.slice(0, 2000),
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

        const data = await response.json();

        const items = Array.isArray(data.records)
          ? data.records.map((record) => ({
              id: record.id,
              Name: record.fields?.Name || "Untitled",
              Type: record.fields?.Type || "Unknown",
              Description: record.fields?.Description || "",
              URL: record.fields?.URL || "",
              Category: record.fields?.Category || "Uncategorized",
              created: record.createdTime,
            }))
          : [];

        return new Response(JSON.stringify(items, null, 2), {
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json",
            "Cache-Control": "public, max-age=300",
          },
        });
      }

      /*
      ==========================================================
      POST /build-stack
      ==========================================================
      */

      const url = new URL(request.url);

      if (url.pathname !== "/build-stack") {
        return new Response(
          JSON.stringify({
            error: "Unknown endpoint.",
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

      /*
      ==========================================================
      OPENROUTER KEY
      ==========================================================
      */

      if (!env.OPENROUTER_KEY) {
        return new Response(
          JSON.stringify({
            error: "OPENROUTER_KEY is not configured.",
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
      ==========================================================
      READ USER GOAL
      ==========================================================
      */

      let body;

      try {
        body = await request.json();
      } catch {
        return new Response(
          JSON.stringify({
            error: "Request body must contain valid JSON.",
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

      const goal = String(body?.goal || "").trim();

      if (!goal) {
        return new Response(
          JSON.stringify({
            error: "A workspace goal is required.",
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

      /*
      ==========================================================
      SYSTEM PROMPT
      ==========================================================

      IMPORTANT:
      Airtable is intentionally NOT supplied to the model.

      The model must independently determine what the workspace
      needs and discover appropriate real agents/tools from its
      own knowledge.
      ==========================================================
      */

      const systemPrompt = `
You are the autonomous workspace architect for Autonomous Work Space.

Your job is to transform a user's real-world objective into a
practical autonomous workspace architecture.

IMPORTANT RULES:

1. The user's goal is the only starting input.
2. Do NOT use Airtable.
3. Do NOT assume a predefined directory.
4. Do NOT assume a fixed number of workspace layers.
5. Determine the capabilities required by the goal first.
6. Then identify real agents, tools, platforms, services, or
   open-source projects that could provide those capabilities.
7. Prefer genuinely free, open-source, or free-tier options when
   practical because this project is designed around zero-cost
   infrastructure.
8. Paid products may be mentioned when they are genuinely useful,
   but clearly mark them as paid.
9. Never invent a product, company, project, URL, capability,
   integration, or feature.
10. If you are not confident about a URL, return an empty string.
11. Do not force an agent or tool into the architecture merely
    because it is well known.
12. Each selected component must have a specific reason for being
    included.
13. The architecture must be derived from the user's goal.
14. Identify important capability gaps where no suitable component
    is available.
15. Critically review the resulting architecture.
16. Return ONLY valid JSON.
17. Do not use markdown fences.
18. Do not put commentary before or after the JSON.

The workspace can contain agents, tools, services, infrastructure,
memory systems, communication systems, databases, automation
systems, browsers, coding systems, research systems, or other
components when genuinely required.

The architecture should be practical rather than theoretical.
`;

      /*
      ==========================================================
      USER PROMPT
      ==========================================================
      */

      const userPrompt = `
USER WORKSPACE GOAL:

${goal}

Analyze this goal from the ground up.

First determine:

- What the user is actually trying to accomplish.
- Which capabilities are required.
- Which work stages are required.
- Which agents and tools could provide those capabilities.
- How those components should be organized.
- What important capabilities remain unsatisfied.

Do NOT assume that the answer must contain a fixed number of
layers.

Return exactly this JSON structure:

{
  "goal_summary": "Clear interpretation of the user's objective.",

  "core_capabilities": [
    {
      "name": "Capability name",
      "reason": "Why this capability is required."
    }
  ],

  "discovered_components": [
    {
      "name": "Exact real product, project, agent, service or tool name",
      "type": "Agent or Tool",
      "category": "Relevant category",
      "url": "Real URL if confidently known, otherwise empty string",
      "availability": "free, free tier, open source, paid, or unknown",
      "reason": "Why this component is relevant."
    }
  ],

  "layers": [
    {
      "number": 1,
      "name": "Layer name",
      "purpose": "What this layer does.",
      "why_needed": "Why this layer is required.",
      "agents": [
        {
          "name": "Exact component name",
          "reason": "Why this agent belongs here."
        }
      ],
      "tools": [
        {
          "name": "Exact component name",
          "reason": "Why this tool belongs here."
        }
      ]
    }
  ],

  "gaps": [
    {
      "capability": "Missing capability",
      "reason": "Why the workspace cannot fully satisfy it."
    }
  ],

  "recommendations": [
    {
      "name": "Real product/project/service name",
      "capability": "Capability it could provide",
      "url": "Real URL if confidently known, otherwise empty string",
      "reason": "Why it is worth considering."
    }
  ],

  "review": {
    "summary": "Critical assessment of the generated workspace.",
    "improvements": [
      "Specific improvement or limitation."
    ]
  },

  "architecture_summary": "Explain how the complete workspace works from input to final outcome."
}

QUALITY REQUIREMENTS:

- Use only real components.
- Do not invent URLs.
- Do not invent integrations.
- Do not blindly recommend popular AI products.
- Avoid unnecessary components.
- Prefer free/open-source/free-tier options where appropriate.
- Distinguish between agents and tools.
- Build only the layers actually required by the goal.
- Make the reasons specific to this user's goal.
- Identify genuine gaps rather than pretending everything is solved.
- The final architecture should describe an actual autonomous work
  system, not merely a list of products.
`;

      /*
      ==========================================================
      FREE MODEL DISCOVERY
      ==========================================================

      We still discover currently available free models, but we
      do NOT individually hammer them.

      OpenRouter's openrouter/free router remains the primary route.
      ==========================================================
      */

      async function getFreeModels() {
        try {
          const response = await fetch(
            "https://openrouter.ai/api/v1/models",
            {
              headers: {
                Authorization: `Bearer ${env.OPENROUTER_KEY}`,
              },
            }
          );

          if (!response.ok) {
            return [];
          }

          const data = await response.json();

          if (!Array.isArray(data?.data)) {
            return [];
          }

          const freeModels = data.data
            .filter((model) => {
              const id = String(model?.id || "");

              if (!id) {
                return false;
              }

              /*
              Explicit :free variants.
              */
              if (id.endsWith(":free")) {
                return true;
              }

              /*
              Some models expose zero pricing directly.
              */
              const promptPrice = Number(
                model?.pricing?.prompt ?? NaN
              );

              const completionPrice = Number(
                model?.pricing?.completion ?? NaN
              );

              return (
                Number.isFinite(promptPrice) &&
                Number.isFinite(completionPrice) &&
                promptPrice === 0 &&
                completionPrice === 0
              );
            })
            .map((model) => String(model.id))
            .filter(Boolean);

          return [...new Set(freeModels)];
        } catch {
          return [];
        }
      }

      const discoveredFreeModels = await getFreeModels();

      /*
      ==========================================================
      MODEL FALLBACK LIST
      ==========================================================

      openrouter/free is first.

      We then provide real free variants as fallbacks.

      We deliberately limit the list because failed requests can
      count against the free allowance.
      ==========================================================
      */

      const modelCandidates = [
        "openrouter/free",
        ...discoveredFreeModels,
      ];

      const uniqueModels = [
        ...new Set(
          modelCandidates
            .map((model) => String(model || "").trim())
            .filter(Boolean)
        ),
      ];

      /*
      Maximum fallback models in ONE OpenRouter request.
      This is model fallback, not sequential API calls.
      */

      const fallbackModels = uniqueModels.slice(0, 10);

      /*
      ==========================================================
      OPENROUTER REQUEST
      ==========================================================

      OpenRouter can automatically fall back between models using
      the "models" array.

      This is much better than making 8 separate API requests.
      ==========================================================
      */

      const requestBody = {
        model: "openrouter/free",

        /*
        OpenRouter automatic model fallback.
        */
        models: fallbackModels,

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

        temperature: 0.15,

        /*
        6000 is more than enough for the requested architecture
        while being substantially safer for free models.
        */
        max_tokens: 6000,

        /*
        Ask for JSON directly.

        openrouter/free filters for models supporting structured
        output capabilities.
        */
        response_format: {
          type: "json_object",
        },
      };

      let response;

      try {
        response = await fetch(
          "https://openrouter.ai/api/v1/chat/completions",
          {
            method: "POST",

            headers: {
              Authorization: `Bearer ${env.OPENROUTER_KEY}`,
              "Content-Type": "application/json",

              "HTTP-Referer":
                "https://autonomouswork.space",

              "X-Title":
                "Autonomous Work Space",
            },

            body: JSON.stringify(requestBody),
          }
        );
      } catch (error) {
        return new Response(
          JSON.stringify(
            {
              error:
                "Unable to connect to OpenRouter.",
              details:
                error?.message ||
                "Network request failed.",
            },
            null,
            2
          ),
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
      ==========================================================
      READ OPENROUTER RESPONSE
      ==========================================================
      */

      const responseText = await response.text();

      let data = null;

      try {
        data = JSON.parse(responseText);
      } catch {
        data = null;
      }

      /*
      ==========================================================
      HANDLE OPENROUTER ERRORS
      ==========================================================
      */

      if (!response.ok) {
        const providerError =
          data?.error?.message ||
          data?.error?.metadata?.raw ||
          responseText.slice(0, 3000);

        return new Response(
          JSON.stringify(
            {
              error:
                "OpenRouter could not build the workspace.",

              status:
                response.status,

              openrouter_error:
                providerError,

              models_attempted:
                fallbackModels,

              hint:
                response.status === 429
                  ? "OpenRouter free-model rate limit reached. Wait and try again."
                  : response.status === 401
                  ? "The OPENROUTER_KEY is invalid or unavailable to the Worker."
                  : response.status === 402
                  ? "OpenRouter rejected the request because the account has no available inference allowance."
                  : response.status === 404
                  ? "The selected free model route is unavailable."
                  : "The free-model route rejected the request."
            },
            null,
            2
          ),
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
      ==========================================================
      EXTRACT MODEL CONTENT
      ==========================================================
      */

      let content =
        data?.choices?.[0]?.message?.content;

      /*
      Some OpenRouter responses can return content blocks.
      */

      if (Array.isArray(content)) {
        content = content
          .map((part) => {
            if (typeof part === "string") {
              return part;
            }

            if (
              part &&
              typeof part.text === "string"
            ) {
              return part.text;
            }

            return "";
          })
          .join("");
      }

      content = String(content || "").trim();

      if (!content) {
        return new Response(
          JSON.stringify(
            {
              error:
                "OpenRouter returned no workspace content.",

              model:
                data?.model ||
                "unknown",

              raw_response:
                responseText.slice(0, 4000),
            },
            null,
            2
          ),
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
      ==========================================================
      PARSE ARCHITECTURE JSON
      ==========================================================
      */

      let architecture;

      try {
        architecture = JSON.parse(content);
      } catch {
        /*
        Defensive recovery if a model still surrounds JSON
        with unexpected text.
        */

        const firstBrace =
          content.indexOf("{");

        const lastBrace =
          content.lastIndexOf("}");

        if (
          firstBrace === -1 ||
          lastBrace === -1 ||
          lastBrace <= firstBrace
        ) {
          return new Response(
            JSON.stringify(
              {
                error:
                  "The reasoning model returned invalid workspace JSON.",

                model:
                  data?.model ||
                  "unknown",

                raw_content:
                  content.slice(0, 5000),
              },
              null,
              2
            ),
            {
              status: 502,
              headers: {
                ...corsHeaders,
                "Content-Type": "application/json",
              },
            }
          );
        }

        try {
          architecture = JSON.parse(
            content.slice(
              firstBrace,
              lastBrace + 1
            )
          );
        } catch {
          return new Response(
            JSON.stringify(
              {
                error:
                  "The reasoning model returned malformed workspace JSON.",

                model:
                  data?.model ||
                  "unknown",

                raw_content:
                  content.slice(0, 5000),
              },
              null,
              2
            ),
            {
              status: 502,
              headers: {
                ...corsHeaders,
                "Content-Type": "application/json",
              },
            }
          );
        }
      }

      /*
      ==========================================================
      VALIDATE ARCHITECTURE
      ==========================================================
      */

      if (
        !architecture ||
        typeof architecture !== "object" ||
        Array.isArray(architecture)
      ) {
        return new Response(
          JSON.stringify(
            {
              error:
                "The reasoning model returned an invalid workspace architecture.",
            },
            null,
            2
          ),
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
      ==========================================================
      NORMALIZE ARRAYS
      ==========================================================
      */

      if (
        !Array.isArray(
          architecture.core_capabilities
        )
      ) {
        architecture.core_capabilities = [];
      }

      if (
        !Array.isArray(
          architecture.discovered_components
        )
      ) {
        architecture.discovered_components = [];
      }

      if (
        !Array.isArray(
          architecture.layers
        )
      ) {
        architecture.layers = [];
      }

      if (
        !Array.isArray(
          architecture.gaps
        )
      ) {
        architecture.gaps = [];
      }

      if (
        !Array.isArray(
          architecture.recommendations
        )
      ) {
        architecture.recommendations = [];
      }

      /*
      ==========================================================
      NORMALIZE REVIEW
      ==========================================================
      */

      if (
        !architecture.review ||
        typeof architecture.review !== "object" ||
        Array.isArray(architecture.review)
      ) {
        architecture.review = {};
      }

      if (
        typeof architecture.review.summary !==
        "string"
      ) {
        architecture.review.summary = "";
      }

      if (
        !Array.isArray(
          architecture.review.improvements
        )
      ) {
        architecture.review.improvements = [];
      }

      /*
      ==========================================================
      NORMALIZE TOP-LEVEL TEXT
      ==========================================================
      */

      if (
        typeof architecture.goal_summary !==
        "string"
      ) {
        architecture.goal_summary = "";
      }

      if (
        typeof architecture.architecture_summary !==
        "string"
      ) {
        architecture.architecture_summary = "";
      }

      /*
      ==========================================================
      NORMALIZE DISCOVERED COMPONENTS
      ==========================================================
      */

      architecture.discovered_components =
        architecture.discovered_components
          .filter(
            (component) =>
              component &&
              typeof component === "object"
          )
          .map((component) => ({
            name: String(
              component.name || ""
            ).trim(),

            type:
              String(
                component.type || "Tool"
              ).trim() === "Agent"
                ? "Agent"
                : "Tool",

            category: String(
              component.category || ""
            ).trim(),

            url: String(
              component.url || ""
            ).trim(),

            availability: String(
              component.availability ||
                "unknown"
            ).trim(),

            reason: String(
              component.reason || ""
            ).trim(),
          }))
          .filter(
            (component) =>
              component.name
          );

      /*
      ==========================================================
      ADD DISCOVERY METADATA
      ==========================================================
      */

      architecture.discovery_mode =
        "openrouter_free_models";

      architecture.airtable_used =
        false;

      /*
      ==========================================================
      RETURN SUCCESS
      ==========================================================
      */

      return new Response(
        JSON.stringify(
          {
            success: true,

            architecture,

            model_used:
              data?.model ||
              "openrouter/free",

            model_attempts:
              Array.isArray(
                data?.choices
              )
                ? 1
                : 1,

            fallback_models:
              fallbackModels,

            discovery_mode:
              "openrouter_free_models",

            airtable_used:
              false,
          },
          null,
          2
        ),
        {
          status: 200,

          headers: {
            ...corsHeaders,
            "Content-Type":
              "application/json",

            "Cache-Control":
              "no-store",
          },
        }
      );
    } catch (error) {
      /*
      ==========================================================
      FINAL WORKER ERROR
      ==========================================================
      */

      return new Response(
        JSON.stringify(
          {
            error:
              error?.message ||
              "Unexpected Worker error.",

            type:
              error?.name ||
              "WorkerError",
          },
          null,
          2
        ),
        {
          status: 500,

          headers: {
            ...corsHeaders,
            "Content-Type":
              "application/json",
          },
        }
      );
    }
  },
};
