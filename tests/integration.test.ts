import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { AddressInfo } from "node:net";
import { readFileSync } from "node:fs";
import { createApp } from "../src/app.js";
import { DeadLetterQueue } from "../src/dlq.js";
import type { Config } from "../src/config.js";
import { startMockHubSpot } from "./mock-hubspot.js";

const web = JSON.parse(readFileSync(new URL("../samples/web-form.json", import.meta.url), "utf8"));
const jot = JSON.parse(readFileSync(new URL("../samples/jotform-rawRequest.json", import.meta.url), "utf8"));
let hs: Awaited<ReturnType<typeof startMockHubSpot>>;
let base: string;
let app: ReturnType<typeof createApp>;
const sleeps: number[] = [];

beforeAll(async () => { hs = await startMockHubSpot(); });
afterAll(async () => { await hs.close(); });
beforeEach(async () => {
  hs.reset(); sleeps.length = 0;
  const cfg: Config = {
    port: 0, webhookToken: "hook-secret", adminToken: "admin-secret", hubspotBaseUrl: hs.url, hubspotToken: "test-token",
    scoreProperty: "demo_lead_score", defaultCallingCode: "972", slackWebhookUrl: `${hs.url}/slack`, emailWebhookUrl: `${hs.url}/email`,
    alertEmailTo: "sales@example.com", retryMaxAttempts: 4, retryBaseMs: 100, dlqFile: undefined,
  };
  app = createApp(cfg, { sleep: async (ms) => { sleeps.push(ms); }, now: () => Date.UTC(2026, 9, 17, 9), dlq: new DeadLetterQueue() });
  await new Promise<void>((r) => app.server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
});
afterEach(async () => { await new Promise<void>((r) => app.server.close(() => r())); });

const post = (body: unknown, headers: Record<string, string> = { "Content-Type": "application/json", "X-Webhook-Token": "hook-secret" }) =>
  fetch(`${base}/webhooks/lead`, { method: "POST", headers, body: typeof body === "string" ? body : JSON.stringify(body) });
const hsCalls = () => hs.calls.filter((c) => c.path.startsWith("/crm")).map((c) => `${c.method} ${c.path}`);

describe("webhook intake", () => {
  it("rejects a missing or wrong token", async () => {
    expect((await post(web, { "Content-Type": "application/json" })).status).toBe(401);
    expect((await post(web, { "Content-Type": "application/json", "X-Webhook-Token": "nope" })).status).toBe(401);
    expect(hs.calls).toHaveLength(0);
  });
  it("returns 422 with reasons for invalid leads and makes no HubSpot calls", async () => {
    const r = await post({ name: "No Email" });
    expect(r.status).toBe(422);
    expect((await r.json()).errors).toEqual(["email is required"]);
    expect(hs.calls).toHaveLength(0);
  });
  it("accepts a Jotform multipart webhook with the token in the query string", async () => {
    const b = "----jotform";
    const body = `--${b}\r\nContent-Disposition: form-data; name="submissionID"\r\n\r\n5800000000001\r\n--${b}\r\nContent-Disposition: form-data; name="rawRequest"\r\n\r\n${JSON.stringify(jot)}\r\n--${b}--\r\n`;
    const r = await fetch(`${base}/webhooks/lead?token=hook-secret`, { method: "POST", headers: { "Content-Type": `multipart/form-data; boundary=${b}` }, body });
    expect(r.status).toBe(200);
    const contact = [...hs.db.contacts.values()][0];
    expect(contact.properties).toMatchObject({ email: "john.smith@gmail.com", firstname: "John", phone: "+12125550147", company: "Smith Plumbing", country: "US" });
  });
});

describe("happy path", () => {
  it("creates contact, deal (assoc 3) and task (assoc 204/216), then alerts Slack and email", async () => {
    const r = await post(web);
    expect(r.status).toBe(200);
    const out = await r.json();
    expect(out).toMatchObject({ status: "processed", contactCreated: true, score: 90, tier: "hot", owner: "Senior AE (demo)" });
    expect(hsCalls()).toEqual(["POST /crm/v3/objects/contacts/search", "POST /crm/v3/objects/contacts", "POST /crm/v3/objects/deals", "POST /crm/v3/objects/tasks"]);
    expect(hs.calls.every((c) => !c.path.startsWith("/crm") || c.auth === "Bearer test-token")).toBe(true);

    const contact = hs.db.contacts.get(out.contactId)!;
    expect(contact.properties).toMatchObject({ email: "dana.levi@acme-logistics.co.il", firstname: "Dana", lastname: "Levi", phone: "+972541234567",
      lifecyclestage: "lead", hs_lead_status: "NEW", hubspot_owner_id: "1001", demo_lead_score: "90", country: "IL" });
    const deal = hs.db.deals.get(out.dealId)!;
    expect(deal.properties).toMatchObject({ dealname: "Acme Logistics - inbound (hot)", amount: "12000", hubspot_owner_id: "1001" });
    expect(deal.associations).toEqual([{ to: { id: out.contactId }, types: [{ associationCategory: "HUBSPOT_DEFINED", associationTypeId: 3 }] }]);
    const task = hs.db.tasks.get(out.taskId)!;
    expect(task.properties).toMatchObject({ hs_task_priority: "HIGH", hs_timestamp: "2026-10-17T10:00:00.000Z" });
    expect((task.associations as any[]).map((a) => [a.to.id, a.types[0].associationTypeId])).toEqual([[out.contactId, 204], [out.dealId, 216]]);
    expect(hs.slack[0].text).toContain("New hot lead: Dana Levi (Acme Logistics), score 90 -> Senior AE (demo)");
    expect(hs.email[0]).toMatchObject({ to: "sales@example.com", subject: "New hot lead: dana.levi@acme-logistics.co.il" });
  });
});

describe("dedupe", () => {
  it("ignores a repeated submission id", async () => {
    await post(web);
    const r = await post(web);
    expect((await r.json()).status).toBe("duplicate_submission");
    expect(hs.db.contacts.size).toBe(1);
    expect(hs.db.deals.size).toBe(1);
  });
  it("updates (PATCH) an existing contact found by email and keeps its owner", async () => {
    await post({ ...web, submissionId: "a" });
    const r = await (await post({ ...web, submissionId: "b", email: "DANA.levi@acme-logistics.co.il", company: "Acme Logistics Ltd" })).json();
    expect(r.contactCreated).toBe(false);
    expect(hs.db.contacts.size).toBe(1);
    expect(hsCalls().filter((c) => c.startsWith("PATCH"))).toHaveLength(1);
    expect(hs.db.contacts.get(r.contactId)!.properties.company).toBe("Acme Logistics Ltd");
    expect(hs.slack[1].text).toContain("Returning hot lead");
  });
  it("matches an existing contact by phone when the email differs", async () => {
    await post({ ...web, submissionId: "a" });
    const r = await (await post({ ...web, submissionId: "b", email: "dana@personal-mail.com", phone: "+972 54 123 4567" })).json();
    expect(r.contactCreated).toBe(false);
    expect(hs.db.contacts.size).toBe(1);
    // primary email is not overwritten by a phone-only match
    expect(hs.db.contacts.get(r.contactId)!.properties.email).toBe("dana.levi@acme-logistics.co.il");
  });
  it("round-robins leads that match no routing rule", async () => {
    const owners = [];
    for (const i of [1, 2, 3]) owners.push((await (await post({ name: `Lead ${i}`, email: `l${i}@example.com`, country: "US" })).json()).owner);
    expect(owners).toEqual(["SDR A (demo)", "SDR B (demo)", "SDR A (demo)"]);
  });
});

describe("retries, dead-letter queue and error alerts", () => {
  it("retries 429 honouring Retry-After and 5xx with backoff, then succeeds", async () => {
    hs.fail("POST /crm/v3/objects/contacts/search", { status: 429, retryAfter: "3" });
    hs.fail("POST /crm/v3/objects/deals", { status: 502 }, { status: 503 });
    const r = await (await post(web)).json();
    expect(r.status).toBe("processed");
    expect(sleeps[0]).toBe(3000);
    expect(sleeps).toHaveLength(3);
    expect(sleeps[2]).toBeLessThanOrEqual(200); // attempt 2 => up to base*2
  });
  it("does not retry a 4xx", async () => {
    hs.fail("POST /crm/v3/objects/deals", { status: 400 });
    const r = await (await post(web)).json();
    expect(r.status).toBe("dead_lettered");
    expect(sleeps).toHaveLength(0);
  });
  it("dead-letters after max attempts, sends an error alert, and replays successfully", async () => {
    hs.fail("POST /crm/v3/objects/tasks", { status: 500 }, { status: 500 }, { status: 500 }, { status: 500 });
    const res = await post(web);
    expect(res.status).toBe(202);
    const r = await res.json();
    expect(r).toMatchObject({ status: "dead_lettered", errors: ["create_task: HTTP 500 from " + hs.url + "/crm/v3/objects/tasks"] });
    expect(hs.slack.at(-1).text).toContain("failed at create_task");
    expect(hs.email.at(-1).subject).toBe("Lead automation error (create_task)");
    const admin = { Authorization: "Bearer admin-secret" };
    const dlq = await (await fetch(`${base}/admin/dlq`, { headers: admin })).json();
    expect(dlq).toHaveLength(1);
    expect(dlq[0]).toMatchObject({ step: "create_task", status: 500 });

    const replay = await (await fetch(`${base}/admin/dlq/replay`, { method: "POST", headers: admin })).json();
    expect(replay[0]).toMatchObject({ status: "processed" });
    expect(hs.db.contacts.size).toBe(1); // the contact from the failed run is reused, not duplicated
    expect(await (await fetch(`${base}/admin/dlq`, { headers: admin })).json()).toEqual([]);
  });
  it("a failing Slack alert does not dead-letter a lead that is already in the CRM", async () => {
    hs.fail("POST /slack", { status: 500 }, { status: 500 }, { status: 500 }, { status: 500 });
    const r = await (await post(web)).json();
    expect(r.status).toBe("processed");
    expect(hs.slack).toHaveLength(0);
    expect(hs.calls.filter((c) => c.path === "/slack")).toHaveLength(4);
  });
  it("protects admin endpoints", async () => {
    expect((await fetch(`${base}/admin/dlq`)).status).toBe(401);
  });
});
