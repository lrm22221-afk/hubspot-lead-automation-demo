import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { startMockHubSpot } from "./mock-hubspot.js";

const web = JSON.parse(readFileSync(new URL("../samples/web-form.json", import.meta.url), "utf8"));
const wfFile = new URL("../n8n/hubspot_lead_workflow.json", import.meta.url);
const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
let hs: Awaited<ReturnType<typeof startMockHubSpot>>;
beforeAll(async () => { hs = await startMockHubSpot(); });
afterAll(async () => { await hs.close(); });
beforeEach(() => hs.reset());

describe("generated artifacts", () => {
  it("n8n workflow and Zapier code are in sync with src/core.ts and rules", () => {
    const files = ["n8n/hubspot_lead_workflow.json", "zapier/dist/step1_validate.js", "zapier/dist/step2_hubspot_sync.js"];
    const before = files.map((f) => readFileSync(f, "utf8"));
    execFileSync("node", ["scripts/build-nocode.mjs"]);
    expect(files.map((f) => readFileSync(f, "utf8"))).toEqual(before);
  });
  it("n8n connections reference existing nodes and every HubSpot call has retry + an error branch", () => {
    const wf = JSON.parse(readFileSync(wfFile, "utf8"));
    const names = new Set(wf.nodes.map((n: any) => n.name));
    for (const [from, c] of Object.entries<any>(wf.connections)) {
      expect(names.has(from)).toBe(true);
      for (const b of c.main) for (const l of b) expect(names.has(l.node)).toBe(true);
    }
    const hsNodes = wf.nodes.filter((n: any) => n.type === "n8n-nodes-base.httpRequest" && String(n.parameters.url).includes("HUBSPOT"));
    expect(hsNodes.map((n: any) => n.name)).toEqual(["Search contact", "Upsert contact", "Create deal", "Create task"]);
    for (const n of hsNodes) {
      expect(n).toMatchObject({ retryOnFail: true, maxTries: 5, onError: "continueErrorOutput" });
      expect(wf.connections[n.name].main[1][0].node).toBe("Dead-letter + error alert");
    }
  });
});

describe("n8n Code nodes, chained against the mock HubSpot API", () => {
  const wf = JSON.parse(readFileSync(wfFile, "utf8"));
  const src = (name: string) => wf.nodes.find((n: any) => n.name === name).parameters.jsCode;
  const env = { WEBHOOK_TOKEN: "hook-secret", HUBSPOT_SCORE_PROPERTY: "demo_lead_score", DEFAULT_CALLING_CODE: "972" };

  /** Executes the workflow path the way n8n would, with Code nodes run from the JSON and HTTP nodes as fetch calls. */
  async function runFlow(body: unknown, headers: Record<string, string>, staticData: any) {
    const outputs: Record<string, any> = {};
    const $ = (n: string) => ({ first: () => ({ json: outputs[n] }) });
    const run = async (name: string, input: any) => {
      const fn = new AsyncFunction("$input", "$env", "$getWorkflowStaticData", "$", src(name));
      const out = await fn({ first: () => ({ json: input }) }, env, () => staticData, $);
      return (outputs[name] = out[0].json);
    };
    const http = async (method: string, path: string, b: unknown) => {
      const r = await fetch(hs.url + path, { method, headers: { Authorization: "Bearer test-token", "Content-Type": "application/json" }, body: JSON.stringify(b) });
      return r.json();
    };
    const v = await run("Validate, score & route", { headers, query: {}, body });
    if (!v.ok) return { rejected: v };
    const found = await http("POST", "/crm/v3/objects/contacts/search", v.searchBody);
    const up = await run("Prepare contact upsert", found);
    const contact = await http(up.method, up.path, up.body);
    const pd = await run("Prepare deal", contact);
    const deal = await http("POST", "/crm/v3/objects/deals", pd.body);
    const pt = await run("Prepare task + alert", deal);
    const task = await http("POST", "/crm/v3/objects/tasks", pt.body);
    return { v, up, pt, task, run };
  }

  it("rejects a wrong token and an invalid lead", async () => {
    expect((await runFlow(web, { "x-webhook-token": "x" }, {})).rejected).toMatchObject({ status: 401 });
    expect((await runFlow({ name: "A" }, { "x-webhook-token": "hook-secret" }, {})).rejected).toMatchObject({ status: 422, errors: ["email is required"] });
  });

  it("creates contact, deal and task like the TypeScript service, then updates on a returning lead", async () => {
    const state = {};
    const r = await runFlow(web, { "x-webhook-token": "hook-secret" }, state);
    expect(r.v.score.score).toBe(90);
    expect(r.up.method).toBe("POST");
    expect(hs.db.contacts.size).toBe(1);
    expect([...hs.db.contacts.values()][0].properties).toMatchObject({ email: "dana.levi@acme-logistics.co.il", hubspot_owner_id: "1001", demo_lead_score: "90" });
    expect((hs.db.tasks.get(r.task.id)!.associations as any[]).map((a) => a.types[0].associationTypeId)).toEqual([204, 216]);
    expect(r.pt.slack.text).toContain("New hot lead: Dana Levi");

    expect((await runFlow(web, { "x-webhook-token": "hook-secret" }, state)).rejected).toMatchObject({ errors: ["duplicate_submission"] });
    const again = await runFlow({ ...web, submissionId: "web-0002" }, { "x-webhook-token": "hook-secret" }, state);
    expect(again.up.method).toBe("PATCH");
    expect(hs.db.contacts.size).toBe(1);
    expect(hs.db.deals.size).toBe(2);
  });

  it("dead-letter node stores the payload and builds an error alert", async () => {
    const state: any = {};
    const r = await runFlow(web, { "x-webhook-token": "hook-secret" }, state);
    const dl = await r.run!("Dead-letter + error alert", { error: { message: "HTTP 500 from HubSpot" } });
    expect(state.dlq).toHaveLength(1);
    expect(state.dlq[0].payload).toEqual(web);
    expect(dl.slack.text).toContain("Lead automation failed for dana.levi@acme-logistics.co.il");
  });
});

describe("Code by Zapier steps against the mock HubSpot API", () => {
  const step = (f: string) => readFileSync(`zapier/dist/${f}`, "utf8");
  const runZap = async (f: string, inputData: Record<string, string>) =>
    new AsyncFunction("inputData", `let output;\n${step(f)}`)(inputData);

  it("step 1 validates, scores and routes with flat string outputs", async () => {
    const out = await runZap("step1_validate.js", { raw_json: JSON.stringify(web) });
    expect(out).toMatchObject({ ok: "true", email: "dana.levi@acme-logistics.co.il", tier: "hot", score: 90, owner_id: "1001" });
    expect(await runZap("step1_validate.js", { email: "bad" })).toMatchObject({ ok: "false" });
  });

  it("step 2 syncs to HubSpot and retries a 429", async () => {
    const s1 = await runZap("step1_validate.js", { raw_json: JSON.stringify(web) });
    hs.fail("POST /crm/v3/objects/contacts/search", { status: 429, retryAfter: "0" });
    const out = await runZap("step2_hubspot_sync.js", { lead_json: s1.lead_json, score_json: s1.score_json, owner_json: s1.owner_json,
      hubspot_token: "test-token", hubspot_base_url: hs.url, score_property: "demo_lead_score", retry_base_ms: "1" });
    expect(out).toMatchObject({ contact_created: "true" });
    expect(hs.db.deals.get(out.deal_id)).toBeDefined();
    expect(hs.db.tasks.get(out.task_id)).toBeDefined();
    expect(out.slack_text).toContain("New hot lead");
    expect(hs.calls.filter((c) => c.path.endsWith("/search"))).toHaveLength(2);
  });

  it("step 2 throws (so Zapier marks the run as errored) on a non-retryable 4xx", async () => {
    const s1 = await runZap("step1_validate.js", { raw_json: JSON.stringify(web) });
    await expect(runZap("step2_hubspot_sync.js", { ...s1, hubspot_token: "wrong", hubspot_base_url: hs.url })).rejects.toThrow(/HTTP 401/);
  });
});
