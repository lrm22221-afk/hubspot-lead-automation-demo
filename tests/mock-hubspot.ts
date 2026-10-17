import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

type Obj = { id: string; properties: Record<string, string | null>; associations?: unknown; createdAt: string; updatedAt: string; archived: false };
export interface MockCall { method: string; path: string; body: any; auth?: string }

/**
 * Local stand-in for api.hubapi.com (CRM v3 contacts/deals/tasks + search) and for Slack/email webhooks.
 * Response shapes follow HubSpot's documented examples; this is not a full emulation.
 */
export async function startMockHubSpot(token = "test-token") {
  const db = { contacts: new Map<string, Obj>(), deals: new Map<string, Obj>(), tasks: new Map<string, Obj>() };
  const calls: MockCall[] = [];
  const slack: any[] = [];
  const email: any[] = [];
  /** Queue of forced failures: route key like "POST /crm/v3/objects/deals" -> list of {status, retryAfter}. */
  const failures = new Map<string, { status: number; retryAfter?: string }[]>();
  let seq = 100;

  const mk = (properties: Record<string, string>, associations?: unknown): Obj => {
    const t = new Date().toISOString();
    const id = String(++seq);
    return { id, properties: { ...properties, hs_object_id: id, createdate: t }, associations, createdAt: t, updatedAt: t, archived: false };
  };

  const server: Server = createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      const path = (req.url ?? "").split("?")[0];
      const body = raw ? JSON.parse(raw) : undefined;
      calls.push({ method: req.method ?? "", path, body, auth: req.headers.authorization });
      const send = (code: number, data?: unknown, headers: Record<string, string> = {}) => {
        res.writeHead(code, { "Content-Type": "application/json", ...headers }); res.end(data === undefined ? "" : JSON.stringify(data));
      };
      const routeKey = `${req.method} ${path.replace(/\/\d+$/, "/{id}")}`;
      const f = failures.get(routeKey)?.shift();
      if (f) return send(f.status, { status: "error", message: `mock ${f.status}`, category: f.status === 429 ? "RATE_LIMITS" : "INTERNAL_ERROR" }, f.retryAfter ? { "Retry-After": f.retryAfter } : {});
      if (path === "/slack") { slack.push(body); return send(200, "ok"); }
      if (path === "/email") { email.push(body); return send(202, { queued: true }); }
      if (req.headers.authorization !== `Bearer ${token}`) return send(401, { status: "error", category: "INVALID_AUTHENTICATION", message: "Authentication credentials not found." });

      let m: RegExpMatchArray | null;
      if (req.method === "POST" && path === "/crm/v3/objects/contacts/search") {
        const results = [...db.contacts.values()].filter((c) =>
          (body.filterGroups ?? []).some((g: any) => g.filters.every((fl: any) => fl.operator === "EQ" && String(c.properties[fl.propertyName] ?? "").toLowerCase() === String(fl.value).toLowerCase())));
        return send(200, { total: results.length, results: results.slice(0, body.limit ?? 10) });
      }
      if ((m = path.match(/^\/crm\/v3\/objects\/(contacts|deals|tasks)$/)) && req.method === "POST") {
        const store = db[m[1] as keyof typeof db];
        if (m[1] === "contacts" && [...store.values()].some((c) => c.properties.email === body.properties.email))
          return send(409, { status: "error", category: "CONFLICT", message: "Contact already exists." });
        if (m[1] === "tasks" && !body.properties.hs_timestamp) return send(400, { status: "error", category: "VALIDATION_ERROR", message: "hs_timestamp is required" });
        const o = mk(body.properties, body.associations);
        store.set(o.id, o);
        return send(201, o);
      }
      if ((m = path.match(/^\/crm\/v3\/objects\/contacts\/(\d+)$/)) && req.method === "PATCH") {
        const c = db.contacts.get(m[1]);
        if (!c) return send(404, { status: "error", category: "OBJECT_NOT_FOUND" });
        Object.assign(c.properties, body.properties); c.updatedAt = new Date().toISOString();
        return send(200, c);
      }
      send(404, { status: "error", message: `mock: no route ${req.method} ${path}` });
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    url, db, calls, slack, email, failures,
    fail: (route: string, ...list: { status: number; retryAfter?: string }[]) => failures.set(route, [...(failures.get(route) ?? []), ...list]),
    reset: () => { db.contacts.clear(); db.deals.clear(); db.tasks.clear(); calls.length = 0; slack.length = 0; email.length = 0; failures.clear(); },
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}
