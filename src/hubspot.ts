import { requestJson, type RetryOptions } from "./http.js";

/** Thin client for the HubSpot CRM v3 object endpoints used by this flow. */
export class HubSpot {
  constructor(private baseUrl: string, private token: string, private retry: RetryOptions, private fetchImpl: typeof fetch = fetch) {}

  private call<T>(method: string, path: string, body?: unknown): Promise<T> {
    return requestJson<T>(`${this.baseUrl}${path}`, {
      method,
      headers: { Authorization: `Bearer ${this.token}`, "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    }, this.retry, this.fetchImpl);
  }

  searchContacts(body: unknown) { return this.call<{ total: number; results: { id: string; properties: Record<string, string | null> }[] }>("POST", "/crm/v3/objects/contacts/search", body); }
  createContact(properties: Record<string, string>) { return this.call<{ id: string }>("POST", "/crm/v3/objects/contacts", { properties }); }
  updateContact(id: string, properties: Record<string, string>) { return this.call<{ id: string }>("PATCH", `/crm/v3/objects/contacts/${encodeURIComponent(id)}`, { properties }); }
  createDeal(body: unknown) { return this.call<{ id: string }>("POST", "/crm/v3/objects/deals", body); }
  createTask(body: unknown) { return this.call<{ id: string }>("POST", "/crm/v3/objects/tasks", body); }
}
