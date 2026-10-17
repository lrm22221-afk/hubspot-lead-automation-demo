import { createServer, type Server } from "node:http";
import { readFileSync } from "node:fs";
import { timingSafeEqual } from "node:crypto";
import type { Config } from "./config.js";
import type { Rules } from "./core.js";
import { HubSpot } from "./hubspot.js";
import { Alerts } from "./alerts.js";
import { DeadLetterQueue } from "./dlq.js";
import { LeadPipeline } from "./pipeline.js";
import { parseBody } from "./parse.js";
import type { RetryOptions } from "./http.js";

export function loadRules(file?: string): Rules {
  return JSON.parse(readFileSync(file ?? new URL("../rules/rules.json", import.meta.url), "utf8"));
}

const safeEq = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

export function createApp(cfg: Config, opts: { sleep?: RetryOptions["sleep"]; now?: () => number; log?: (...a: unknown[]) => void; dlq?: DeadLetterQueue } = {}) {
  const log = opts.log ?? (() => {});
  const retry: RetryOptions = { maxAttempts: cfg.retryMaxAttempts, baseMs: cfg.retryBaseMs, sleep: opts.sleep, onRetry: (i) => log("retry", i) };
  const dlq = opts.dlq ?? new DeadLetterQueue(cfg.dlqFile);
  const pipeline = new LeadPipeline({
    hubspot: new HubSpot(cfg.hubspotBaseUrl, cfg.hubspotToken, retry),
    alerts: new Alerts(cfg.slackWebhookUrl, cfg.emailWebhookUrl, cfg.alertEmailTo, retry),
    dlq, rules: loadRules(cfg.rulesFile), defaultCallingCode: cfg.defaultCallingCode, scoreProperty: cfg.scoreProperty, now: opts.now, log,
  });

  const server: Server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", async () => {
      const send = (code: number, data: unknown) => { res.writeHead(code, { "Content-Type": "application/json" }); res.end(JSON.stringify(data)); };
      try {
        const url = new URL(req.url ?? "/", "http://localhost");
        if (url.pathname === "/health") return send(200, { ok: true });
        if (url.pathname === "/webhooks/lead" && req.method === "POST") {
          // Jotform and most form tools can't sign requests, so a shared secret in a header or query string is used.
          const token = String(req.headers["x-webhook-token"] ?? url.searchParams.get("token") ?? "");
          if (!safeEq(token, cfg.webhookToken)) return send(401, { error: "invalid token" });
          let body: Record<string, unknown>;
          try { body = parseBody(Buffer.concat(chunks), req.headers["content-type"]); } catch (e) { return send(400, { error: (e as Error).message }); }
          const r = await pipeline.process(body);
          const code = r.status === "invalid" ? 422 : r.status === "dead_lettered" ? 202 : 200;
          return send(code, { status: r.status, errors: r.errors, contactId: r.contactId, contactCreated: r.contactCreated, dealId: r.dealId, taskId: r.taskId,
                              score: r.score?.score, tier: r.score?.tier, owner: r.owner?.ownerName, dlqId: r.dlqId });
        }
        if (url.pathname.startsWith("/admin/")) {
          if (!safeEq(String(req.headers.authorization ?? ""), `Bearer ${cfg.adminToken}`)) return send(401, { error: "unauthorized" });
          if (url.pathname === "/admin/dlq" && req.method === "GET") return send(200, dlq.list());
          if (url.pathname === "/admin/dlq/replay" && req.method === "POST") {
            const results = await pipeline.replayDeadLetters();
            return send(200, results.map((r) => ({ status: r.status, email: r.lead?.email, contactId: r.contactId, dealId: r.dealId, dlqId: r.dlqId })));
          }
        }
        send(404, { error: "not found" });
      } catch (e) { log("unhandled", e); send(500, { error: "internal error" }); }
    });
  });
  return { server, pipeline, dlq };
}
