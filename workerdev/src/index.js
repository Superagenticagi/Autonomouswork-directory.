export default {

  async fetch(request, env) {

    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };


    /*
    ==========================================================
    CORS
    ==========================================================
    */

    if (request.method === "OPTIONS") {

      return new Response(null, {
        status: 204,
        headers: corsHeaders,
      });

    }


    if (!["GET", "POST"].includes(request.method)) {

      return new Response(
        JSON.stringify({
          error: "Method not allowed",
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
      Return Autonomous Work Space ecosystem from Airtable
      ==========================================================
      */

      if (request.method === "GET") {

        const BASE_ID =
          "appY6TPhOsmj3dIX8";

        const TABLE_NAME =
          "Table 1";


        const airtableUrl =
          `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(TABLE_NAME)}?maxRecords=100`;


        const response =
          await fetch(
            airtableUrl,
            {
              headers: {
                Authorization:
                  `Bearer ${env.AIRTABLE_TOKEN}`,
                "Content-Type":
                  "application/json",
              },
            }
          );


        if (!response.ok) {

          const errorText =
            await response.text();

          return new Response(
            JSON.stringify({
              error:
                "Failed to fetch ecosystem from Airtable.",
              details:
                errorText.slice(0, 500),
            }),
            {
              status:
                response.status,

              headers: {
                ...corsHeaders,
                "Content-Type":
                  "application/json",
              },
            }
          );

        }


        const data =
          await response.json();


        const items =
          data.records.map(
            record => ({

              id:
                record.id,

              Name:
                record.fields.Name ||
                "Untitled",

              Type:
                record.fields.Type ||
                "Unknown",

              Description:
                record.fields.Description ||
                "",

              URL:
                record.fields.URL ||
                "",

              Category:
                record.fields.Category ||
                "Uncategorized",

              created:
                record.createdTime,

            })
          );


        return new Response(
          JSON.stringify(
            items,
            null,
            2
          ),
          {
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


      /*
      ==========================================================
      POST ROUTING
      ==========================================================
      */

      const url =
        new URL(
          request.url
        );


      if (
        url.pathname !== "/build-stack"
      ) {

        return new Response(
          JSON.stringify({
            error:
              "Unknown endpoint",
          }),
          {
            status: 404,

            headers: {
              ...corsHeaders,

              "Content-Type":
                "application/json",
            },
          }
        );

      }


      /*
      ==========================================================
      CHECK OPENROUTER KEY
      ==========================================================
      */

      if (!env.OPENROUTER_KEY) {

        return new Response(
          JSON.stringify({
            error:
              "OPENROUTER_KEY is not configured on the Worker.",
          }),
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


      /*
      ==========================================================
      READ REQUEST
      ==========================================================
      */

      let body;


      try {

        body =
          await request.json();

      } catch {

        return new Response(
          JSON.stringify({
            error:
              "Invalid JSON request.",
          }),
          {
            status: 400,

            headers: {
              ...corsHeaders,

              "Content-Type":
                "application/json",
            },
          }
        );

      }


      const goal =
        String(
          body.goal || ""
        ).trim();


      const ecosystem =
        Array.isArray(
          body.ecosystem
        )
          ? body.ecosystem
          : [];


      if (!goal) {

        return new Response(
          JSON.stringify({
            error:
              "A workspace goal is required.",
          }),
          {
            status: 400,

            headers: {
              ...corsHeaders,

              "Content-Type":
                "application/json",
            },
          }
        );

      }


      if (!ecosystem.length) {

        return new Response(
          JSON.stringify({
            error:
              "No ecosystem data was supplied.",
          }),
          {
            status: 400,

            headers: {
              ...corsHeaders,

              "Content-Type":
                "application/json",
            },
          }
        );

      }


      /*
      ==========================================================
      BUILD VERIFIED CATALOG
      ==========================================================
      */

      const catalog =
        ecosystem
          .slice(0, 100)
          .map(
            item => ({

              name:
                String(
                  item.Name ||
                  item.name ||
                  ""
                ),

              type:
                String(
                  item.Type ||
                  item.type ||
                  ""
                ),

              category:
                String(
                  item.Category ||
                  item.category ||
                  ""
                ),

              description:
                String(
                  item.Description ||
                  item.description ||
                  ""
                ),

              url:
                String(
                  item.URL ||
                  item.url ||
                  ""
                ),

            })
          )
          .filter(
            item =>
              item.name
          );


      /*
      ==========================================================
      SYSTEM PROMPT
      ==========================================================
      */

      const systemPrompt =
`
You are the autonomous workspace architect for Autonomous Work Space.

You design practical AI-powered workspaces using the actual agents and tools available in the supplied catalog.

You must reason carefully about the user's goal and create a useful architecture.

CRITICAL RULES:

1. Understand the user's actual goal before selecting anything.

2. Do NOT force the goal into a fixed seven-layer template.

3. Create only the layers genuinely required.

4. The number of layers can vary.

5. Select components ONLY from the supplied catalog.

6. Never invent a product, agent, tool, company, URL or capability.

7. Only select a catalog item when its supplied description reasonably supports the job.

8. Every layer must explain why that layer exists.

9. Every selected component must explain why it was selected.

10. Prefer strong matches over simply filling layers.

11. Identify genuine missing capabilities.

12. After creating the architecture, review your own architecture.

13. Check whether:
    - selected components actually match their jobs
    - important capabilities are missing
    - duplicate components are unnecessary
    - layers are logically ordered
    - a better component already exists in the supplied catalog

14. Refine the architecture after the review.

15. Do not claim that a component can do something unsupported by its supplied description.

16. A capability gap means the supplied catalog does not adequately satisfy an important requirement.

17. Do not search the web.
    You are evaluating the supplied Autonomous Work Space ecosystem in this version.

18. Return ONLY valid JSON.

The final architecture should be the result of:
GOAL UNDERSTANDING
→ INITIAL ARCHITECTURE
→ ECOSYSTEM MATCHING
→ SELF-EVALUATION
→ REFINED ARCHITECTURE
`;


      /*
      ==========================================================
      USER PROMPT
      ==========================================================
      */

      const userPrompt =
`
USER GOAL:

${goal}


CURRENT AUTONOMOUS WORK SPACE CATALOG:

${JSON.stringify(catalog, null, 2)}


Create and then internally review the workspace architecture.

Return ONLY JSON using exactly this structure:

{
  "goal_summary": "short explanation of what the user wants to build",

  "core_capabilities": [
    {
      "name": "capability name",
      "reason": "why this capability is needed"
    }
  ],

  "layers": [
    {
      "number": 1,

      "name": "meaningful layer name",

      "purpose": "what this layer does",

      "why_needed": "why this layer is necessary for this particular user goal",

      "agents": [
        {
          "name": "exact catalog name",
          "reason": "why this agent is appropriate"
        }
      ],

      "tools": [
        {
          "name": "exact catalog name",
          "reason": "why this tool is appropriate"
        }
      ]
    }
  ],

  "gaps": [
    {
      "capability": "missing capability",
      "reason": "why the current catalog does not adequately provide it"
    }
  ],

  "review": {
    "summary": "brief explanation of how the architecture was checked and refined",

    "improvements": [
      "improvement made during self-review"
    ]
  },

  "architecture_summary": "explanation of how all layers work together"
}


IMPORTANT:

- The component names must exactly match names from the supplied catalog.
- Do not select every available component.
- Empty agents or tools arrays are allowed.
- If there are no important gaps, return an empty gaps array.
- Do not invent gaps.
- Perform the architecture review internally before returning the final JSON.
- Do not return your internal reasoning.
- Return only the final refined architecture JSON.
`;


      /*
      ==========================================================
      OPENROUTER REQUEST
      ==========================================================
      */

      const controller =
        new AbortController();


      const timeout =
        setTimeout(
          () =>
            controller.abort(),
          90000
        );


      let openrouterResponse;


      try {

        openrouterResponse =
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
                JSON.stringify({

                  model:
                    "openrouter/free",

                  messages: [

                    {
                      role:
                        "system",

                      content:
                        systemPrompt,
                    },

                    {
                      role:
                        "user",

                      content:
                        userPrompt,
                    },

                  ],

                  temperature:
                    0.2,

                  max_tokens:
                    6000,

                }),

              signal:
                controller.signal,

            }
          );

      } finally {

        clearTimeout(
          timeout
        );

      }


      /*
      ==========================================================
      OPENROUTER ERROR
      ==========================================================
      */

      if (!openrouterResponse.ok) {

        const errorText =
          await openrouterResponse.text();


        return new Response(
          JSON.stringify({

            error:
              "OpenRouter request failed.",

            details:
              errorText.slice(
                0,
                1500
              ),

          }),
          {

            status:
              502,

            headers: {

              ...corsHeaders,

              "Content-Type":
                "application/json",

            },

          }
        );

      }


      /*
      ==========================================================
      READ MODEL RESPONSE
      ==========================================================
      */

      const llmData =
        await openrouterResponse.json();


      const content =
        llmData
          ?.choices?.[0]
          ?.message
          ?.content ||
        "";


      if (!content) {

        return new Response(
          JSON.stringify({

            error:
              "The reasoning model returned an empty response.",

          }),
          {

            status:
              502,

            headers: {

              ...corsHeaders,

              "Content-Type":
                "application/json",

            },

          }
        );

      }


      /*
      ==========================================================
      CLEAN RESPONSE
      ==========================================================
      */

      let cleaned =
        content
          .trim()
          .replace(
            /^```json/i,
            ""
          )
          .replace(
            /^```/,
            ""
          )
          .replace(
            /```$/,
            ""
          )
          .trim();


      /*
      ==========================================================
      PARSE JSON
      ==========================================================
      */

      let architecture;


      try {

        architecture =
          JSON.parse(
            cleaned
          );

      } catch {

        const start =
          cleaned.indexOf(
            "{"
          );


        const end =
          cleaned.lastIndexOf(
            "}"
          );


        if (
          start === -1 ||
          end === -1 ||
          end <= start
        ) {

          return new Response(
            JSON.stringify({

              error:
                "The reasoning model did not return valid JSON.",

              raw:
                cleaned.slice(
                  0,
                  2000
                ),

            }),
            {

              status:
                502,

              headers: {

                ...corsHeaders,

                "Content-Type":
                  "application/json",

              },

            }
          );

        }


        try {

          architecture =
            JSON.parse(
              cleaned.slice(
                start,
                end + 1
              )
            );

        } catch {

          return new Response(
            JSON.stringify({

              error:
                "Could not parse the reasoning model response.",

              raw:
                cleaned.slice(
                  0,
                  2000
                ),

            }),
            {

              status:
                502,

              headers: {

                ...corsHeaders,

                "Content-Type":
                  "application/json",

              },

            }
          );

        }

      }


      /*
      ==========================================================
      VALIDATE BASIC STRUCTURE
      ==========================================================
      */

      if (
        !architecture ||
        typeof architecture !== "object"
      ) {

        return new Response(
          JSON.stringify({

            error:
              "The model returned an invalid architecture.",

          }),
          {

            status:
              502,

            headers: {

              ...corsHeaders,

              "Content-Type":
                "application/json",

            },

          }
        );

      }


      /*
      ==========================================================
      RETURN SUCCESS
      ==========================================================
      */

      return new Response(
        JSON.stringify({

          success:
            true,

          architecture,

        }),
        {

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


      const message =
        error?.name === "AbortError"
          ? "The workspace architecture request timed out. Please try again."
          : (
              error.message ||
              "Unexpected Worker error."
            );


      return new Response(
        JSON.stringify({

          error:
            message,

        }),
        {

          status:
            500,

          headers: {

            ...corsHeaders,

            "Content-Type":
              "application/json",

          },

        }
      );

    }

  }

};
