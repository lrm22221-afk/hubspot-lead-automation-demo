// Code by Zapier (JavaScript) - Step 2 "HubSpot sync" (runs only if Step 1 ok = true; add a Filter step).
// Input Data: lead_json, score_json, owner_json (from Step 1), hubspot_token (paste a private-app token or use a Storage
// secret), score_property (optional), hubspot_base_url (optional, for testing).
// Retries 429/5xx with backoff inside the step. Keep total runtime under your plan's Code step time limit.
/*__LEAD_CORE__*/
const RULES = /*__RULES__*/;
const BASE = (inputData.hubspot_base_url || 'https://api.hubapi.com').replace(/\/+$/, '');
const lead = JSON.parse(inputData.lead_json), score = JSON.parse(inputData.score_json), owner = JSON.parse(inputData.owner_json);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function hs(method, path, body) {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(BASE + path, { method, headers: { Authorization: `Bearer ${inputData.hubspot_token}`, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    const text = await res.text();
    if (res.ok) return text ? JSON.parse(text) : {};
    if (!LeadCore.isRetryable(res.status) || attempt >= 3) throw new Error(`HubSpot ${method} ${path} failed: HTTP ${res.status} ${text.slice(0, 200)}`);
    await sleep(Math.min(LeadCore.backoffMs(attempt, Number(inputData.retry_base_ms || 500), res.headers.get('retry-after')), 4000));
  }
}
const found = (await hs('POST', '/crm/v3/objects/contacts/search', LeadCore.contactSearchBody(lead))).results || [];
const existing = found.find((r) => (r.properties.email || '').toLowerCase() === lead.email) || found[0];
const existingOwner = existing && existing.properties.hubspot_owner_id;
const ownerId = existingOwner || owner.ownerId;
const props = LeadCore.contactProperties(lead, score, owner, inputData.score_property || undefined, existingOwner);
let contactId;
if (existing) {
  delete props.lifecyclestage; delete props.hs_lead_status; if (existing.properties.email) delete props.email;
  contactId = (await hs('PATCH', `/crm/v3/objects/contacts/${existing.id}`, { properties: props })).id;
} else {
  contactId = (await hs('POST', '/crm/v3/objects/contacts', { properties: props })).id;
}
const dealId = (await hs('POST', '/crm/v3/objects/deals', LeadCore.dealBody(lead, score, ownerId, contactId, RULES))).id;
const taskId = (await hs('POST', '/crm/v3/objects/tasks', LeadCore.taskBody(lead, score, ownerId, contactId, dealId, Date.now()))).id;
const ownerForMsg = existingOwner ? { ...owner, ownerId, ownerName: `existing owner ${ownerId}` } : owner;
output = { contact_id: contactId, deal_id: dealId, task_id: taskId, contact_created: String(!existing), slack_text: LeadCore.slackMessage(lead, score, ownerForMsg, contactId, dealId, !existing).text };
return output;
