/** Sends the sample lead through the real HTTP service into the mock HubSpot API and prints before/after. */
import type { AddressInfo } from "node:net";
import { readFileSync } from "node:fs";
import { createApp } from "../src/app.js";
import { DeadLetterQueue } from "../src/dlq.js";
import { startMockHubSpot } from "../tests/mock-hubspot.js";

const c = { dim: "\x1b[2m", cyan: "\x1b[36m", yellow: "\x1b[33m", bold: "\x1b[1m", r: "\x1b[0m" };
const hs = await startMockHubSpot();
const { server } = createApp({
  port: 0, webhookToken: "demo", adminToken: "demo", hubspotBaseUrl: hs.url, hubspotToken: "test-token", scoreProperty: "demo_lead_score",
  defaultCallingCode: "972", slackWebhookUrl: `${hs.url}/slack`, retryMaxAttempts: 4, retryBaseMs: 50,
}, { dlq: new DeadLetterQueue() });
await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

const web = JSON.parse(readFileSync("samples/web-form.json", "utf8"));
console.log(`${c.bold}BEFORE${c.r} ${c.dim}(raw web-form submission)${c.r}`);
console.log(JSON.stringify(web, null, 2));
hs.fail("POST /crm/v3/objects/contacts/search", { status: 429, retryAfter: "0" }); // show a retry
const res = await (await fetch(`${base}/webhooks/lead`, { method: "POST", headers: { "Content-Type": "application/json", "X-Webhook-Token": "demo" }, body: JSON.stringify(web) })).json();
if (res.status !== "processed") { console.error("demo failed", res); process.exit(1); }

console.log(`\n${c.bold}AFTER${c.r} ${c.dim}(records in the mock HubSpot CRM)${c.r}`);
const contact = hs.db.contacts.get(res.contactId)!, deal = hs.db.deals.get(res.dealId)!, task = hs.db.tasks.get(res.taskId)!;
const strip = (p: Record<string, unknown>) => Object.fromEntries(Object.entries(p).filter(([k]) => !["hs_object_id", "createdate"].includes(k)));
console.log(`${c.cyan}contact ${contact.id}${c.r}`, JSON.stringify(strip(contact.properties), null, 2));
console.log(`${c.cyan}deal ${deal.id}${c.r}`, JSON.stringify(strip(deal.properties)), `${c.dim}-> contact (assoc 3)${c.r}`);
console.log(`${c.cyan}task ${task.id}${c.r}`, JSON.stringify(strip(task.properties), null, 2), `${c.dim}-> contact (204), deal (216)${c.r}`);
console.log(`${c.yellow}slack${c.r}  ${hs.slack[0].text}`);
console.log(`\n${c.bold}HubSpot calls${c.r}`);
for (const call of hs.calls.filter((x) => x.path.startsWith("/crm"))) console.log(`  ${call.method.padEnd(5)} ${call.path}`);
console.log(`${c.dim}  (first search returned 429 and was retried)${c.r}`);
server.close(); await hs.close();
