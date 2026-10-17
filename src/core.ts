/**
 * Pure lead logic shared by all three implementations (TypeScript service, n8n Code nodes, Code by Zapier).
 * No I/O here: scripts/build-nocode.mjs bundles this file into the n8n and Zapier code.
 */
export interface RawLead { [k: string]: unknown }

export interface Lead {
  email: string;
  firstName: string;
  lastName: string;
  phone?: string;          // E.164
  company?: string;
  jobTitle?: string;
  country?: string;        // ISO-3166 alpha-2
  budget?: number;
  timeline?: string;
  message?: string;
  source?: string;
  submissionId?: string;
  businessEmail: boolean;
}

export interface ValidationResult { ok: boolean; lead?: Lead; errors: string[] }

export interface Condition { field: string; gte?: number; lt?: number; equals?: unknown; matches?: string; present?: boolean; minLength?: number }
export interface Rules {
  freeEmailDomains: string[];
  scoring: { id: string; points: number; when: Condition }[];
  tiers: { tier: string; minScore: number; taskDueHours: number; taskPriority: "HIGH" | "MEDIUM" | "LOW" }[];
  routing: { id: string; when: Condition; ownerId: string; ownerName: string }[];
  roundRobin: { ownerId: string; ownerName: string }[];
  deal: { pipeline: string; dealstage: string };
}

const ALIASES: Record<keyof Omit<Lead, "businessEmail">, string[]> = {
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
  submissionId: ["submissionid", "submission_id", "id"],
};

const key = (k: string) => k.toLowerCase().replace(/^q\d+_/, "").replace(/[^a-z0-9]/g, "");

/**
 * Flattens a generic JSON form or a Jotform webhook (its `rawRequest` JSON string with q<N>_ keys,
 * where name/phone are nested objects such as {first,last} / {area,phone} / {full}).
 */
export function flatten(raw: RawLead): Record<string, string> {
  let src: RawLead = raw;
  if (typeof raw.rawRequest === "string") {
    try { src = { ...JSON.parse(raw.rawRequest), submissionID: raw.submissionID }; } catch { /* keep raw */ }
  }
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(src)) {
    if (v == null) continue;
    if (typeof v === "object" && !Array.isArray(v)) {
      const o = v as Record<string, unknown>;
      if ("first" in o || "last" in o) { out.firstname ??= String(o.first ?? ""); out.lastname ??= String(o.last ?? ""); continue; }
      if ("area" in o || "phone" in o || "full" in o) { out.phone ??= String(o.full ?? `${o.area ?? ""}${o.phone ?? ""}`); continue; }
      for (const [k2, v2] of Object.entries(o)) if (v2 != null && typeof v2 !== "object") out[key(k2)] ??= String(v2);
      continue;
    }
    const kk = key(k);
    if (kk === "name" || kk === "fullname") {
      const parts = String(v).trim().split(/\s+/);
      out.firstname ??= parts.shift() ?? ""; out.lastname ??= parts.join(" ");
      continue;
    }
    out[kk] ??= Array.isArray(v) ? v.join(", ") : String(v);
  }
  return out;
}

function pick(flat: Record<string, string>, field: keyof typeof ALIASES): string | undefined {
  for (const a of ALIASES[field]) { const v = flat[key(a)]; if (v != null && String(v).trim() !== "") return String(v).trim(); }
  return undefined;
}

export function normalizeEmail(v: string | undefined): string | undefined {
  if (!v) return undefined;
  const e = v.trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/.test(e) ? e : undefined;
}

/** Normalises to E.164. Local numbers starting with 0 use the default country calling code. */
export function normalizePhone(v: string | undefined, defaultCallingCode = "972"): string | undefined {
  if (!v) return undefined;
  let s = v.trim().replace(/[\s().-]/g, "");
  if (s.startsWith("00")) s = "+" + s.slice(2);
  if (!s.startsWith("+")) s = s.startsWith("0") ? `+${defaultCallingCode}${s.slice(1)}` : `+${defaultCallingCode}${s}`;
  return /^\+[1-9]\d{7,14}$/.test(s) ? s : undefined;
}

export function titleCase(v: string): string {
  return v.trim().toLowerCase().replace(/(^|[\s'-])(\p{L})/gu, (_m, p, c) => p + c.toUpperCase());
}

const COUNTRY: Record<string, string> = { israel: "IL", "united states": "US", usa: "US", us: "US", "united kingdom": "GB", uk: "GB", germany: "DE", canada: "CA" };
const CALLING_CODE: Record<string, string> = { IL: "972", US: "1", CA: "1", GB: "44", DE: "49" };

export function parseBudget(v: string | undefined): number | undefined {
  if (!v) return undefined;
  const m = v.replace(/,/g, "").match(/(\d+(?:\.\d+)?)\s*(k)?/i);
  if (!m) return undefined;
  return Math.round(Number(m[1]) * (m[2] ? 1000 : 1));
}

export function validate(raw: RawLead, rules: Pick<Rules, "freeEmailDomains">, defaultCallingCode = "972"): ValidationResult {
  const flat = flatten(raw);
  const errors: string[] = [];
  const rawEmail = pick(flat, "email");
  const email = normalizeEmail(rawEmail);
  if (!email) errors.push(rawEmail ? `invalid email: ${rawEmail}` : "email is required");
  const countryRaw = pick(flat, "country");
  const country = countryRaw ? (COUNTRY[countryRaw.toLowerCase()] ?? (countryRaw.length === 2 ? countryRaw.toUpperCase() : undefined)) : undefined;
  const rawPhone = pick(flat, "phone");
  // A local number is interpreted with the lead's country calling code when known, else the default.
  const phone = normalizePhone(rawPhone, (country && CALLING_CODE[country]) || defaultCallingCode);
  if (rawPhone && !phone) errors.push(`invalid phone: ${rawPhone}`);
  const firstName = titleCase(pick(flat, "firstName") ?? "");
  if (!firstName) errors.push("first name is required");
  if (errors.length) return { ok: false, errors };
  const domain = email!.split("@")[1];
  const clean = (s?: string) => (s ? s.replace(/\s+/g, " ").trim().slice(0, 2000) : undefined);
  const lead: Lead = {
    email: email!, firstName, lastName: titleCase(pick(flat, "lastName") ?? ""), phone,
    company: clean(pick(flat, "company")), jobTitle: clean(pick(flat, "jobTitle")), country,
    budget: parseBudget(pick(flat, "budget")), timeline: pick(flat, "timeline")?.toLowerCase().replace(/\s+/g, "_"),
    message: clean(pick(flat, "message")), source: pick(flat, "source")?.toLowerCase(),
    submissionId: pick(flat, "submissionId"),
    businessEmail: !rules.freeEmailDomains.includes(domain),
  };
  return { ok: true, lead, errors: [] };
}

export function matches(lead: Lead, c: Condition): boolean {
  const v = (lead as unknown as Record<string, unknown>)[c.field];
  if (c.present !== undefined) return (v != null && v !== "") === c.present;
  if (v == null) return false;
  if (c.equals !== undefined && v !== c.equals) return false;
  if (c.gte !== undefined && !(typeof v === "number" && v >= c.gte)) return false;
  if (c.lt !== undefined && !(typeof v === "number" && v < c.lt)) return false;
  if (c.matches !== undefined && !new RegExp(c.matches, "i").test(String(v))) return false;
  if (c.minLength !== undefined && String(v).length < c.minLength) return false;
  return true;
}

export interface Score { score: number; tier: string; reasons: string[]; taskDueHours: number; taskPriority: "HIGH" | "MEDIUM" | "LOW" }

export function scoreLead(lead: Lead, rules: Pick<Rules, "scoring" | "tiers">): Score {
  const hits = rules.scoring.filter((r) => matches(lead, r.when));
  const score = Math.min(100, hits.reduce((s, r) => s + r.points, 0));
  const t = [...rules.tiers].sort((a, b) => b.minScore - a.minScore).find((x) => score >= x.minScore)!;
  return { score, tier: t.tier, reasons: hits.map((h) => `${h.id} +${h.points}`), taskDueHours: t.taskDueHours, taskPriority: t.taskPriority };
}

export interface Owner { ownerId: string; ownerName: string; rule: string }

/** First matching routing rule wins; otherwise round-robin by counter (caller persists the counter). */
export function routeOwner(lead: Lead, rules: Pick<Rules, "routing" | "roundRobin">, counter: number): Owner {
  const r = rules.routing.find((x) => matches(lead, x.when));
  if (r) return { ownerId: r.ownerId, ownerName: r.ownerName, rule: r.id };
  const o = rules.roundRobin[counter % rules.roundRobin.length];
  return { ...o, rule: "round_robin" };
}

/** HubSpot CRM v3 search body: contacts whose email OR phone equals the lead's (filterGroups are ORed). */
export function contactSearchBody(lead: Pick<Lead, "email" | "phone">) {
  const filterGroups = [{ filters: [{ propertyName: "email", operator: "EQ", value: lead.email }] }];
  if (lead.phone) filterGroups.push({ filters: [{ propertyName: "phone", operator: "EQ", value: lead.phone }] });
  return { filterGroups, properties: ["email", "phone", "firstname", "lastname", "hubspot_owner_id"], limit: 2 };
}

/** Contact properties. Existing owner is kept so a returning lead isn't reassigned. */
export function contactProperties(lead: Lead, score: Score, owner: Owner, scoreProperty?: string, existingOwnerId?: string) {
  const p: Record<string, string> = { email: lead.email, firstname: lead.firstName, lifecyclestage: "lead", hs_lead_status: "NEW" };
  if (lead.lastName) p.lastname = lead.lastName;
  if (lead.phone) p.phone = lead.phone;
  if (lead.company) p.company = lead.company;
  if (lead.jobTitle) p.jobtitle = lead.jobTitle;
  if (lead.country) p.country = lead.country;
  p.hubspot_owner_id = existingOwnerId || owner.ownerId;
  if (scoreProperty) p[scoreProperty] = String(score.score);
  return p;
}

export const ASSOC = { DEAL_TO_CONTACT: 3, TASK_TO_CONTACT: 204, TASK_TO_DEAL: 216 } as const;
const assoc = (id: string, typeId: number) => ({ to: { id }, types: [{ associationCategory: "HUBSPOT_DEFINED", associationTypeId: typeId }] });

export function dealBody(lead: Lead, score: Score, ownerId: string, contactId: string, rules: Pick<Rules, "deal">) {
  const name = `${lead.company || `${lead.firstName} ${lead.lastName}`.trim()} - inbound (${score.tier})`;
  const properties: Record<string, string> = { dealname: name, pipeline: rules.deal.pipeline, dealstage: rules.deal.dealstage, hubspot_owner_id: ownerId };
  if (lead.budget) properties.amount = String(lead.budget);
  return { properties, associations: [assoc(contactId, ASSOC.DEAL_TO_CONTACT)] };
}

export function taskBody(lead: Lead, score: Score, ownerId: string, contactId: string, dealId: string, nowMs: number) {
  return {
    properties: {
      hs_timestamp: new Date(nowMs + score.taskDueHours * 3600_000).toISOString(),
      hs_task_subject: `Follow up: ${lead.firstName} ${lead.lastName}`.trim() + ` (${score.tier}, score ${score.score})`,
      hs_task_body: [`Score reasons: ${score.reasons.join(", ") || "none"}`, lead.message ? `Message: ${lead.message}` : ""].filter(Boolean).join("\n"),
      hs_task_status: "NOT_STARTED",
      hs_task_priority: score.taskPriority,
      hs_task_type: score.tier === "hot" ? "CALL" : "EMAIL",
      hubspot_owner_id: ownerId,
    },
    associations: [assoc(contactId, ASSOC.TASK_TO_CONTACT), assoc(dealId, ASSOC.TASK_TO_DEAL)],
  };
}

export function slackMessage(lead: Lead, score: Score, owner: Owner, contactId: string, dealId: string, isNew: boolean) {
  const emoji = score.tier === "hot" ? ":fire:" : score.tier === "warm" ? ":sunny:" : ":snowflake:";
  return {
    text: `${emoji} ${isNew ? "New" : "Returning"} ${score.tier} lead: ${lead.firstName} ${lead.lastName}`.trim() +
      `${lead.company ? ` (${lead.company})` : ""}, score ${score.score} -> ${owner.ownerName}. Contact ${contactId}, deal ${dealId}.`,
  };
}

/** Exponential backoff with full jitter; honours Retry-After (seconds) when the server sends it. */
export function backoffMs(attempt: number, baseMs: number, retryAfter?: string | null, rand: () => number = Math.random): number {
  const ra = retryAfter ? Number(retryAfter) : NaN;
  if (Number.isFinite(ra) && ra >= 0) return ra * 1000;
  return Math.round(rand() * baseMs * 2 ** (attempt - 1));
}

export const isRetryable = (status: number) => status === 429 || status >= 500;
