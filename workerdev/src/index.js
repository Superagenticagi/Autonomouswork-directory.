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
       * =========================================================
       * GET
       * Current Autonomous Work Space ecosystem
       * =========================================================
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
       * =========================================================
       * POST /build-stack
       * Autonomous Stack Builder V3.1
       *
       * Pass 1: Initial architecture
       * Pass 2: Critic
       * Pass 3: External/better candidate research
       * Pass 4: Final improved architecture
       * =========================================================
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

      const ecosystem = Array.isArray(body.ecosystem)
        ? body.ecosystem
        : [];

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

      if (!ecosystem.length) {
        return new Response(
          JSON.stringify({
            error: "No ecosystem data was supplied.",
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
       * =========================================================
       * Helpers
       * =========================================================
       */

      function jsonResponse(data, status = 200) {
        return new Response(JSON.stringify(data), {
          status,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json",
          },
        });
      }

      function stripThinkBlocks(text) {
        return String(text || "")
          .replace(/<think>[\s\S]*?<\/think>/gi, "")
          .trim();
      }

      function extractJson(text) {
        let cleaned = stripThinkBlocks(text);

        cleaned = cleaned
          .replace(/^```json\s*/i, "")
          .replace(/^```\s*/i, "")
          .replace(/\s*```$/i, "")
          .trim();

        try {
          return JSON.parse(cleaned);
        } catch {}

        const start = cleaned.indexOf("{");
        const end = cleaned.lastIndexOf("}");

        if (start === -1 || end === -1 || end <= start) {
          throw new Error("No JSON object found in model response.");
        }

        const candidate = cleaned.slice(start, end + 1);

        try {
          return JSON.parse(candidate);
        } catch (error) {
          throw new Error(
            `JSON parsing failed: ${error.message}`
          );
        }
      }

      function validateArchitecture(data) {
        if (!data || typeof data !== "object") {
          throw new Error("Architecture is not an object.");
        }

        if (!Array.isArray(data.layers)) {
          throw new Error("Architecture layers are missing.");
        }

        if (!Array.isArray(data.core_capabilities)) {
          data.core_capabilities = [];
        }

        if (!Array.isArray(data.gaps)) {
          data.gaps = [];
        }

        if (!Array.isArray(data.improvements)) {
          data.improvements = [];
        }

        if (!Array.isArray(data.external_candidates)) {
          data.external_candidates = [];
        }

        return data;
      }

      async function callModel(systemPrompt, userPrompt, maxTokens = 5000) {
        const response = await fetch(
          "https://openrouter.ai/api/v1/chat/completions",
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${env.OPENROUTER_KEY}`,
              "Content-Type": "application/json",
              "HTTP-Referer": "https://autonomouswork.space",
              "X-Title": "Autonomous Work Space",
            },
            body: JSON.stringify({
              model: "openrouter/free",
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
              temperature: 0.2,
              max_tokens: maxTokens,
            }),
          }
        );

        if (!response.ok) {
          const errorText = await response.text();

          throw new Error(
            `OpenRouter request failed: ${errorText.slice(0, 1000)}`
          );
        }

        const data = await response.json();

        const content =
          data?.choices?.[0]?.message?.content || "";

        if (!content) {
          throw new Error(
            "The reasoning model returned an empty response."
          );
        }

        return extractJson(content);
      }

      /*
       * =========================================================
       * PASS 1 — INITIAL ARCHITECTURE
       * =========================================================
       */

      const initialSystemPrompt = `
You are the initial autonomous workspace architect for
"Autonomous Work Space".

Your task is to transform the user's real-world goal into
a practical workspace architecture using the CURRENT DIRECTORY.

IMPORTANT:

1. Understand the actual user goal.
2. Determine the capabilities genuinely required.
3. Create only meaningful workspace layers.
4. The number of layers may vary.
5. Select agents and tools ONLY from the supplied catalog.
6. Never invent catalog components.
7. Do not claim unsupported capabilities.
8. Prefer a small number of strong components.
9. Explain why every layer exists.
10. Explain why every selected component is appropriate.
11. Identify genuine capability gaps.
12. Do not assume the catalog is complete.
13. Do not force a fixed seven-layer structure.

Return ONLY valid JSON.
`;

      const initialUserPrompt = `
USER GOAL:

${goal}

CURRENT DIRECTORY:

${JSON.stringify(catalog, null, 2)}

Create the initial workspace architecture.

Return exactly:

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
          "name": "exact catalog name",
          "reason": "..."
        }
      ],
      "tools": [
        {
          "name": "exact catalog name",
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
  "architecture_summary": "..."
}
`;

      let initialArchitecture;

      try {
        initialArchitecture = validateArchitecture(
          await callModel(
            initialSystemPrompt,
            initialUserPrompt,
            5000
          )
        );
      } catch (error) {
        return jsonResponse(
          {
            error: "Initial workspace architecture failed.",
            details: error.message,
          },
          502
        );
      }

      /*
       * =========================================================
       * PASS 2 — CRITIC
       *
       * The critic does NOT rebuild yet.
       * It identifies:
       * - missing capabilities
       * - weak selections
       * - better alternatives
       * - unnecessary components
       * =========================================================
       */

      const criticSystemPrompt = `
You are the critical reviewer of an autonomous workspace architecture.

You are NOT allowed to blindly approve the proposed stack.

Review it against the user's actual goal.

Look for:

1. Missing capabilities.
2. Weak or poorly matched components.
3. Components that are redundant.
4. Components that claim capabilities not supported by their descriptions.
5. Important capabilities that need dedicated tools or agents.
6. Better alternatives that may exist in the current directory.
7. Capabilities that are satisfied technically but poorly.
8. Architectural weaknesses.
9. Missing feedback loops required for autonomous improvement.

Be conservative.

A "better alternative" should only be suggested when it is
meaningfully better for the user's specific goal.

Return ONLY valid JSON.
`;

      const criticUserPrompt = `
USER GOAL:

${goal}

CURRENT DIRECTORY:

${JSON.stringify(catalog, null, 2)}

INITIAL ARCHITECTURE:

${JSON.stringify(initialArchitecture, null, 2)}

Critically review this architecture.

Return exactly:

{
  "approved": true,
  "critical_findings": [
    {
      "type": "gap | weak_component | better_alternative | redundancy | architecture",
      "issue": "...",
      "reason": "..."
    }
  ],
  "missing_capabilities": [
    {
      "capability": "...",
      "reason": "..."
    }
  ],
  "better_directory_options": [
    {
      "current_component": "...",
      "better_component": "...",
      "reason": "..."
    }
  ],
  "overall_assessment": "..."
}
`;

      let critique;

      try {
        critique = await callModel(
          criticSystemPrompt,
          criticUserPrompt,
          4000
        );
      } catch (error) {
        /*
         * If the critic fails, do not destroy a valid initial
         * architecture. Continue with it.
         */
        critique = {
          approved: true,
          critical_findings: [],
          missing_capabilities: [],
          better_directory_options: [],
          overall_assessment:
            "Critic pass unavailable; initial architecture retained.",
          critic_error: error.message,
        };
      }

      /*
       * =========================================================
       * PASS 3 — EXTERNAL / BETTER CANDIDATE DISCOVERY
       *
       * This does NOT write anything to Airtable.
       *
       * It produces candidates for the final architect to evaluate.
       * =========================================================
       */

      const needsDiscovery =
        (critique?.missing_capabilities || []).length > 0 ||
        (critique?.better_directory_options || []).length > 0 ||
        (initialArchitecture?.gaps || []).length > 0;

      let discovery = {
        candidates: [],
        reasoning: "No external discovery was necessary.",
      };

      if (needsDiscovery) {
        const discoverySystemPrompt = `
You are the capability discovery researcher for Autonomous Work Space.

The current directory may be incomplete.

Your job is to identify REAL external agents, tools, frameworks,
services, or products that could improve or complete the workspace.

IMPORTANT:

1. Only suggest real products or projects that you genuinely know.
2. Never invent products.
3. Do not pretend to have verified live availability unless you actually can.
4. Clearly distinguish known candidates from uncertain candidates.
5. Focus ONLY on the specific gaps or improvement opportunities.
6. Do not return candidates merely because they are popular.
7. A candidate must have a strong reason for the particular goal.
8. Prefer dedicated solutions over generic ones when appropriate.
9. Do not recommend something that merely duplicates an existing component.
10. The final architect will decide whether candidates are actually used.

Return ONLY valid JSON.
`;

        const discoveryUserPrompt = `
USER GOAL:

${goal}

CURRENT DIRECTORY:

${JSON.stringify(catalog, null, 2)}

INITIAL ARCHITECTURE:

${JSON.stringify(initialArchitecture, null, 2)}

CRITIC FINDINGS:

${JSON.stringify(critique, null, 2)}

Identify the strongest external candidates that could:

A. Fill genuine missing capabilities.
B. Replace a weak current selection when a substantially better option exists.

Return exactly:

{
  "candidates": [
    {
      "name": "...",
      "type": "Agent | Tool",
      "capability": "...",
      "reason": "...",
      "suggested_url": "...",
      "confidence": "high | medium | low"
    }
  ],
  "reasoning": "..."
}

Maximum 8 candidates.
`;

        try {
          discovery = await callModel(
            discoverySystemPrompt,
            discoveryUserPrompt,
            3500
          );
        } catch (error) {
          discovery = {
            candidates: [],
            reasoning:
              "External candidate discovery failed; current directory was retained.",
            discovery_error: error.message,
          };
        }
      }

      /*
       * =========================================================
       * PASS 4 — FINAL ARCHITECT
       *
       * Rebuild using:
       * - original catalog
       * - initial architecture
       * - critic
       * - external candidates
       *
       * External candidates are NOT automatically trusted.
       * =========================================================
       */

      const finalSystemPrompt = `
You are the final autonomous workspace architect for
"Autonomous Work Space".

Your job is to produce the BEST practical architecture for the
user's goal after reviewing the initial architecture, critic findings,
and possible external candidates.

IMPORTANT RULES:

1. Build the final architecture around the actual user goal.
2. Keep only meaningful layers.
3. You may keep, replace, remove, or add components.
4. Current directory components are trusted catalog candidates.
5. External candidates are NOT automatically trusted.
6. Only use an external candidate when it is genuinely better or
   fills an important missing capability.
7. Never claim unsupported capabilities.
8. Do not use external candidates merely because they are popular.
9. Preserve strong existing components.
10. Remove weak or redundant components when appropriate.
11. A capability is a GAP only when the final architecture still
    cannot adequately satisfy it.
12. Be honest about remaining gaps.
13. Explain every important improvement.
14. The final architecture must remain practical.
15. Do not force seven layers.
16. The final answer must contain ONLY valid JSON.

For external candidates, include them in the final architecture only
when the evidence supplied by the discovery pass is sufficient for a
reasonable recommendation.
`;

      const finalUserPrompt = `
USER GOAL:

${goal}

CURRENT DIRECTORY:

${JSON.stringify(catalog, null, 2)}

INITIAL ARCHITECTURE:

${JSON.stringify(initialArchitecture, null, 2)}

CRITIC REVIEW:

${JSON.stringify(critique, null, 2)}

EXTERNAL / BETTER CANDIDATES:

${JSON.stringify(discovery, null, 2)}

Now rebuild and improve the workspace.

Return exactly:

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
          "reason": "..."
        }
      ],

      "tools": [
        {
          "name": "...",
          "reason": "..."
        }
      ]
    }
  ],

  "improvements": [
    {
      "type": "added | replaced | removed | strengthened",
      "component": "...",
      "reason": "..."
    }
  ],

  "external_candidates": [
    {
      "name": "...",
      "type": "Agent | Tool",
      "reason": "...",
      "url": "..."
    }
  ],

  "gaps": [
    {
      "capability": "...",
      "reason": "..."
    }
  ],

  "architecture_summary": "...",

  "review_summary": "..."
}

IMPORTANT:

- Components from the current directory must use their exact catalog names.
- Do not invent catalog names.
- External candidates must come from the discovery results.
- Do not automatically treat every discovered candidate as part of the final stack.
- external_candidates should contain useful candidates that were discovered
  but were NOT selected as core components, when applicable.
`;

      let finalArchitecture;

      try {
        finalArchitecture = validateArchitecture(
          await callModel(
            finalSystemPrompt,
            finalUserPrompt,
            6000
          )
        );
      } catch (error) {
        /*
         * A valid initial architecture is better than returning nothing.
         */
        finalArchitecture = {
          ...initialArchitecture,
          improvements: [],
          external_candidates:
            discovery?.candidates || [],
          review_summary:
            "Final improvement pass failed; initial architecture retained.",
          final_pass_error: error.message,
        };
      }

      /*
       * =========================================================
       * FINAL RESPONSE
       * =========================================================
       */

      return jsonResponse({
        success: true,
        version: "3.1",
        architecture: finalArchitecture,

        process: {
          initial_architecture_created: true,
          critic_review_completed: true,
          external_discovery_attempted: needsDiscovery,
          final_rebuild_completed:
            !finalArchitecture.final_pass_error,
        },

        critique: {
          findings:
            critique?.critical_findings || [],
          missing_capabilities:
            critique?.missing_capabilities || [],
          better_directory_options:
            critique?.better_directory_options || [],
        },
      });
    } catch (error) {
      return new Response(
        JSON.stringify({
          error:
            error.message || "Unexpected Worker error.",
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
