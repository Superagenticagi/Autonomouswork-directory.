export default {
  async fetch(request, env) {
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };

    // ==========================================================
    // CORS PREFLIGHT
    // ==========================================================

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders,
      });
    }

    // ==========================================================
    // GET
    // ==========================================================
    // IMPORTANT:
    // This remains the original Airtable directory endpoint.
    //
    // Agents / Tools pages can continue loading the Airtable
    // directory exactly as before.
    //
    // Airtable is NOT used by /build-stack.
    // ==========================================================

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
          Category:
            record.fields.Category || "Uncategorized",
          created: record.createdTime,
        }));

        return new Response(
          JSON.stringify(items, null, 2),
          {
            status: 200,
            headers: {
              ...corsHeaders,
              "Content-Type": "application/json",
              "Cache-Control":
                "public, max-age=300",
            },
          }
        );
      } catch (err) {
        return new Response(
          JSON.stringify({
            error: err.message,
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

    // ==========================================================
    // POST
    // ==========================================================
    // POST /build-stack
    //
    // IMPORTANT:
    // Airtable is deliberately NOT used here.
    //
    // The LLM receives the user's goal and independently reasons
    // about suitable agents, tools, platforms and services.
    // ==========================================================

    if (request.method !== "POST") {
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

    // ==========================================================
    // PARSE REQUEST
    // ==========================================================

    let body;

    try {
      body = await request.json();
    } catch (err) {
      return new Response(
        JSON.stringify({
          error: "Invalid JSON request body",
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

    const goal =
      typeof body.goal === "string"
        ? body.goal.trim()
        : "";

    if (!goal) {
      return new Response(
        JSON.stringify({
          error: "A goal is required.",
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

    // ==========================================================
    // OPENROUTER KEY
    // ==========================================================

    if (!env.OPENROUTER_KEY) {
      return new Response(
        JSON.stringify({
          error:
            "OPENROUTER_KEY is not configured.",
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

    const OPENROUTER_URL =
      "https://openrouter.ai/api/v1/chat/completions";

    const MODELS_URL =
      "https://openrouter.ai/api/v1/models";

    const MAX_MODEL_ATTEMPTS = 8;

    // ==========================================================
    // JSON RESPONSE HELPER
    // ==========================================================

    function jsonResponse(data, status = 200) {
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

    // ==========================================================
    // CLEAN MODEL RESPONSE
    // ==========================================================

    function cleanText(text) {
      if (typeof text !== "string") {
        return "";
      }

      return text
        .replace(/^```json\s*/i, "")
        .replace(/^```\s*/i, "")
        .replace(/\s*```$/i, "")
        .trim();
    }

    // ==========================================================
    // EXTRACT JSON
    // ==========================================================

    function extractJSON(text) {
      if (!text) {
        return null;
      }

      const cleaned = cleanText(text);

      // Direct JSON
      try {
        return JSON.parse(cleaned);
      } catch (err) {}

      // JSON object
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
        } catch (err) {}
      }

      // JSON array
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
        } catch (err) {}
      }

      return null;
    }

    // ==========================================================
    // DISCOVER FREE OPENROUTER MODELS
    // ==========================================================

    async function getFreeModels() {
      const discovered = [];

      try {
        const response =
          await fetch(MODELS_URL, {
            headers: {
              Authorization:
                `Bearer ${env.OPENROUTER_KEY}`,
            },
          });

        if (!response.ok) {
          return discovered;
        }

        const data =
          await response.json();

        if (!Array.isArray(data.data)) {
          return discovered;
        }

        for (const model of data.data) {
          if (!model || !model.id) {
            continue;
          }

          const id =
            String(model.id);

          // Explicit :free models
          if (id.endsWith(":free")) {
            discovered.push(id);
            continue;
          }

          // Explicit zero-priced models
          if (model.pricing) {
            const promptPrice =
              Number(
                model.pricing.prompt
              );

            const completionPrice =
              Number(
                model.pricing.completion
              );

            if (
              Number.isFinite(
                promptPrice
              ) &&
              Number.isFinite(
                completionPrice
              ) &&
              promptPrice === 0 &&
              completionPrice === 0
            ) {
              discovered.push(id);
            }
          }
        }
      } catch (err) {
        // openrouter/free remains available
      }

      return [
        ...new Set(discovered),
      ];
    }

    // ==========================================================
    // MODEL CANDIDATES
    // ==========================================================

    async function getModelCandidates() {
      const candidates = [
        "openrouter/free",
      ];

      const discovered =
        await getFreeModels();

      for (const model of discovered) {
        if (
          !candidates.includes(model)
        ) {
          candidates.push(model);
        }
      }

      return candidates;
    }

    // ==========================================================
    // CALL OPENROUTER
    // ==========================================================

    async function callModel(
      model,
      messages
    ) {
      const response =
        await fetch(
          OPENROUTER_URL,
          {
            method: "POST",

            headers: {
              Authorization:
                `Bearer ${env.OPENROUTER_KEY}`,
              "Content-Type":
                "application/json",

              "HTTP-Referer":
                "https://autonomouswork-directory.pages.dev/",

              "X-Title":
                "Autonomous Work Space",
            },

            body: JSON.stringify({
              model,

              messages,

              temperature: 0.2,

              max_tokens: 12000,

              response_format: {
                type: "json_object",
              },
            }),
          }
        );

      const rawText =
        await response.text();

      if (!response.ok) {
        throw new Error(
          `OpenRouter ${response.status}: ${rawText.slice(
            0,
            500
          )}`
        );
      }

      let data;

      try {
        data =
          JSON.parse(rawText);
      } catch (err) {
        throw new Error(
          "OpenRouter returned invalid JSON."
        );
      }

      if (
        !data.choices ||
        !data.choices[0] ||
        !data.choices[0].message
      ) {
        throw new Error(
          "OpenRouter returned no usable message."
        );
      }

      let content =
        data.choices[0].message.content;

      // Some models return content blocks.
      if (Array.isArray(content)) {
        content =
          content
            .map((part) => {
              if (
                typeof part ===
                "string"
              ) {
                return part;
              }

              if (
                part &&
                typeof part.text ===
                  "string"
              ) {
                return part.text;
              }

              return "";
            })
            .join("");
      }

      const parsed =
        extractJSON(content);

      if (!parsed) {
        throw new Error(
          "Model response could not be parsed as JSON."
        );
      }

      return parsed;
    }

    // ==========================================================
    // RUN LLM WITH FREE-MODEL FALLBACK
    // ==========================================================

    async function runLLM(messages) {
      const models =
        await getModelCandidates();

      const attempts = [];

      let lastError = null;

      const limit =
        Math.min(
          models.length,
          MAX_MODEL_ATTEMPTS
        );

      for (
        let i = 0;
        i < limit;
        i++
      ) {
        const model =
          models[i];

        try {
          const result =
            await callModel(
              model,
              messages
            );

          return {
            result,
            model,
            attempts:
              attempts.length + 1,
            errors: attempts,
          };
        } catch (err) {
          lastError = err;

          attempts.push({
            model,
            error:
              err.message,
          });
        }
      }

      throw new Error(
        `All free models failed. Last error: ${
          lastError
            ? lastError.message
            : "Unknown error"
        }`
      );
    }

    // ==========================================================
    // PHASE 1 — GOAL ANALYSIS
    // ==========================================================

    const plannerSystem = `
You are the intelligence layer of Autonomous Work Space.

Your job is to deeply understand the user's goal and determine what
an autonomous workspace would need in order to accomplish it.

IMPORTANT:

There is NO Airtable catalog available to you.

You are NOT restricted to any predefined ecosystem.

Use your own knowledge of the AI ecosystem to identify relevant:

- AI agents
- AI tools
- automation systems
- orchestration systems
- APIs
- databases
- memory systems
- browser agents
- coding agents
- research systems
- communication tools
- infrastructure
- monitoring
- integrations
- productivity systems
- other technologies

Do not build the final stack yet.

First determine the capabilities required.

Return ONLY valid JSON.

Use exactly this structure:

{
  "goal_interpretation": "",
  "primary_outcome": "",
  "required_capabilities": [],
  "workflow_requirements": [],
  "important_constraints": [],
  "component_types_needed": [],
  "research_direction": []
}
`;

    let planning;

    try {
      const plannerResult =
        await runLLM([
          {
            role: "system",
            content:
              plannerSystem,
          },
          {
            role: "user",
            content: `
USER GOAL:

${goal}

Analyze the goal deeply.

Determine what an autonomous workspace would actually need.

Do not build the final stack yet.
`,
          },
        ]);

      planning =
        plannerResult.result;
    } catch (err) {
      return jsonResponse(
        {
          error:
            "Goal analysis failed.",
          details:
            err.message,
        },
        500
      );
    }

    // ==========================================================
    // PHASE 2 — INITIAL ARCHITECTURE
    // ==========================================================

    const architectureSystem = `
You are the primary autonomous workspace architect for
Autonomous Work Space.

Design a practical workspace that can accomplish the user's goal.

IMPORTANT:

There is NO Airtable catalog.

You are NOT limited to a supplied list.

Use your own knowledge of the wider AI ecosystem to identify suitable
agents, tools, platforms, APIs, automation systems, infrastructure
and other useful components.

The user wants an actual solution, not a generic list.

Every component must have a meaningful role.

Do not invent products.

If you are uncertain about a product, state the uncertainty rather
than presenting invented information as fact.

For each component provide:

- name
- type
- category
- role
- capability
- reason
- known URL when known
- limitations

Return ONLY valid JSON.

Use this structure:

{
  "workspace_name": "",
  "goal": "",
  "goal_interpretation": "",
  "architecture_summary": "",
  "required_capabilities": [],
  "components": [
    {
      "name": "",
      "type": "",
      "category": "",
      "role": "",
      "capability": "",
      "reason": "",
      "url": "",
      "limitations": ""
    }
  ],
  "workflow": [],
  "dependencies": [],
  "capability_coverage": [],
  "capability_gaps": [],
  "implementation_notes": [],
  "recommendations": []
}

The architecture_summary must explain how the components work
together to accomplish the goal.
`;

    let initialArchitecture;

    try {
      const architectureResult =
        await runLLM([
          {
            role: "system",
            content:
              architectureSystem,
          },
          {
            role: "user",
            content: `
USER GOAL:

${goal}

GOAL ANALYSIS:

${JSON.stringify(
  planning,
  null,
  2
)}

Now design the initial autonomous workspace.

Think independently about the wider AI ecosystem.
Do not restrict yourself to any catalog.
`,
          },
        ]);

      initialArchitecture =
        architectureResult.result;
    } catch (err) {
      return jsonResponse(
        {
          error:
            "Initial architecture generation failed.",
          details:
            err.message,
          planning,
        },
        500
      );
    }

    // ==========================================================
    // PHASE 3 — SELF REVIEW
    // ==========================================================

    const reviewSystem = `
You are the independent quality-control architect for
Autonomous Work Space.

Review the proposed workspace against the user's actual goal.

Do NOT simply praise it.

Look for:

- missing capabilities
- unnecessary components
- duplicated functionality
- weak components
- missing automation
- missing orchestration
- missing integrations
- missing memory
- missing data handling
- missing human handoffs
- reliability issues
- scalability issues
- security considerations
- unrealistic assumptions
- components that do not meaningfully contribute

Return ONLY valid JSON.

Use this structure:

{
  "summary": "",
  "strengths": [],
  "improvements": [],
  "capability_coverage": [],
  "capability_gaps": [
    {
      "gap": "",
      "why_it_matters": "",
      "required_capability": "",
      "possible_solution_types": []
    }
  ],
  "unnecessary_components": [],
  "risks": [],
  "overall_assessment": ""
}
`;

    let review;

    try {
      const reviewResult =
        await runLLM([
          {
            role: "system",
            content:
              reviewSystem,
          },
          {
            role: "user",
            content: `
USER GOAL:

${goal}

PROPOSED ARCHITECTURE:

${JSON.stringify(
  initialArchitecture,
  null,
  2
)}

Perform a rigorous independent review.

Find real capability gaps.
`,
          },
        ]);

      review =
        reviewResult.result;
    } catch (err) {
      return jsonResponse(
        {
          error:
            "Architecture self-review failed.",
          details:
            err.message,
          planning,
          architecture:
            initialArchitecture,
        },
        500
      );
    }

    // ==========================================================
    // PHASE 4 — GAP SOLVER
    // ==========================================================

    const gapSolverSystem = `
You are the autonomous gap-solving layer of
Autonomous Work Space.

The workspace has already been designed and reviewed.

Your task is to solve the identified capability gaps.

IMPORTANT:

There is NO Airtable catalog.

You are free to consider the wider AI ecosystem.

For every important gap:

1. Determine whether an existing component can solve it.
2. If yes, explain how.
3. If not, identify a suitable additional component.
4. Consider agents, tools, platforms, APIs, automation systems,
   infrastructure and processes.
5. Avoid unnecessary components.
6. Do not invent products.
7. State uncertainty where appropriate.

Return ONLY valid JSON.

Structure:

{
  "gap_solutions": [
    {
      "gap": "",
      "solution_type":
        "existing_component | new_component | process_change",
      "existing_component": "",
      "new_component": {
        "name": "",
        "type": "",
        "category": "",
        "role": "",
        "capability": "",
        "reason": "",
        "url": "",
        "limitations": ""
      },
      "solution": ""
    }
  ],
  "additional_components": [],
  "remaining_gaps": []
}
`;

    let gapSolutions;

    try {
      const gapResult =
        await runLLM([
          {
            role: "system",
            content:
              gapSolverSystem,
          },
          {
            role: "user",
            content: `
USER GOAL:

${goal}

CURRENT ARCHITECTURE:

${JSON.stringify(
  initialArchitecture,
  null,
  2
)}

SELF-REVIEW:

${JSON.stringify(
  review,
  null,
  2
)}

Now solve the important capability gaps.

Do not assume the current architecture is sufficient.
`,
          },
        ]);

      gapSolutions =
        gapResult.result;
    } catch (err) {
      return jsonResponse(
        {
          error:
            "Gap-solving phase failed.",
          details:
            err.message,
          planning,
          architecture:
            initialArchitecture,
          review,
        },
        500
      );
    }

    // ==========================================================
    // PHASE 5 — FINAL REBUILD
    // ==========================================================

    const rebuildSystem = `
You are the final autonomous workspace architect for
Autonomous Work Space.

Rebuild the workspace after the planning, architecture,
self-review and gap-solving phases.

IMPORTANT:

There is NO Airtable catalog.

The final architecture should be based on the user's goal and the
best components you can identify from your own knowledge.

Combine useful existing components with valid gap solutions.

Remove unnecessary components.

Do not make the stack larger merely for appearance.

Every component must have a clear purpose.

Explain:

- what each component does
- why it is needed
- how components connect
- how the workflow operates
- what automation happens
- where humans are involved
- remaining limitations
- remaining capability gaps

Do not invent products or URLs.

Return ONLY valid JSON.

Use exactly this structure:

{
  "workspace_name": "",
  "goal": "",
  "goal_interpretation": "",
  "architecture_summary": "",
  "components": [
    {
      "name": "",
      "type": "",
      "category": "",
      "role": "",
      "capability": "",
      "reason": "",
      "url": "",
      "limitations": ""
    }
  ],
  "workflow": [],
  "dependencies": [],
  "capability_coverage": [],
  "capability_gaps": [],
  "implementation_notes": [],
  "recommendations": [],
  "review": {
    "summary": "",
    "improvements": []
  }
}

The architecture_summary must explain the actual system architecture
and how it accomplishes the user's goal.
`;

    let finalArchitecture;

    try {
      const rebuildResult =
        await runLLM([
          {
            role: "system",
            content:
              rebuildSystem,
          },
          {
            role: "user",
            content: `
USER GOAL:

${goal}

GOAL ANALYSIS:

${JSON.stringify(
  planning,
  null,
  2
)}

INITIAL ARCHITECTURE:

${JSON.stringify(
  initialArchitecture,
  null,
  2
)}

SELF-REVIEW:

${JSON.stringify(
  review,
  null,
  2
)}

GAP-SOLVING RESULTS:

${JSON.stringify(
  gapSolutions,
  null,
  2
)}

Now rebuild the final autonomous workspace.

The final architecture should actually address the important gaps
identified during the review.
`,
          },
        ]);

      finalArchitecture =
        rebuildResult.result;
    } catch (err) {
      return jsonResponse(
        {
          error:
            "Final architecture rebuild failed.",
          details:
            err.message,
          planning,
          architecture:
            initialArchitecture,
          review,
          gapSolutions,
        },
        500
      );
    }

    // ==========================================================
    // PHASE 6 — FINAL QUALITY REVIEW
    // ==========================================================

    const finalReviewSystem = `
You are the final quality-control reviewer for
Autonomous Work Space.

Review the final architecture against the original user goal.

Check:

- important requirements covered
- meaningful component roles
- coherent workflow
- realistic implementation
- unnecessary components
- remaining capability gaps
- implementation risks
- questionable or uncertain component claims

Do NOT redesign the architecture.

Return ONLY valid JSON.

Structure:

{
  "summary": "",
  "strengths": [],
  "improvements": [],
  "remaining_gaps": [],
  "implementation_risks": [],
  "overall_assessment": ""
}
`;

    let finalReview;

    try {
      const finalReviewResult =
        await runLLM([
          {
            role: "system",
            content:
              finalReviewSystem,
          },
          {
            role: "user",
            content: `
ORIGINAL USER GOAL:

${goal}

FINAL ARCHITECTURE:

${JSON.stringify(
  finalArchitecture,
  null,
  2
)}

Perform the final quality review.
`,
          },
        ]);

      finalReview =
        finalReviewResult.result;
    } catch (err) {
      finalReview = {
        summary:
          "Final review could not be completed.",
        strengths: [],
        improvements: [],
        remaining_gaps: [],
        implementation_risks: [
          err.message,
        ],
        overall_assessment:
          "Architecture generated, but final QA was unavailable.",
      };
    }

    // ==========================================================
    // ATTACH REVIEW TO FINAL ARCHITECTURE
    // ==========================================================

    finalArchitecture.review = {
      summary:
        finalReview.summary || "",

      improvements:
        Array.isArray(
          finalReview.improvements
        )
          ? finalReview.improvements
          : [],
    };

    finalArchitecture.final_quality_review =
      finalReview;

    // ==========================================================
    // BUILDER METADATA
    // ==========================================================

    finalArchitecture.builder_metadata = {
      mode: "LLM-only",
      airtable_used: false,
      external_search_api_used: false,

      planning_completed: true,
      initial_architecture_completed:
        true,
      self_review_completed: true,
      gap_solving_completed: true,
      final_rebuild_completed: true,
      final_quality_review_completed:
        true,
    };

    // ==========================================================
    // FINAL RESPONSE
    // ==========================================================

    return jsonResponse({
      success: true,

      goal,

      architecture:
        finalArchitecture,

      planning,

      initial_architecture:
        initialArchitecture,

      self_review:
        review,

      gap_solutions:
        gapSolutions,

      final_quality_review:
        finalReview,

      message:
        "Workspace generated using the LLM-only autonomous architecture flow.",
    });
  },
};
