// n8n Code node "Validate, score & route" (Run Once for All Items).
/*__LEAD_CORE__*/
const RULES = /*__RULES__*/;
const item = $input.first().json;
const headers = item.headers || {};
const token = headers['x-webhook-token'] || (item.query || {}).token || '';
if (!$env.WEBHOOK_TOKEN || token !== $env.WEBHOOK_TOKEN) return [{ json: { ok: false, status: 401, errors: ['invalid token'] } }];
let raw = item.body || {};
const v = LeadCore.validate(raw, RULES, $env.DEFAULT_CALLING_CODE || '972');
if (!v.ok) return [{ json: { ok: false, status: 422, errors: v.errors } }];
const state = $getWorkflowStaticData('global');
state.seen = state.seen || {};
if (v.lead.submissionId && state.seen[v.lead.submissionId]) return [{ json: { ok: false, status: 200, errors: ['duplicate_submission'] } }];
if (v.lead.submissionId) state.seen[v.lead.submissionId] = Date.now();
state.rr = (state.rr || 0) + 1;
const score = LeadCore.scoreLead(v.lead, RULES);
const owner = LeadCore.routeOwner(v.lead, RULES, state.rr - 1);
return [{ json: { ok: true, raw, lead: v.lead, score, owner, searchBody: LeadCore.contactSearchBody(v.lead) } }];
