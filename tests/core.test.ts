import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  backoffMs, contactSearchBody, dealBody, flatten, isRetryable, normalizeEmail, normalizePhone, parseBudget,
  routeOwner, scoreLead, taskBody, titleCase, validate, type Rules,
} from "../src/core.js";
import { parseBody } from "../src/parse.js";

const rules: Rules = JSON.parse(readFileSync(new URL("../rules/rules.json", import.meta.url), "utf8"));
const web = JSON.parse(readFileSync(new URL("../samples/web-form.json", import.meta.url), "utf8"));
const jot = JSON.parse(readFileSync(new URL("../samples/jotform-rawRequest.json", import.meta.url), "utf8"));

describe("normalisation", () => {
  it("emails", () => {
    expect(normalizeEmail("  Dana.Levi@Acme.CO.IL ")).toBe("dana.levi@acme.co.il");
    expect(normalizeEmail("not-an-email")).toBeUndefined();
    expect(normalizeEmail("a@b")).toBeUndefined();
  });
  it("phones to E.164", () => {
    expect(normalizePhone("054-123-4567")).toBe("+972541234567");
    expect(normalizePhone("+1 (212) 555-0147")).toBe("+12125550147");
    expect(normalizePhone("00972 54 123 4567")).toBe("+972541234567");
    expect(normalizePhone("(212) 555-0147", "1")).toBe("+12125550147");
    expect(normalizePhone("12")).toBeUndefined();
  });
  it("names and budgets", () => {
    expect(titleCase("  dana   LEVI-cohen ")).toBe("Dana   Levi-Cohen");
    expect(parseBudget("$12,000")).toBe(12000);
    expect(parseBudget("2k")).toBe(2000);
    expect(parseBudget("tbd")).toBeUndefined();
  });
});

describe("validate", () => {
  it("normalises a generic web form", () => {
    const r = validate(web, rules);
    expect(r.ok).toBe(true);
    expect(r.lead).toMatchObject({
      email: "dana.levi@acme-logistics.co.il", firstName: "Dana", lastName: "Levi", phone: "+972541234567",
      company: "Acme Logistics", jobTitle: "Head of Operations", country: "IL", budget: 12000, timeline: "asap",
      source: "referral", submissionId: "web-0001", businessEmail: true,
    });
  });
  it("reads a Jotform webhook (rawRequest JSON string, q<N>_ keys, nested name/phone)", () => {
    const r = validate({ submissionID: "5800000000001", rawRequest: JSON.stringify(jot), formID: "241234567890123" }, rules);
    expect(r.ok).toBe(true);
    expect(r.lead).toMatchObject({ email: "john.smith@gmail.com", firstName: "John", lastName: "Smith", phone: "+12125550147",
      company: "Smith Plumbing", budget: 2000, country: "US", submissionId: "5800000000001", businessEmail: false, message: "Quote for automation" });
  });
  it("rejects missing email/name and bad phone with clear errors", () => {
    expect(validate({ name: "X" }, rules).errors).toContain("email is required");
    expect(validate({ email: "bad", name: "X" }, rules).errors).toContain("invalid email: bad");
    expect(validate({ email: "a@b.com" }, rules).errors).toContain("first name is required");
    expect(validate({ email: "a@b.com", name: "A", phone: "12" }, rules).errors).toContain("invalid phone: 12");
  });
  it("flattens arrays and nested objects", () => {
    expect(flatten({ services: ["SEO", "Ads"], address: { city: "Haifa" } })).toMatchObject({ services: "SEO, Ads", city: "Haifa" });
  });
});

describe("scoring and routing", () => {
  it("scores the sample web lead as hot with reasons", () => {
    const s = scoreLead(validate(web, rules).lead!, rules);
    expect(s.score).toBe(90);
    expect(s.tier).toBe("hot");
    expect(s.reasons).toEqual(["budget_10k +30", "business_email +15", "decision_maker +15", "has_phone +5", "detailed_message +5", "referral +10", "urgent_timeline +10"]);
    expect(s).toMatchObject({ taskDueHours: 1, taskPriority: "HIGH" });
  });
  it("scores a gmail lead with small budget as cold", () => {
    const s = scoreLead(validate({ name: "A B", email: "a@gmail.com", budget: "500" }, rules).lead!, rules);
    expect(s).toMatchObject({ score: 0, tier: "cold", taskPriority: "LOW" });
  });
  it("routes by first matching rule, else round-robin", () => {
    const big = validate({ name: "A", email: "a@x.com", budget: "20000", country: "IL" }, rules).lead!;
    expect(routeOwner(big, rules, 0)).toMatchObject({ ownerId: "1001", rule: "enterprise" });
    const il = validate({ name: "A", email: "a@x.com", country: "Israel" }, rules).lead!;
    expect(routeOwner(il, rules, 0)).toMatchObject({ ownerId: "1002", rule: "israel" });
    const us = validate({ name: "A", email: "a@x.com", country: "US" }, rules).lead!;
    expect([0, 1, 2].map((n) => routeOwner(us, rules, n).ownerId)).toEqual(["2001", "2002", "2001"]);
  });
});

describe("HubSpot request bodies (CRM v3)", () => {
  const lead = validate(web, rules).lead!;
  const score = scoreLead(lead, rules);
  it("search: email OR phone as two filterGroups", () => {
    expect(contactSearchBody(lead).filterGroups).toEqual([
      { filters: [{ propertyName: "email", operator: "EQ", value: "dana.levi@acme-logistics.co.il" }] },
      { filters: [{ propertyName: "phone", operator: "EQ", value: "+972541234567" }] },
    ]);
  });
  it("deal associated to contact (type 3) and task to contact (204) and deal (216)", () => {
    const d = dealBody(lead, score, "1001", "501", rules);
    expect(d.properties).toEqual({ dealname: "Acme Logistics - inbound (hot)", pipeline: "default", dealstage: "appointmentscheduled", hubspot_owner_id: "1001", amount: "12000" });
    expect(d.associations[0]).toEqual({ to: { id: "501" }, types: [{ associationCategory: "HUBSPOT_DEFINED", associationTypeId: 3 }] });
    const t = taskBody(lead, score, "1001", "501", "601", Date.UTC(2026, 9, 17, 9));
    expect(t.properties).toMatchObject({ hs_timestamp: "2026-10-17T10:00:00.000Z", hs_task_status: "NOT_STARTED", hs_task_priority: "HIGH", hs_task_type: "CALL" });
    expect(t.associations.map((a) => a.types[0].associationTypeId)).toEqual([204, 216]);
  });
});

describe("retry policy", () => {
  it("retries 429/5xx only, honours Retry-After, else exponential jitter", () => {
    expect([429, 500, 503, 400, 404, 409].map(isRetryable)).toEqual([true, true, true, false, false, false]);
    expect(backoffMs(3, 500, "2")).toBe(2000);
    expect(backoffMs(1, 500, null, () => 1)).toBe(500);
    expect(backoffMs(4, 500, null, () => 1)).toBe(4000);
  });
});

describe("body parsing", () => {
  it("parses urlencoded and Jotform-style multipart", () => {
    expect(parseBody(Buffer.from("email=a%40b.com&name=A+B"), "application/x-www-form-urlencoded")).toEqual({ email: "a@b.com", name: "A B" });
    const b = "XyZ";
    const mp = `--${b}\r\nContent-Disposition: form-data; name="submissionID"\r\n\r\n123\r\n--${b}\r\nContent-Disposition: form-data; name="rawRequest"\r\n\r\n{"q4_email":"a@b.com"}\r\n--${b}--\r\n`;
    expect(parseBody(Buffer.from(mp), `multipart/form-data; boundary=${b}`)).toEqual({ submissionID: "123", rawRequest: '{"q4_email":"a@b.com"}' });
    expect(() => parseBody(Buffer.from("x"), "text/plain")).toThrow(/unsupported/);
  });
});
