// Code by Zapier (JavaScript) - Step 1 "Validate, score & route".
// Input Data (map in the Zap editor): raw_json = the whole trigger payload as JSON text, or map single fields:
// email, name, first_name, last_name, phone, company, job_title, country, budget, timeline, message, source, submission_id
/*__LEAD_CORE__*/
const RULES = /*__RULES__*/;
let raw = {};
if (inputData.raw_json) { try { raw = JSON.parse(inputData.raw_json); } catch (e) { raw = {}; } }
for (const [k, v] of Object.entries(inputData)) if (k !== 'raw_json' && v !== undefined && v !== '') raw[k] = v;
const v = LeadCore.validate(raw, RULES, inputData.default_calling_code || '972');
if (!v.ok) { output = { ok: 'false', errors: v.errors.join('; ') }; return output; }
const score = LeadCore.scoreLead(v.lead, RULES);
// Zapier has no shared counter without Storage; use a stable hash of the email for even round-robin.
let h = 0; for (const c of v.lead.email) h = (h * 31 + c.charCodeAt(0)) >>> 0;
const owner = LeadCore.routeOwner(v.lead, RULES, h);
// Code by Zapier outputs must be flat; nested objects are passed as JSON strings.
output = {
  ok: 'true', email: v.lead.email, tier: score.tier, score: score.score, owner_id: owner.ownerId, owner_name: owner.ownerName,
  lead_json: JSON.stringify(v.lead), score_json: JSON.stringify(score), owner_json: JSON.stringify(owner),
};
return output;
