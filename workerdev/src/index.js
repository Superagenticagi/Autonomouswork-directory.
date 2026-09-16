


export default {
  async fetch(request, env) {
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };

    // ----------------------------------------------------------
    // CORS preflight
    // ----------------------------------------------------------

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders,
      });
    }

    // ----------------------------------------------------------
    // Simple GET health check
    // ----------------------------------------------------------

    if (request.method === "GET") {
      return new Response(
        JSON.stringify({
          service: "Autonomous Work Space Stack Builder",
          status: "online",
          mode: "LLM-only",
          airtable: false,
          external_search_api: false,
          endpoint: "/build-stack",
        }),
        {
          status: 200,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json",
          },
        }
      );
    }

    // ----------------------------------------------------------
    // Only POST is accepted for Builder
    // ----------------------------------------------------------

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

    // ----------------------------------------------------------
    // Parse request
    // ----------------------------------------------------------

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

    // ----------------------------------------------------------
    // OpenRouter key
    // ----------------------------------------------------------

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

    // ==========================================================
    // SETTINGS
    // ==========================================================

    const OPENROUTER_URL =
      "https://openrouter.ai/api/v1/chat/completions";

    const MODELS_URL =
      "https://openrouter.ai/api/v1/models";

    const MAX_MODEL_ATTEMPTS = 8;

    const MAX_PHASE_ATTEMPTS = 3;

    // ==========================================================
    // UTILITY — JSON RESPONSE
    // ==========================================================

    function jsonResponse(data, status = 200) {
      return new Response(JSON.stringify(data, null, 2), {
        status,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
          "Cache-Control": "no-store",
        },
      });
    }

    // ==========================================================
    // UTILITY — CLEAN MODEL OUTPUT
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
    // UTILITY — EXTRACT JSON
    // ==========================================================

    function extractJSON(text) {
      if (!text) {
        return null;
      }

      const cleaned = cleanText(text);

      // Direct parse
      try {
        return JSON.parse(cleaned);
      } catch (err) {}

      // Try object
      const objectStart = cleaned.indexOf("{");
      const objectEnd = cleaned.lastIndexOf("}");

      if (objectStart !== -1 && objectEnd > objectStart) {
        const candidate = cleaned.slice(
          objectStart,
          objectEnd + 1
        );

        try {
          return JSON.parse(candidate);
        } catch (err) {}
      }

      // Try array
      const arrayStart = cleaned.indexOf("[");
      const arrayEnd = cleaned.lastIndexOf("]");

      if (arrayStart !== -1 && arrayEnd > arrayStart) {
        const candidate = cleaned.slice(
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
    // DISCOVER CURRENT FREE MODELS
    // ==========================================================

    async function getFreeModels() {
      const discovered = [];

      try {
        const response = await fetch(MODELS_URL, {
          headers: {
            Authorization: `Bearer ${env.OPENROUTER_KEY}`,
          },
        });

        if (!response.ok) {
          return discovered;
        }

        const data = await response.json();

        if (!Array.isArray(data.data)) {
          return discovered;
        }

        for (const model of data.data) {
          if (!model || !model.id) {
            continue;
          }

          const id = String(model.id);

          // Explicit free model suffix
          if (id.endsWith(":free")) {
            discovered.push(id);
            continue;
          }

          // Check explicit pricing information
          if (model.pricing) {
            const promptPrice = Number(
              model.pricing.prompt
            );

            const completionPrice = Number(
              model.pricing.completion
            );

            if (
              Number.isFinite(promptPrice) &&
              Number.isFinite(completionPrice) &&
              promptPrice === 0 &&
              completionPrice === 0
            ) {
              discovered.push(id);
            }
          }
        }
      } catch (err) {
        // Keep openrouter/free as fallback.
      }

      return [...new Set(discovered)];
    }

    // ==========================================================
    // BUILD MODEL CANDIDATE LIST
    // ==========================================================

    async function getModelCandidates() {
      const candidates = [
        "openrouter/free",
      ];

      const discovered = await getFreeModels();

      for (const model of discovered) {
        if (!candidates.includes(model)) {
          candidates.push(model);
        }
      }

      return candidates;
    }

    // ==========================================================
    // CALL OPENROUTER
    // ==========================================================

    async function callModel(model, messages) {
      const response = await fetch(OPENROUTER_URL, {
        method: "POST",

        headers: {
          Authorization: `Bearer ${env.OPENROUTER_KEY}`,
          "Content-Type": "application/json",
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
      });

      const rawText = await response.text();

      if (!response.ok) {
        throw new Error(
          `OpenRouter ${response.status}: ${rawText.slice(0, 500)}`
        );
      }

      let data;

      try {
        data = JSON.parse(rawText);
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

      // Some models may return structured content blocks.
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

      const parsed = extractJSON(content);

      if (!parsed) {
        throw new Error(
          "Model response could not be parsed as JSON."
        );
      }

      return parsed;
    }

    // ==========================================================
    // RUN LLM WITH FREE MODEL FALLBACK
    // ==========================================================

    async function runLLM(messages) {
      const models = await getModelCandidates();

      const attempts = [];
      let lastError = null;

      const limit = Math.min(
        models.length,
        MAX_MODEL_ATTEMPTS
      );

      for (let i = 0; i < limit; i++) {
        const model = models[i];

        try {
          const result = await callModel(
            model,
            messages
          );

          return {
            result,
            model,
            attempts: attempts.length + 1,
            errors: attempts,
          };
        } catch (err) {
          lastError = err;

          attempts.push({
            model,
            error: err.message,
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
    // PHASE 1 — GOAL UNDERSTANDING
    // ==========================================================

    const plannerSystem = `
You are the intelligence layer of Autonomous Work Space.

Your job is to understand a user's goal and determine what an
autonomous workspace would actually need to accomplish it.

You are NOT limited to a supplied catalog.

There is NO Airtable catalog.

You should use your own knowledge of the AI ecosystem to identify
relevant agents, tools, platforms, APIs, frameworks, services,
infrastructure and other components.

Do not assume that only famous tools are suitable.

Think about the actual workflow required to achieve the goal.

Return ONLY valid JSON.

Your response must follow this structure:

{
  "goal_interpretation": "",
  "primary_outcome": "",
  "required_capabilities": [],
  "workflow_requirements": [],
  "important_constraints": [],
  "component_types_needed": [],
  "research_direction": []
}

The research_direction field should describe what kinds of tools,
agents or services should be considered.
`;

    let planning;

    try {
      const plannerResult = await runLLM([
        {
          role: "system",
          content: plannerSystem,
        },
        {
          role: "user",
          content: `
User goal:

${goal}

Analyze this goal deeply.

Do not build the final stack yet.
First determine what capabilities and component types are required.
`,
        },
      ]);

      planning = plannerResult.result;
    } catch (err) {
      return jsonResponse(
        {
          error:
            "Goal analysis failed.",
          details: err.message,
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

You must design a practical AI-powered workspace for the user's goal.

IMPORTANT:

There is NO Airtable catalog.

You are NOT restricted to a predefined list.

Use your own knowledge of the AI ecosystem to identify suitable:

- AI agents
- AI tools
- automation platforms
- orchestration systems
- APIs
- databases
- memory systems
- communication systems
- browser agents
- coding agents
- research systems
- infrastructure
- monitoring
- integrations
- productivity tools
- other necessary components

The user wants an actual solution, not a generic list.

For every recommended component:

1. Give its name.
2. Give its type.
3. Give its role.
4. Explain why it is needed.
5. Explain what capability it provides.
6. Give its known website URL when known.
7. State whether it is an agent, tool, platform, API, infrastructure
   component or another type.
8. State any important limitation or uncertainty.

Do not invent products.

If you are uncertain about a product, say so rather than presenting
an invented capability as fact.

Build an architecture that could realistically accomplish the goal.

The stack should not simply contain many components.
Every component must have a meaningful role.

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

The architecture_summary should explain the complete architecture,
not merely repeat the component names.
`;

    let initialArchitecture;

    try {
      const architectureResult =
        await runLLM([
          {
            role: "system",
            content: architectureSystem,
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

Think independently about the wider AI/tool ecosystem.
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
          details: err.message,
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

Do NOT simply praise the architecture.

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
- scalability problems
- reliability problems
- security considerations
- unrealistic assumptions
- components that do not actually contribute to the goal

Think about how the workspace would operate in practice.

If a capability is missing, describe exactly what is needed.

Return ONLY valid JSON.

Structure:

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
            content: reviewSystem,
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

Perform a rigorous independent self-review.

Find real gaps instead of assuming the architecture is complete.
`,
          },
        ]);

      review = reviewResult.result;
    } catch (err) {
      return jsonResponse(
        {
          error:
            "Architecture self-review failed.",
          details: err.message,
          planning,
          architecture: initialArchitecture,
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

The proposed workspace has already been designed and reviewed.

Your task is to solve the identified capability gaps.

There is NO Airtable catalog.

Do not restrict yourself to previously selected components.

Use your own knowledge of the AI ecosystem.

For every gap:

1. Determine whether an existing selected component can solve it.
2. If yes, explain how.
3. If not, identify an additional suitable component.
4. Consider agents, tools, platforms, APIs, automation systems,
   infrastructure and other relevant technologies.
5. Avoid adding components merely for completeness.
6. Prefer practical solutions.
7. Do not invent products.
8. If uncertain, clearly state the uncertainty.

Return ONLY valid JSON.

Structure:

{
  "gap_solutions": [
    {
      "gap": "",
      "solution_type": "existing_component | new_component | process_change",
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
            content: gapSolverSystem,
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

Now solve the identified gaps.

Do not assume the current architecture is sufficient.
Try to actually solve each important gap.
`,
          },
        ]);

      gapSolutions = gapResult.result;
    } catch (err) {
      return jsonResponse(
        {
          error:
            "Gap-solving phase failed.",
          details: err.message,
          planning,
          architecture: initialArchitecture,
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

Rebuild the workspace after the self-review and gap-solving phases.

The final architecture must be designed around the user's goal.

There is NO Airtable catalog.

You are free to use your knowledge of the broader AI ecosystem.

Combine the strongest useful components from the initial architecture
with valid gap solutions.

Remove components that are unnecessary.

Do not add components merely to make the stack larger.

Every component must have a clear role.

The final architecture should explain:

- what each component does
- why it exists
- how components connect
- what the user can accomplish
- what automation happens
- where humans are involved
- remaining limitations
- remaining capability gaps

For every component include a known URL when possible.

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

The architecture_summary must be detailed enough that another person
could understand how the workspace operates without seeing the
previous planning phases.
`;

    let finalArchitecture;

    try {
      const rebuildResult =
        await runLLM([
          {
            role: "system",
            content: rebuildSystem,
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

The final result should actually address the important gaps found
during review.
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
          details: err.message,
          planning,
          architecture: initialArchitecture,
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

Review the final proposed architecture against the original user goal.

Determine:

- whether the important requirements are covered
- whether components have meaningful roles
- whether major gaps remain
- whether the workflow is coherent
- whether the architecture is realistically implementable
- whether any component appears unnecessary
- whether any claim about a component appears uncertain

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
            content: finalReviewSystem,
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
      // The architecture is still useful if final review fails.
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
    // ATTACH FINAL REVIEW TO ARCHITECTURE
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

    // Preserve the complete review information
    finalArchitecture.final_quality_review =
      finalReview;

    // Preserve useful internal information
    finalArchitecture.builder_metadata = {
      mode: "LLM-only",
      airtable_used: false,
      external_search_api_used: false,
      planning_completed: true,
      initial_architecture_completed: true,
      self_review_completed: true,
      gap_solving_completed: true,
      final_rebuild_completed: true,
      final_quality_review_completed:
        !!finalReview,
    };

    // ==========================================================
    // FINAL RESPONSE
    // ==========================================================

    return jsonResponse({
      success: true,

      goal,

      architecture: finalArchitecture,

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
