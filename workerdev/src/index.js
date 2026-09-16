export default {
  async fetch(request, env) {
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };

    // =========================================================
    // CORS
    // =========================================================

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders,
      });
    }

    // =========================================================
    // GET
    //
    // KEEP THIS AS THE AIRTABLE DIRECTORY ENDPOINT.
    //
    // The Builder itself does NOT use Airtable.
    // The existing frontend can still use GET to load the
    // directory/ecosystem and determine that it is ready.
    // =========================================================

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
          const errorText = await response.text();

          return new Response(
            JSON.stringify({
              error: "Failed to fetch from Airtable",
              details: errorText,
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

        return new Response(
          JSON.stringify(items, null, 2),
          {
            headers: {
              ...corsHeaders,
              "Content-Type": "application/json",
              "Cache-Control": "public, max-age=300",
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

    // =========================================================
    // ONLY POST IS ALLOWED FOR THE STACK BUILDER
    // =========================================================

    if (request.method !== "POST") {
      return new Response(
        "Method not allowed",
        {
          status: 405,
          headers: corsHeaders,
        }
      );
    }

    // =========================================================
    // READ REQUEST
    // =========================================================

    let body;

    try {
      body = await request.json();
    } catch {
      return new Response(
        JSON.stringify({
          success: false,
          error: "Invalid JSON request body.",
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

    const goal = String(
      body?.goal || ""
    ).trim();

    if (!goal) {
      return new Response(
        JSON.stringify({
          success: false,
          error: "Please provide a goal.",
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

    // =========================================================
    // OPENROUTER KEY CHECK
    // =========================================================

    if (!env.OPENROUTER_KEY) {
      return new Response(
        JSON.stringify({
          success: false,
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

    // =========================================================
    // CONFIGURATION
    // =========================================================

    const OPENROUTER_URL =
      "https://openrouter.ai/api/v1/chat/completions";

    const MODELS_URL =
      "https://openrouter.ai/api/v1/models";

    // Maximum number of explicit free models retained
    // for manual recovery.
    const MAX_FREE_MODELS = 12;

    // Maximum time allowed for one model request.
    const MODEL_TIMEOUT_MS = 45000;

    // =========================================================
    // RESPONSE HELPER
    // =========================================================

    function jsonResponse(data, status = 200) {
      return new Response(
        JSON.stringify(data, null, 2),
        {
          status,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json",
          },
        }
      );
    }

    // =========================================================
    // CLEAN TEXT
    // =========================================================

    function cleanText(value) {
      if (
        value === null ||
        value === undefined
      ) {
        return "";
      }

      return String(value)
        .replace(/\u0000/g, "")
        .trim();
    }

    // =========================================================
    // EXTRACT JSON FROM MODEL RESPONSE
    // =========================================================

    function extractJSON(text) {
      if (!text) {
        throw new Error(
          "Empty model response."
        );
      }

      let cleaned =
        String(text).trim();

      // Remove markdown fences.
      cleaned = cleaned
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

      // -------------------------------------------------------
      // Attempt 1: complete JSON
      // -------------------------------------------------------

      try {
        return JSON.parse(cleaned);
      } catch {}

      // -------------------------------------------------------
      // Attempt 2: find JSON object
      // -------------------------------------------------------

      const firstObject =
        cleaned.indexOf("{");

      const lastObject =
        cleaned.lastIndexOf("}");

      if (
        firstObject !== -1 &&
        lastObject > firstObject
      ) {
        const candidate =
          cleaned.slice(
            firstObject,
            lastObject + 1
          );

        try {
          return JSON.parse(candidate);
        } catch {}
      }

      // -------------------------------------------------------
      // Attempt 3: find JSON array
      // -------------------------------------------------------

      const firstArray =
        cleaned.indexOf("[");

      const lastArray =
        cleaned.lastIndexOf("]");

      if (
        firstArray !== -1 &&
        lastArray > firstArray
      ) {
        const candidate =
          cleaned.slice(
            firstArray,
            lastArray + 1
          );

        try {
          return JSON.parse(candidate);
        } catch {}
      }

      throw new Error(
        "Model returned text, but valid JSON could not be extracted."
      );
    }

    // =========================================================
    // EXTRACT CONTENT FROM OPENROUTER RESPONSE
    // =========================================================

    function extractContent(data) {
      const choice =
        data?.choices?.[0];

      if (!choice) {
        throw new Error(
          "OpenRouter returned no choices."
        );
      }

      const content =
        choice?.message?.content;

      // Normal string response.
      if (
        typeof content === "string"
      ) {
        return content;
      }

      // Some models/APIs may return content blocks.
      if (
        Array.isArray(content)
      ) {
        return content
          .map((block) => {
            if (
              typeof block === "string"
            ) {
              return block;
            }

            if (block?.text) {
              return block.text;
            }

            if (block?.content) {
              return block.content;
            }

            return "";
          })
          .join("\n")
          .trim();
      }

      throw new Error(
        "Model returned unsupported content format."
      );
    }

    // =========================================================
    // DISCOVER FREE MODELS
    //
    // Uses OpenRouter's official Models API.
    //
    // We recognize:
    //
    //   model:free
    //
    // and models whose prompt + completion pricing are zero.
    // =========================================================

    async function getFreeModels() {
      try {
        const response =
          await fetch(
            MODELS_URL,
            {
              headers: {
                Authorization:
                  `Bearer ${env.OPENROUTER_KEY}`,
              },
            }
          );

        if (!response.ok) {
          return [];
        }

        const data =
          await response.json();

        const models =
          Array.isArray(data?.data)
            ? data.data
            : [];

        const free = [];

        for (
          const model of models
        ) {
          const id =
            model?.id;

          if (
            !id ||
            typeof id !== "string"
          ) {
            continue;
          }

          const pricing =
            model?.pricing || {};

          const promptPrice =
            Number(
              pricing.prompt
            );

          const completionPrice =
            Number(
              pricing.completion
            );

          const explicitFree =
            id.endsWith(":free") ||
            (
              Number.isFinite(
                promptPrice
              ) &&
              Number.isFinite(
                completionPrice
              ) &&
              promptPrice === 0 &&
              completionPrice === 0
            );

          if (!explicitFree) {
            continue;
          }

          const supported =
            model?.supported_parameters ||
            [];

          const supportsResponseFormat =
            Array.isArray(
              supported
            ) &&
            (
              supported.includes(
                "response_format"
              ) ||
              supported.includes(
                "structured_outputs"
              )
            );

          free.push({
            id,
            supportsResponseFormat,
            contextLength:
              Number(
                model?.context_length
              ) || 0,
          });
        }

        // Prefer models that advertise structured output support.
        free.sort(
          (a, b) => {
            if (
              a.supportsResponseFormat &&
              !b.supportsResponseFormat
            ) {
              return -1;
            }

            if (
              !a.supportsResponseFormat &&
              b.supportsResponseFormat
            ) {
              return 1;
            }

            return (
              b.contextLength -
              a.contextLength
            );
          }
        );

        return free
          .map(
            (item) => item.id
          )
          .filter(Boolean)
          .slice(
            0,
            MAX_FREE_MODELS
          );
      } catch {
        return [];
      }
    }

    // =========================================================
    // BUILD FREE MODEL CANDIDATE LIST
    // =========================================================

    async function getModelCandidates() {
      const discovered =
        await getFreeModels();

      const result = [
        "openrouter/free",
        ...discovered,
      ];

      return [
        ...new Set(result),
      ];
    }

    // =========================================================
    // CALL ONE SPECIFIC MODEL
    // =========================================================

    async function callModel(
      model,
      messages,
      options = {}
    ) {
      const controller =
        new AbortController();

      const timeout =
        setTimeout(
          () => {
            controller.abort();
          },
          MODEL_TIMEOUT_MS
        );

      try {
        const payload = {
          model,

          messages,

          temperature:
            options.temperature ??
            0.2,

          max_tokens:
            options.max_tokens ??
            7000,

          response_format: {
            type: "json_object",
          },

          provider: {
            allow_fallbacks: true,
          },
        };

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
                  "https://autonomouswork.space",

                "X-Title":
                  "Autonomous Work Space",
              },

              body:
                JSON.stringify(
                  payload
                ),

              signal:
                controller.signal,
            }
          );

        const rawText =
          await response.text();

        let data;

        try {
          data =
            JSON.parse(
              rawText
            );
        } catch {
          throw new Error(
            `OpenRouter returned non-JSON HTTP response (${response.status}).`
          );
        }

        if (!response.ok) {
          const message =
            data?.error?.message ||
            data?.error?.metadata?.raw ||
            `OpenRouter HTTP ${response.status}`;

          throw new Error(
            message
          );
        }

        const content =
          extractContent(
            data
          );

        const parsed =
          extractJSON(
            content
          );

        return {
          success: true,

          modelRequested:
            model,

          modelUsed:
            data?.model ||
            model,

          data:
            parsed,
        };
      } catch (err) {
        if (
          err?.name ===
          "AbortError"
        ) {
          throw new Error(
            `Model timeout after ${MODEL_TIMEOUT_MS / 1000}s: ${model}`
          );
        }

        throw err;
      } finally {
        clearTimeout(
          timeout
        );
      }
    }

    // =========================================================
    // SMART LLM ROUTER
    //
    // FIRST:
    // OpenRouter native fallback.
    //
    // SECOND:
    // Manual free-model recovery.
    //
    // This gives us two layers of protection.
    // =========================================================

    async function runLLM(
      messages,
      options = {}
    ) {
      const candidates =
        await getModelCandidates();

      const primary =
        candidates[0] ||
        "openrouter/free";

      const fallbackModels =
        candidates.slice(1);

      const attempts = [];

      // =======================================================
      // PASS 1
      //
      // Let OpenRouter handle model fallback.
      // =======================================================

      try {
        const controller =
          new AbortController();

        const timeout =
          setTimeout(
            () => {
              controller.abort();
            },
            MODEL_TIMEOUT_MS
          );

        try {
          const payload = {
            model:
              primary,

            models:
              fallbackModels,

            messages,

            temperature:
              options.temperature ??
              0.2,

            max_tokens:
              options.max_tokens ??
              7000,

            response_format: {
              type: "json_object",
            },

            provider: {
              allow_fallbacks:
                true,
            },
          };

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
                    "https://autonomouswork.space",

                  "X-Title":
                    "Autonomous Work Space",
                },

                body:
                  JSON.stringify(
                    payload
                  ),

                signal:
                  controller.signal,
              }
            );

          const rawText =
            await response.text();

          let data;

          try {
            data =
              JSON.parse(
                rawText
              );
          } catch {
            throw new Error(
              `OpenRouter returned invalid HTTP JSON (${response.status}).`
            );
          }

          if (!response.ok) {
            const message =
              data?.error?.message ||
              data?.error?.metadata?.raw ||
              `OpenRouter HTTP ${response.status}`;

            throw new Error(
              message
            );
          }

          const content =
            extractContent(
              data
            );

          const parsed =
            extractJSON(
              content
            );

          return {
            success: true,

            data:
              parsed,

            modelUsed:
              data?.model ||
              primary,

            modelAttempts:
              candidates.length,

            attemptedModels:
              candidates,

            nativeFallback:
              true,

            manualRecovery:
              false,
          };
        } finally {
          clearTimeout(
            timeout
          );
        }
      } catch (nativeError) {
        attempts.push({
          stage:
            "native_fallback",

          error:
            cleanText(
              nativeError.message
            ),
        });
      }

      // =======================================================
      // PASS 2
      //
      // Manual model-by-model recovery.
      //
      // This is especially useful if a model technically
      // responds but produces invalid JSON.
      // =======================================================

      const manualCandidates =
        candidates.filter(
          (model) =>
            model !== primary
        );

      for (
        const model of manualCandidates
      ) {
        try {
          const result =
            await callModel(
              model,
              messages,
              options
            );

          return {
            ...result,

            modelAttempts:
              candidates.length,

            attemptedModels:
              candidates,

            nativeFallback:
              false,

            manualRecovery:
              true,

            previousErrors:
              attempts,
          };
        } catch (err) {
          attempts.push({
            stage:
              "manual_recovery",

            model,

            error:
              cleanText(
                err.message
              ),
          });
        }
      }

      throw new Error(
        JSON.stringify({
          message:
            "All available free OpenRouter models failed.",

          attempts,
        })
      );
    }

    // =========================================================
    // PHASE 1
    // GOAL INTELLIGENCE
    // =========================================================

    const plannerSystem = `
You are the Goal Intelligence Planner for Autonomous Work Space.

Your job is to deeply understand the user's desired outcome before selecting tools or agents.

IMPORTANT:

- Do NOT use Airtable.
- Do NOT assume a fixed internal directory.
- Do NOT assume the ecosystem is limited to known tools.
- Think about the broader external AI/software ecosystem.
- Focus on capabilities rather than merely product names.
- Identify what must happen for the user's goal to succeed.
- Identify constraints and dependencies.
- Think in terms of autonomous work.

Return ONLY valid JSON.

Required structure:

{
  "goal": "",
  "goal_type": "",
  "desired_outcome": "",
  "required_capabilities": [],
  "workflow_requirements": [],
  "constraints": [],
  "likely_agent_roles": [],
  "likely_tool_roles": [],
  "critical_dependencies": [],
  "success_criteria": [],
  "unknowns": []
}
`;

    // =========================================================
    // PHASE 2
    // INITIAL ARCHITECTURE
    // =========================================================

    const architectureSystem = `
You are the Autonomous Work Space Architect.

Build an autonomous system architecture for the user's goal.

IMPORTANT:

- Airtable is NOT the source of available tools.
- Do NOT limit the architecture to an internal directory.
- Think about the entire external AI/software ecosystem.
- Identify appropriate agent roles.
- Identify appropriate tool roles.
- Identify integrations.
- Identify infrastructure.
- Identify automation.
- Identify data flow.
- Specific external products may be suggested where useful.
- Never claim a product has a capability without reasonable confidence.
- Separate required components from optional components.
- Avoid unnecessary complexity.
- Design something that could realistically be implemented.

Return ONLY valid JSON.

Required structure:

{
  "architecture_summary": "",
  "system_objective": "",

  "layers": [
    {
      "name": "",
      "purpose": "",
      "components": [],
      "reason": ""
    }
  ],

  "agents": [
    {
      "name": "",
      "role": "",
      "reason": "",
      "required_capabilities": [],
      "suggested_external_options": []
    }
  ],

  "tools": [
    {
      "name": "",
      "role": "",
      "reason": "",
      "required_capabilities": [],
      "suggested_external_options": []
    }
  ],

  "integrations": [],
  "data_flow": [],
  "automation_flow": [],
  "human_touchpoints": [],
  "security_considerations": [],
  "scalability_considerations": [],
  "capability_gaps": [],
  "recommendations": []
}
`;

    // =========================================================
    // PHASE 3
    // SELF REVIEW
    // =========================================================

    const reviewSystem = `
You are the Self-Review Architect for Autonomous Work Space.

Review the proposed architecture against the original user's goal.

Be critical and practical.

Look for:

- missing capabilities
- redundant components
- weak workflow links
- unnecessary complexity
- missing integrations
- missing human approvals
- security issues
- scalability issues
- failure points
- components that do not actually contribute
- manual steps that should be automated
- places where an agent or tool is missing
- unrealistic assumptions

Do NOT merely praise the architecture.

Return ONLY valid JSON.

Required structure:

{
  "summary": "",
  "strengths": [],
  "weaknesses": [],
  "missing_capabilities": [],
  "redundancies": [],
  "failure_points": [],
  "security_concerns": [],
  "scalability_concerns": [],
  "improvements": [],
  "priority_gaps": []
}
`;

    // =========================================================
    // PHASE 4
    // GAP SOLVER
    // =========================================================

    const gapSolverSystem = `
You are the Gap-Solving Architect for Autonomous Work Space.

The architecture has already been reviewed.

Your job is to solve the identified gaps.

IMPORTANT:

- Do not blindly add components.
- Only add a component when it solves a real requirement.
- Think across the broader external AI/software ecosystem.
- Suggest external agents, tools or services when they materially solve a gap.
- Do not use Airtable as a discovery source.
- Do not assume a component exists simply because its name sounds suitable.
- Prefer simple solutions when they are sufficient.

Return ONLY valid JSON.

Required structure:

{
  "gap_analysis": [
    {
      "gap": "",
      "severity": "",
      "solution": "",
      "required_component_type": "",
      "candidate_external_options": [],
      "reason": ""
    }
  ],

  "components_to_add": [],
  "components_to_remove": [],
  "components_to_modify": [],
  "workflow_changes": [],
  "integration_changes": [],
  "final_requirements": []
}
`;

    // =========================================================
    // PHASE 5
    // FINAL REBUILD
    // =========================================================

    const rebuildSystem = `
You are the Final Autonomous Work Space Architect.

Rebuild the architecture using:

1. Original user goal.
2. Goal intelligence plan.
3. Initial architecture.
4. Self-review.
5. Gap-solving analysis.

This is the final architecture.

IMPORTANT:

- Airtable is NOT an input.
- Do not make Airtable a dependency.
- Do not mention Airtable as part of the architecture.
- Think about the broader external ecosystem.
- Remove unnecessary components.
- Add missing components only when justified.
- Make the architecture practical.
- Clearly explain why each major component exists.
- Identify realistic external agents/tools/services where appropriate.
- Keep the workflow coherent.
- Do not over-engineer the system.

Return ONLY valid JSON.

Required structure:

{
  "architecture_summary": "",
  "system_objective": "",

  "layers": [
    {
      "name": "",
      "purpose": "",
      "components": [],
      "reason": ""
    }
  ],

  "agents": [
    {
      "name": "",
      "role": "",
      "purpose": "",
      "required_capabilities": [],
      "suggested_external_options": [],
      "reason": ""
    }
  ],

  "tools": [
    {
      "name": "",
      "role": "",
      "purpose": "",
      "required_capabilities": [],
      "suggested_external_options": [],
      "reason": ""
    }
  ],

  "integrations": [],

  "data_flow": [],

  "automation_flow": [],

  "human_touchpoints": [],

  "security_considerations": [],

  "scalability_considerations": [],

  "capability_gaps": [],

  "recommendations": [],

  "external_recommendations": []
}
`;

    // =========================================================
    // PHASE 6
    // FINAL QUALITY REVIEW
    // =========================================================

    const finalReviewSystem = `
You are the Final Quality Controller for Autonomous Work Space.

Review the final architecture against the original user's goal.

Check:

1. Does every important user requirement have a capability?
2. Are the agents actually useful?
3. Are the tools actually useful?
4. Are integrations logical?
5. Is the workflow executable?
6. Are there obvious missing capabilities?
7. Are there unnecessary components?
8. Are there security concerns?
9. Is the system scalable?
10. Could a real user reasonably implement it?

Do not redesign everything unless necessary.

Return ONLY valid JSON.

Required structure:

{
  "overall_assessment": "",
  "goal_coverage": "",
  "critical_missing_items": [],
  "remaining_gaps": [],
  "unnecessary_items": [],
  "implementation_risks": [],
  "final_improvements": [],
  "ready_for_implementation": true
}
`;

    // =========================================================
    // BUILD STATE
    // =========================================================

    const buildState = {
      success: false,

      goal,

      stage:
        "starting",

      completedStages: [],

      modelUsage: [],
    };

    // =========================================================
    // EXECUTE BUILDER
    // =========================================================

    try {
      // =======================================================
      // PHASE 1
      // =======================================================

      buildState.stage =
        "goal_understanding";

      const planningResult =
        await runLLM(
          [
            {
              role:
                "system",

              content:
                plannerSystem,
            },

            {
              role:
                "user",

              content:
                `USER GOAL:\n${goal}`,
            },
          ],
          {
            max_tokens:
              5000,

            temperature:
              0.2,
          }
        );

      const planning =
        planningResult.data;

      buildState.completedStages.push(
        "goal_understanding"
      );

      buildState.modelUsage.push({
        stage:
          "goal_understanding",

        model:
          planningResult.modelUsed,
      });

      // =======================================================
      // PHASE 2
      // =======================================================

      buildState.stage =
        "initial_architecture";

      const architectureResult =
        await runLLM(
          [
            {
              role:
                "system",

              content:
                architectureSystem,
            },

            {
              role:
                "user",

              content:
                JSON.stringify(
                  {
                    user_goal:
                      goal,

                    planning:
                      planning,
                  },
                  null,
                  2
                ),
            },
          ],
          {
            max_tokens:
              6500,

            temperature:
              0.25,
          }
        );

      const initialArchitecture =
        architectureResult.data;

      buildState.completedStages.push(
        "initial_architecture"
      );

      buildState.modelUsage.push({
        stage:
          "initial_architecture",

        model:
          architectureResult.modelUsed,
      });

      // =======================================================
      // PHASE 3
      // =======================================================

      buildState.stage =
        "self_review";

      const reviewResult =
        await runLLM(
          [
            {
              role:
                "system",

              content:
                reviewSystem,
            },

            {
              role:
                "user",

              content:
                JSON.stringify(
                  {
                    user_goal:
                      goal,

                    planning:
                      planning,

                    architecture:
                      initialArchitecture,
                  },
                  null,
                  2
                ),
            },
          ],
          {
            max_tokens:
              5000,

            temperature:
              0.2,
          }
        );

      const selfReview =
        reviewResult.data;

      buildState.completedStages.push(
        "self_review"
      );

      buildState.modelUsage.push({
        stage:
          "self_review",

        model:
          reviewResult.modelUsed,
      });

      // =======================================================
      // PHASE 4
      // =======================================================

      buildState.stage =
        "gap_solving";

      const gapResult =
        await runLLM(
          [
            {
              role:
                "system",

              content:
                gapSolverSystem,
            },

            {
              role:
                "user",

              content:
                JSON.stringify(
                  {
                    user_goal:
                      goal,

                    architecture:
                      initialArchitecture,

                    self_review:
                      selfReview,
                  },
                  null,
                  2
                ),
            },
          ],
          {
            max_tokens:
              5500,

            temperature:
              0.2,
          }
        );

      const gapSolutions =
        gapResult.data;

      buildState.completedStages.push(
        "gap_solving"
      );

      buildState.modelUsage.push({
        stage:
          "gap_solving",

        model:
          gapResult.modelUsed,
      });

      // =======================================================
      // PHASE 5
      // =======================================================

      buildState.stage =
        "final_rebuild";

      const rebuildResult =
        await runLLM(
          [
            {
              role:
                "system",

              content:
                rebuildSystem,
            },

            {
              role:
                "user",

              content:
                JSON.stringify(
                  {
                    user_goal:
                      goal,

                    planning:
                      planning,

                    initial_architecture:
                      initialArchitecture,

                    self_review:
                      selfReview,

                    gap_solutions:
                      gapSolutions,
                  },
                  null,
                  2
                ),
            },
          ],
          {
            max_tokens:
              7500,

            temperature:
              0.2,
          }
        );

      const finalArchitecture =
        rebuildResult.data;

      buildState.completedStages.push(
        "final_rebuild"
      );

      buildState.modelUsage.push({
        stage:
          "final_rebuild",

        model:
          rebuildResult.modelUsed,
      });

      // =======================================================
      // PHASE 6
      // =======================================================

      buildState.stage =
        "final_quality_review";

      const finalReviewResult =
        await runLLM(
          [
            {
              role:
                "system",

              content:
                finalReviewSystem,
            },

            {
              role:
                "user",

              content:
                JSON.stringify(
                  {
                    user_goal:
                      goal,

                    final_architecture:
                      finalArchitecture,
                  },
                  null,
                  2
                ),
            },
          ],
          {
            max_tokens:
              4500,

            temperature:
              0.2,
          }
        );

      const finalQualityReview =
        finalReviewResult.data;

      buildState.completedStages.push(
        "final_quality_review"
      );

      buildState.modelUsage.push({
        stage:
          "final_quality_review",

        model:
          finalReviewResult.modelUsed,
      });

      // =======================================================
      // FRONTEND COMPATIBILITY
      //
      // These fields are kept because the existing Stack page
      // expects them.
      // =======================================================

      finalArchitecture.review =
        {
          summary:
            selfReview?.summary ||
            finalQualityReview?.overall_assessment ||
            "",

          improvements:
            selfReview?.improvements ||
            finalQualityReview?.final_improvements ||
            [],
        };

      finalArchitecture.architecture_summary =
        finalArchitecture.architecture_summary ||
        finalArchitecture.system_objective ||
        "Autonomous architecture generated from the user's goal.";

      finalArchitecture.external_recommendations =
        finalArchitecture.external_recommendations ||
        finalArchitecture.recommendations ||
        [];

      // =======================================================
      // SUCCESS
      // =======================================================

      buildState.success =
        true;

      buildState.stage =
        "complete";

      return jsonResponse({
        success:
          true,

        goal,

        architecture:
          finalArchitecture,

        planning,

        initial_architecture:
          initialArchitecture,

        self_review:
          selfReview,

        gap_solutions:
          gapSolutions,

        final_quality_review:
          finalQualityReview,

        builder_metadata: {
          discovery_mode:
            "LLM-driven external ecosystem reasoning",

          airtable_used_by_builder:
            false,

          external_search_api_used:
            false,

          free_model_routing:
            "OpenRouter free models",

          native_model_fallback:
            true,

          manual_model_recovery:
            true,

          completed_stages:
            buildState.completedStages,

          model_usage:
            buildState.modelUsage,
        },

        message:
          "Autonomous stack built successfully.",
      });
    } catch (err) {
      // =======================================================
      // FAILURE
      //
      // Return diagnostic information instead of a blank
      // response so we know exactly where the Builder stopped.
      // =======================================================

      buildState.success =
        false;

      let parsedError =
        null;

      try {
        parsedError =
          JSON.parse(
            err.message
          );
      } catch {}

      return jsonResponse(
        {
          success:
            false,

          error:
            parsedError ||
            err.message ||
            "Stack builder failed.",

          goal,

          failed_stage:
            buildState.stage,

          completed_stages:
            buildState.completedStages,

          model_usage:
            buildState.modelUsage,

          message:
            `Stack builder stopped during: ${buildState.stage}`,
        },
        500
      );
    }
  },
};
