

export default { async fetch(request, env) { const corsHeaders = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type", }; if (request.method === "OPTIONS") { return new Response(null, { status: 204, headers: corsHeaders, }); } if (!["GET", "POST"].includes(request.method)) { return new Response("Method not allowed", { status: 405, headers: corsHeaders, }); } try { const BASE_ID = "appY6TPhOsmj3dIX8"; const TABLE_NAME = "Table 1"; /* * ============================================================ * GET — LOAD RAW CATALOG (Fallback / Directory View) * ============================================================ */ if (request.method === "GET") { const airtableUrl = `https://airtable.com{BASE_ID}/${encodeURIComponent(TABLE_NAME)}?maxRecords=100`; const response = await fetch(airtableUrl, { headers: { Authorization: `Bearer ${env.AIRTABLE_TOKEN}`, "Content-Type": "application/json", }, }); if (!response.ok) { return new Response(JSON.stringify({ error: "Failed to fetch from Airtable" }), { status: response.status, headers: { ...corsHeaders, "Content-Type": "application/json" }, }); } const data = await response.json(); const items = data.records.map((record) => ({ id: record.id, Name: record.fields.Name || "Untitled", Type: record.fields.Type || "Unknown", Description: record.fields.Description || "", URL: record.fields.URL || "", Category: record.fields.Category || "Uncategorized", created: record.createdTime, })); return new Response(JSON.stringify(items, null, 2), { headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "public, max-age=300", }, }); } /* * ============================================================ * POST /build-stack * ============================================================ */ const url = new URL(request.url); if (url.pathname !== "/build-stack") { return new Response(JSON.stringify({ error: "Unknown endpoint" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" }, }); } if (!env.OPENROUTER_KEY) { return new Response(JSON.stringify({ error: "OPENROUTER_KEY is not configured." }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" }, }); } let body; try { body = await request.json(); } catch { return new Response(JSON.stringify({ error: "Invalid JSON request." }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" }, }); } const goal = String(body.goal || "").trim(); if (!goal) { return new Response(JSON.stringify({ error: "A workspace goal is required." }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" }, }); } // Discover free models on OpenRouter const uniqueModels = await getUniqueFreeModels(env.OPENROUTER_KEY); const MAX_MODEL_ATTEMPTS = Math.min(uniqueModels.length, 8); /* * ------------------------------------------------------------ * STAGE 1: UNDERSTAND GOAL & EXTRACT SEARCH TERMS * ------------------------------------------------------------ */ const keywordSystemPrompt = `You are a precise search query generator. Analyze the user's workspace goal and output a raw JSON array containing exactly 3 distinct, broad categories or keywords (e.g., "CRM", "Database", "AI Agent", "Automation") that describe the types of software components required to solve this goal. Output ONLY valid JSON array. No markdown, no text.`; let keywordContent = ""; for (const model of uniqueModels.slice(0, MAX_MODEL_ATTEMPTS)) { const res = await callOpenRouter(model, env.OPENROUTER_KEY, keywordSystemPrompt, `Goal: ${goal}`, 0.1, 300); if (res.success) { keywordContent = res.content; break; } } let keywords = []; try { const start = keywordContent.indexOf("["); const end = keywordContent.lastIndexOf("]"); keywords = JSON.parse(keywordContent.slice(start, end + 1)); } catch { keywords = ["Automation", "AI", "Database"]; } /* * ------------------------------------------------------------ * STAGE 2: SEARCH AIRTABLE DYNAMICALLY * ------------------------------------------------------------ */ const formulaParts = keywords.map( (kw) => `FIND(LOWER("${kw.replace(/"/g, '\\"') }"), LOWER({Category})), FIND(LOWER("${kw.replace(/"/g, '\\"') }"), LOWER({Description}))` ); const airtableFormula = `OR(${formulaParts.join(",")})`; const airtableSearchUrl = `https://airtable.com{BASE_ID}/${encodeURIComponent(TABLE_NAME)}?filterByFormula=${encodeURIComponent(airtableFormula)}&maxRecords=50`; const searchResponse = await fetch(airtableSearchUrl, { headers: { Authorization: `Bearer ${env.AIRTABLE_TOKEN}`, "Content-Type": "application/json", }, }); let matchedRecords = []; if (searchResponse.ok) { const searchData = await searchResponse.json(); matchedRecords = searchData.records || []; } const catalog = matchedRecords.map((item, index) => ({ index, name: item.fields.Name || "", type: item.fields.Type || "", category: item.fields.Category || "", description: item.fields.Description || "", url: item.fields.URL || "", })); /* * ------------------------------------------------------------ * STAGE 3: CONSTRUCT ARCHITECTURE WITH REASONED SUBSET * ------------------------------------------------------------ */ const systemPrompt = ` You are the autonomous workspace architect for "Autonomous Work Space". Your job is to transform a user's real-world goal into a practical, deeply reasoned autonomous workspace architecture. IMPORTANT RULES: 1. Create only layers that genuinely make sense. Do not force a fixed template. 2. Select agents and tools ONLY from the supplied catalog. Never invent names or URLs. 3. If a capability is completely missing from the matched catalog, explicitly list it under the "gaps" section. 4. Explain WHY each layer exists and WHY each component was selected. 5. Provide an honest, critical self-review targeting structural flaws and remaining system gaps. Return ONLY valid JSON matching the requested schema. Do not include markdown or text wrapping. `; const userPrompt = ` USER WORKSPACE GOAL: ${goal} IDENTIFIED SEARCH KEYWORDS: ${JSON.stringify(keywords)} MATCHED AUTONOMOUS WORK SPACE CATALOG COMPONENTS FROM AIRTABLE: ${JSON.stringify(catalog, null, 2)} Return JSON using exactly this structure: { "goal_summary": "Detailed explanation of what the user is trying to build.", "core_capabilities": [{"name": "capability name", "reason": "why required"}], "layers": [{ "number": 1, "name": "layer name", "purpose": "layer responsibility", "why_needed": "how it fits overall architecture", "agents": [{"name": "exact catalog name", "reason": "reasoning"}], "tools": [{"name": "exact catalog name", "reason": "reasoning"}] }], "gaps": [{"capability": "missing capability", "reason": "why ecosystem lacked it"}], "recommendations": [{"capability": "improvement vector", "reason": "reasons"}], "review": { "summary": "Critical architectural self-critique evaluating system risk and structural incompleteness.", "improvements": ["concrete structural improvement"] }, "architecture_summary": "Detailed Architecture Logic detailing how work flows between capabilities and why this tailored format operates cohesively." } `; let successfulContent = ""; let successfulModel = ""; let finalAttempts = 0; for (const model of uniqueModels.slice(0, MAX_MODEL_ATTEMPTS)) { finalAttempts++; const result = await callOpenRouter(model, env.OPENROUTER_KEY, systemPrompt, userPrompt, 0.2, 6000); if (result.success) { successfulContent = result.content; successfulModel = model; break; } } if (!successfulContent) { return new Response(JSON.stringify({ error: "All active free models failed processing architecture." }), { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" }, }); } let architecture; try { const start = successfulContent.indexOf("{"); const end = successfulContent.lastIndexOf("}"); architecture = JSON.parse(successfulContent.slice(start, end + 1)); } catch { return new Response(JSON.stringify({ error: "Failed to parse final architecture compilation object." }), { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" }, }); } /* * ============================================================ * STRUCTURE GUARANTEES * ============================================================ */ if (!Array.isArray(architecture.core_capabilities)) { architecture.core_capabilities = []; } if (!Array.isArray(architecture.layers)) { 

architecture.layers = [];
}
if (!Array.isArray(architecture.gaps)) {
architecture.gaps = [];
}
if (!Array.isArray(architecture.recommendations)) {
architecture.recommendations = [];
}

return new Response(
JSON.stringify({
success: true,
extracted_keywords: keywords,
catalog_items_found: catalog.length,
architecture,
model_used: successfulModel,
model_attempts: finalAttempts,
}, null, 2),
{ headers: { ...corsHeaders, "Content-Type": "application/json" } }
);

} catch (error) {
return new Response(JSON.stringify({ error: error?.message || "Unexpected runtime exception." }), {
status: 500,
headers: { ...corsHeaders, "Content-Type": "application/json" },
});
}
},
};

/*

============================================================

HELPER FUNCTIONS

============================================================
*/

async function getUniqueFreeModels(apiKey) {
try {
const response = await fetch("openrouter.ai", {
headers: { Authorization: Bearer ${apiKey} },
});
if (!response.ok) return ["openrouter/free"];
const data = await response.json();
if (!Array.isArray(data.data)) return ["openrouter/free"];

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

return [...new Set(["openrouter/free", ...freeModels])];
} catch {
return ["openrouter/free"];
}
}

async function callOpenRouter(model, apiKey, systemContent, userContent, temp, maxTokens) {
try {
const response = await fetch("openrouter.ai", {
method: "POST",
headers: {
Authorization: Bearer ${apiKey},
"Content-Type": "application/json",
"HTTP-Referer": "https://autonomouswork.space",
"X-Title": "Autonomous Work Space",
},
body: JSON.stringify({
model,
messages: [
{ role: "system", content: systemContent },
{ role: "user", content: userContent },
],
temperature: temp,
max_tokens: maxTokens,
}),
});

const text = await response.text();
if (!response.ok) return { success: false };

const data = JSON.parse(text);
let content = data?.choices?.[0]?.message?.content;

if (Array.isArray(content)) {
content = content.map((part) => (typeof part === "string" ? part : part?.text || "")).join("");
}
content = String(content || "").trim();

return content ? { success: true, content } : { success: false };
} catch {
return { success: false };
}
}

