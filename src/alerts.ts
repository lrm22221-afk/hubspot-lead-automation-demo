import { requestJson, type RetryOptions } from "./http.js";

/** Slack incoming webhook + optional generic email webhook (e.g. a Make/Zapier/SendGrid relay). Both optional. */
export class Alerts {
  constructor(private slackUrl: string | undefined, private emailUrl: string | undefined, private emailTo: string | undefined,
              private retry: RetryOptions, private fetchImpl: typeof fetch = fetch) {}

  async send(text: string, subject: string): Promise<void> {
    const jobs: Promise<unknown>[] = [];
    if (this.slackUrl) jobs.push(requestJson(this.slackUrl, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text }) }, this.retry, this.fetchImpl));
    if (this.emailUrl && this.emailTo) jobs.push(requestJson(this.emailUrl, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ to: this.emailTo, subject, text }) }, this.retry, this.fetchImpl));
    await Promise.all(jobs);
  }
}
