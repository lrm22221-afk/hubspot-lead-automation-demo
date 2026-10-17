// Code by Zapier (JavaScript) - Step 2 "HubSpot sync" (runs only if Step 1 ok = true; add a Filter step).
// Input Data: lead_json, score_json, owner_json (from Step 1), hubspot_token (paste a private-app token or use a Storage
// secret), score_property (optional), hubspot_base_url (optional, for testing).
// Retries 429/5xx with backoff inside the step. Keep total runtime under your plan's Code step time limit.
// --- bundled from src/core.ts (do not edit here) ---
var LeadCore = (() => {
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key2 of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key2) && key2 !== except)
          __defProp(to, key2, { get: () => from[key2], enumerable: !(desc = __getOwnPropDesc(from, key2)) || desc.enumerable });
    }
    return to;
  };
  var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

  // src/core.ts
  var core_exports = {};
  __export(core_exports, {
    ASSOC: () => ASSOC,
    backoffMs: () => backoffMs,
    contactProperties: () => contactProperties,
    contactSearchBody: () => contactSearchBody,
    dealBody: () => dealBody,
    flatten: () => flatten,
    isRetryable: () => isRetryable,
    matches: () => matches,
    normalizeEmail: () => normalizeEmail,
    normalizePhone: () => normalizePhone,
    parseBudget: () => parseBudget,
    routeOwner: () => routeOwner,
    scoreLead: () => scoreLead,
    slackMessage: () => slackMessage,
    taskBody: () => taskBody,
    titleCase: () => titleCase,
    validate: () => validate
  });
  var ALIASES = {
    email: ["email", "emailaddress", "e-mail", "mail"],
    firstName: ["firstname", "first", "fname", "givenname"],
    lastName: ["lastname", "last", "lname", "surname", "familyname"],
    phone: ["phone", "phonenumber", "mobile", "tel", "telephone", "full"],
    company: ["company", "companyname", "organization", "business"],
    jobTitle: ["jobtitle", "title", "role", "position"],
    country: ["country", "countrycode"],
    budget: ["budget", "estimatedbudget", "projectbudget"],
    timeline: ["timeline", "timeframe", "when"],
    message: ["message", "comments", "details", "notes", "projectdetails", "howcanwehelp", "howcan"],
    source: ["source", "utmsource", "leadsource", "howdidyouhear"],
    submissionId: ["submissionid", "submission_id", "id"]
  };
  var key = (k) => k.toLowerCase().replace(/^q\d+_/, "").replace(/[^a-z0-9]/g, "");
  function flatten(raw) {
    var _a, _b, _c, _d, _e, _f, _g, _h, _i, _j, _k, _l, _m, _n;
    let src = raw;
    if (typeof raw.rawRequest === "string") {
      try {
        src = { ...JSON.parse(raw.rawRequest), submissionID: raw.submissionID };
      } catch {
      }
    }
    const out = {};
    for (const [k, v] of Object.entries(src)) {
      if (v == null) continue;
      if (typeof v === "object" && !Array.isArray(v)) {
        const o = v;
        if ("first" in o || "last" in o) {
          (_b = out.firstname) != null ? _b : out.firstname = String((_a = o.first) != null ? _a : "");
          (_d = out.lastname) != null ? _d : out.lastname = String((_c = o.last) != null ? _c : "");
          continue;
        }
        if ("area" in o || "phone" in o || "full" in o) {
          (_h = out.phone) != null ? _h : out.phone = String((_g = o.full) != null ? _g : `${(_e = o.area) != null ? _e : ""}${(_f = o.phone) != null ? _f : ""}`);
          continue;
        }
        for (const [k2, v2] of Object.entries(o)) if (v2 != null && typeof v2 !== "object") (_j = out[_i = key(k2)]) != null ? _j : out[_i] = String(v2);
        continue;
      }
      const kk = key(k);
      if (kk === "name" || kk === "fullname") {
        const parts = String(v).trim().split(/\s+/);
        (_l = out.firstname) != null ? _l : out.firstname = (_k = parts.shift()) != null ? _k : "";
        (_m = out.lastname) != null ? _m : out.lastname = parts.join(" ");
        continue;
      }
      (_n = out[kk]) != null ? _n : out[kk] = Array.isArray(v) ? v.join(", ") : String(v);
    }
    return out;
  }
  function pick(flat, field) {
    for (const a of ALIASES[field]) {
      const v = flat[key(a)];
      if (v != null && String(v).trim() !== "") return String(v).trim();
    }
    return void 0;
  }
  function normalizeEmail(v) {
    if (!v) return void 0;
    const e = v.trim().toLowerCase();
    return /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/.test(e) ? e : void 0;
  }
  function normalizePhone(v, defaultCallingCode = "972") {
    if (!v) return void 0;
    let s = v.trim().replace(/[\s().-]/g, "");
    if (s.startsWith("00")) s = "+" + s.slice(2);
    if (!s.startsWith("+")) s = s.startsWith("0") ? `+${defaultCallingCode}${s.slice(1)}` : `+${defaultCallingCode}${s}`;
    return /^\+[1-9]\d{7,14}$/.test(s) ? s : void 0;
  }
  function titleCase(v) {
    return v.trim().toLowerCase().replace(/(^|[\s'-])(\p{L})/gu, (_m, p, c) => p + c.toUpperCase());
  }
  var COUNTRY = { israel: "IL", "united states": "US", usa: "US", us: "US", "united kingdom": "GB", uk: "GB", germany: "DE", canada: "CA" };
  var CALLING_CODE = { IL: "972", US: "1", CA: "1", GB: "44", DE: "49" };
  function parseBudget(v) {
    if (!v) return void 0;
    const m = v.replace(/,/g, "").match(/(\d+(?:\.\d+)?)\s*(k)?/i);
    if (!m) return void 0;
    return Math.round(Number(m[1]) * (m[2] ? 1e3 : 1));
  }
  function validate(raw, rules, defaultCallingCode = "972") {
    var _a, _b, _c, _d, _e;
    const flat = flatten(raw);
    const errors = [];
    const rawEmail = pick(flat, "email");
    const email = normalizeEmail(rawEmail);
    if (!email) errors.push(rawEmail ? `invalid email: ${rawEmail}` : "email is required");
    const countryRaw = pick(flat, "country");
    const country = countryRaw ? (_a = COUNTRY[countryRaw.toLowerCase()]) != null ? _a : countryRaw.length === 2 ? countryRaw.toUpperCase() : void 0 : void 0;
    const rawPhone = pick(flat, "phone");
    const phone = normalizePhone(rawPhone, country && CALLING_CODE[country] || defaultCallingCode);
    if (rawPhone && !phone) errors.push(`invalid phone: ${rawPhone}`);
    const firstName = titleCase((_b = pick(flat, "firstName")) != null ? _b : "");
    if (!firstName) errors.push("first name is required");
    if (errors.length) return { ok: false, errors };
    const domain = email.split("@")[1];
    const clean = (s) => s ? s.replace(/\s+/g, " ").trim().slice(0, 2e3) : void 0;
    const lead = {
      email,
      firstName,
      lastName: titleCase((_c = pick(flat, "lastName")) != null ? _c : ""),
      phone,
      company: clean(pick(flat, "company")),
      jobTitle: clean(pick(flat, "jobTitle")),
      country,
      budget: parseBudget(pick(flat, "budget")),
      timeline: (_d = pick(flat, "timeline")) == null ? void 0 : _d.toLowerCase().replace(/\s+/g, "_"),
      message: clean(pick(flat, "message")),
      source: (_e = pick(flat, "source")) == null ? void 0 : _e.toLowerCase(),
      submissionId: pick(flat, "submissionId"),
      businessEmail: !rules.freeEmailDomains.includes(domain)
    };
    return { ok: true, lead, errors: [] };
  }
  function matches(lead, c) {
    const v = lead[c.field];
    if (c.present !== void 0) return (v != null && v !== "") === c.present;
    if (v == null) return false;
    if (c.equals !== void 0 && v !== c.equals) return false;
    if (c.gte !== void 0 && !(typeof v === "number" && v >= c.gte)) return false;
    if (c.lt !== void 0 && !(typeof v === "number" && v < c.lt)) return false;
    if (c.matches !== void 0 && !new RegExp(c.matches, "i").test(String(v))) return false;
    if (c.minLength !== void 0 && String(v).length < c.minLength) return false;
    return true;
  }
  function scoreLead(lead, rules) {
    const hits = rules.scoring.filter((r) => matches(lead, r.when));
    const score = Math.min(100, hits.reduce((s, r) => s + r.points, 0));
    const t = [...rules.tiers].sort((a, b) => b.minScore - a.minScore).find((x) => score >= x.minScore);
    return { score, tier: t.tier, reasons: hits.map((h) => `${h.id} +${h.points}`), taskDueHours: t.taskDueHours, taskPriority: t.taskPriority };
  }
  function routeOwner(lead, rules, counter) {
    const r = rules.routing.find((x) => matches(lead, x.when));
    if (r) return { ownerId: r.ownerId, ownerName: r.ownerName, rule: r.id };
    const o = rules.roundRobin[counter % rules.roundRobin.length];
    return { ...o, rule: "round_robin" };
  }
  function contactSearchBody(lead) {
    const filterGroups = [{ filters: [{ propertyName: "email", operator: "EQ", value: lead.email }] }];
    if (lead.phone) filterGroups.push({ filters: [{ propertyName: "phone", operator: "EQ", value: lead.phone }] });
    return { filterGroups, properties: ["email", "phone", "firstname", "lastname", "hubspot_owner_id"], limit: 2 };
  }
  function contactProperties(lead, score, owner, scoreProperty, existingOwnerId) {
    const p = { email: lead.email, firstname: lead.firstName, lifecyclestage: "lead", hs_lead_status: "NEW" };
    if (lead.lastName) p.lastname = lead.lastName;
    if (lead.phone) p.phone = lead.phone;
    if (lead.company) p.company = lead.company;
    if (lead.jobTitle) p.jobtitle = lead.jobTitle;
    if (lead.country) p.country = lead.country;
    p.hubspot_owner_id = existingOwnerId || owner.ownerId;
    if (scoreProperty) p[scoreProperty] = String(score.score);
    return p;
  }
  var ASSOC = { DEAL_TO_CONTACT: 3, TASK_TO_CONTACT: 204, TASK_TO_DEAL: 216 };
  var assoc = (id, typeId) => ({ to: { id }, types: [{ associationCategory: "HUBSPOT_DEFINED", associationTypeId: typeId }] });
  function dealBody(lead, score, ownerId, contactId, rules) {
    const name = `${lead.company || `${lead.firstName} ${lead.lastName}`.trim()} - inbound (${score.tier})`;
    const properties = { dealname: name, pipeline: rules.deal.pipeline, dealstage: rules.deal.dealstage, hubspot_owner_id: ownerId };
    if (lead.budget) properties.amount = String(lead.budget);
    return { properties, associations: [assoc(contactId, ASSOC.DEAL_TO_CONTACT)] };
  }
  function taskBody(lead, score, ownerId, contactId, dealId, nowMs) {
    return {
      properties: {
        hs_timestamp: new Date(nowMs + score.taskDueHours * 36e5).toISOString(),
        hs_task_subject: `Follow up: ${lead.firstName} ${lead.lastName}`.trim() + ` (${score.tier}, score ${score.score})`,
        hs_task_body: [`Score reasons: ${score.reasons.join(", ") || "none"}`, lead.message ? `Message: ${lead.message}` : ""].filter(Boolean).join("\n"),
        hs_task_status: "NOT_STARTED",
        hs_task_priority: score.taskPriority,
        hs_task_type: score.tier === "hot" ? "CALL" : "EMAIL",
        hubspot_owner_id: ownerId
      },
      associations: [assoc(contactId, ASSOC.TASK_TO_CONTACT), assoc(dealId, ASSOC.TASK_TO_DEAL)]
    };
  }
  function slackMessage(lead, score, owner, contactId, dealId, isNew) {
    const emoji = score.tier === "hot" ? ":fire:" : score.tier === "warm" ? ":sunny:" : ":snowflake:";
    return {
      text: `${emoji} ${isNew ? "New" : "Returning"} ${score.tier} lead: ${lead.firstName} ${lead.lastName}`.trim() + `${lead.company ? ` (${lead.company})` : ""}, score ${score.score} -> ${owner.ownerName}. Contact ${contactId}, deal ${dealId}.`
    };
  }
  function backoffMs(attempt, baseMs, retryAfter, rand = Math.random) {
    const ra = retryAfter ? Number(retryAfter) : NaN;
    if (Number.isFinite(ra) && ra >= 0) return ra * 1e3;
    return Math.round(rand() * baseMs * 2 ** (attempt - 1));
  }
  var isRetryable = (status) => status === 429 || status >= 500;
  return __toCommonJS(core_exports);
})();
// --- end bundle ---
const RULES = {"_note":"Demo rules. Owner ids are placeholders; replace with real HubSpot owner ids (GET /crm/v3/owners).","freeEmailDomains":["gmail.com","yahoo.com","hotmail.com","outlook.com","icloud.com","walla.co.il","aol.com","proton.me"],"scoring":[{"id":"budget_10k","points":30,"when":{"field":"budget","gte":10000}},{"id":"budget_3k","points":15,"when":{"field":"budget","gte":3000,"lt":10000}},{"id":"business_email","points":15,"when":{"field":"businessEmail","equals":true}},{"id":"decision_maker","points":15,"when":{"field":"jobTitle","matches":"\\b(founder|owner|ceo|cto|coo|head|director|vp)\\b"}},{"id":"has_phone","points":5,"when":{"field":"phone","present":true}},{"id":"detailed_message","points":5,"when":{"field":"message","minLength":60}},{"id":"referral","points":10,"when":{"field":"source","matches":"^(referral|partner)$"}},{"id":"urgent_timeline","points":10,"when":{"field":"timeline","matches":"^(asap|this_month)$"}}],"tiers":[{"tier":"hot","minScore":60,"taskDueHours":1,"taskPriority":"HIGH"},{"tier":"warm","minScore":30,"taskDueHours":24,"taskPriority":"MEDIUM"},{"tier":"cold","minScore":0,"taskDueHours":72,"taskPriority":"LOW"}],"routing":[{"id":"enterprise","when":{"field":"budget","gte":10000},"ownerId":"1001","ownerName":"Senior AE (demo)"},{"id":"israel","when":{"field":"country","matches":"^IL$"},"ownerId":"1002","ownerName":"IL rep (demo)"}],"roundRobin":[{"ownerId":"2001","ownerName":"SDR A (demo)"},{"ownerId":"2002","ownerName":"SDR B (demo)"}],"deal":{"pipeline":"default","dealstage":"appointmentscheduled"}};
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
