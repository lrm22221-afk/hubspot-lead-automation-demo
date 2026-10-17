// Bundles src/core.ts + rules/rules.json into the n8n Code nodes and the Code by Zapier steps,
// so all three implementations share one tested source of truth. CI fails if the outputs are stale.
import { buildSync } from "esbuild";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

const core = buildSync({ entryPoints: ["src/core.ts"], bundle: true, format: "iife", globalName: "LeadCore", target: "es2019", write: false, minify: false, legalComments: "none" })
  .outputFiles[0].text.replace(/^"use strict";\n/, "").trim();
const rules = JSON.stringify(JSON.parse(readFileSync("rules/rules.json", "utf8")));
const fill = (file) => readFileSync(file, "utf8").replace("/*__LEAD_CORE__*/", `// --- bundled from src/core.ts (do not edit here) ---\n${core}\n// --- end bundle ---`).replace("/*__RULES__*/", rules);

// ---------- n8n ----------
const code = (f) => fill(`n8n/code/${f}`);
const env = (n) => `$env.${n}`;
const httpNode = (id, name, pos, method, pathExpr, bodyExpr) => ({
  id, name, type: "n8n-nodes-base.httpRequest", typeVersion: 4.2, position: pos,
  retryOnFail: true, maxTries: 5, waitBetweenTries: 2000, onError: "continueErrorOutput",
  parameters: {
    method, url: `={{ (${env("HUBSPOT_BASE_URL")} || 'https://api.hubapi.com') + ${pathExpr} }}`,
    sendHeaders: true, headerParameters: { parameters: [{ name: "Authorization", value: `=Bearer {{ ${env("HUBSPOT_PRIVATE_APP_TOKEN")} }}` }] },
    sendBody: true, specifyBody: "json", jsonBody: `={{ JSON.stringify(${bodyExpr}) }}`, options: {},
  },
});
const codeNode = (id, name, pos, file) => ({ id, name, type: "n8n-nodes-base.code", typeVersion: 2, position: pos, parameters: { jsCode: code(file) } });
const respond = (id, name, pos, codeExpr, bodyExpr) => ({ id, name, type: "n8n-nodes-base.respondToWebhook", typeVersion: 1.1, position: pos,
  parameters: { respondWith: "json", responseBody: `={{ JSON.stringify(${bodyExpr}) }}`, options: { responseCode: codeExpr } } });
const slack = (id, name, pos, bodyExpr) => ({ id, name, type: "n8n-nodes-base.httpRequest", typeVersion: 4.2, position: pos, retryOnFail: true, maxTries: 3, waitBetweenTries: 2000, onError: "continueRegularOutput",
  parameters: { method: "POST", url: `={{ ${env("SLACK_WEBHOOK_URL")} }}`, sendBody: true, specifyBody: "json", jsonBody: `={{ JSON.stringify(${bodyExpr}) }}`, options: {} } });

const wf = {
  name: "HubSpot lead automation (demo)",
  nodes: [
    { id: "1", name: "Lead webhook", type: "n8n-nodes-base.webhook", typeVersion: 2, position: [0, 200], parameters: { httpMethod: "POST", path: "lead", responseMode: "responseNode", options: {} } },
    codeNode("2", "Validate, score & route", [220, 200], "validate.js"),
    { id: "3", name: "Valid?", type: "n8n-nodes-base.if", typeVersion: 2, position: [440, 200], parameters: {
      conditions: { options: { caseSensitive: true, typeValidation: "strict" }, combinator: "and",
        conditions: [{ id: "c1", leftValue: "={{ $json.ok }}", rightValue: true, operator: { type: "boolean", operation: "true", singleValue: true } }] }, options: {} } },
    respond("4", "Respond rejected", [660, 420], "={{ $json.status }}", "{ ok: false, errors: $json.errors }"),
    httpNode("5", "Search contact", [660, 180], "POST", "'/crm/v3/objects/contacts/search'", "$json.searchBody"),
    codeNode("6", "Prepare contact upsert", [880, 160], "prepare_contact.js"),
    httpNode("7", "Upsert contact", [1100, 160], "={{ $json.method }}", "$json.path", "$json.body"),
    codeNode("8", "Prepare deal", [1320, 140], "prepare_deal.js"),
    httpNode("9", "Create deal", [1540, 140], "POST", "'/crm/v3/objects/deals'", "$json.body"),
    codeNode("10", "Prepare task + alert", [1760, 120], "prepare_task.js"),
    httpNode("11", "Create task", [1980, 120], "POST", "'/crm/v3/objects/tasks'", "$json.body"),
    slack("12", "Slack alert", [2200, 100], "$('Prepare task + alert').first().json.slack"),
    respond("13", "Respond processed", [2420, 100], 200, "{ ok: true, contactId: $('Prepare task + alert').first().json.contactId, dealId: $('Prepare task + alert').first().json.dealId }"),
    codeNode("14", "Dead-letter + error alert", [1320, 520], "dead_letter.js"),
    slack("15", "Slack error alert", [1540, 520], "$json.slack"),
    respond("16", "Respond dead-lettered", [1760, 520], 202, "{ ok: false, dlqId: $('Dead-letter + error alert').first().json.dlqId }"),
  ],
  connections: {
    "Lead webhook": { main: [[{ node: "Validate, score & route", type: "main", index: 0 }]] },
    "Validate, score & route": { main: [[{ node: "Valid?", type: "main", index: 0 }]] },
    "Valid?": { main: [[{ node: "Search contact", type: "main", index: 0 }], [{ node: "Respond rejected", type: "main", index: 0 }]] },
    "Search contact": { main: [[{ node: "Prepare contact upsert", type: "main", index: 0 }], [{ node: "Dead-letter + error alert", type: "main", index: 0 }]] },
    "Prepare contact upsert": { main: [[{ node: "Upsert contact", type: "main", index: 0 }]] },
    "Upsert contact": { main: [[{ node: "Prepare deal", type: "main", index: 0 }], [{ node: "Dead-letter + error alert", type: "main", index: 0 }]] },
    "Prepare deal": { main: [[{ node: "Create deal", type: "main", index: 0 }]] },
    "Create deal": { main: [[{ node: "Prepare task + alert", type: "main", index: 0 }], [{ node: "Dead-letter + error alert", type: "main", index: 0 }]] },
    "Prepare task + alert": { main: [[{ node: "Create task", type: "main", index: 0 }]] },
    "Create task": { main: [[{ node: "Slack alert", type: "main", index: 0 }], [{ node: "Dead-letter + error alert", type: "main", index: 0 }]] },
    "Slack alert": { main: [[{ node: "Respond processed", type: "main", index: 0 }]] },
    "Dead-letter + error alert": { main: [[{ node: "Slack error alert", type: "main", index: 0 }]] },
    "Slack error alert": { main: [[{ node: "Respond dead-lettered", type: "main", index: 0 }]] },
  },
  settings: { executionOrder: "v1" },
  pinData: {},
};
writeFileSync("n8n/hubspot_lead_workflow.json", JSON.stringify(wf, null, 2) + "\n");

// ---------- Zapier ----------
mkdirSync("zapier/dist", { recursive: true });
for (const f of ["step1_validate.js", "step2_hubspot_sync.js"]) writeFileSync(`zapier/dist/${f}`, fill(`zapier/code/${f}`));
console.log("built n8n/hubspot_lead_workflow.json and zapier/dist/*.js");
