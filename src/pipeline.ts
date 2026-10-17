import {
  contactProperties, contactSearchBody, dealBody, routeOwner, scoreLead, slackMessage, taskBody, validate,
  type Lead, type Owner, type RawLead, type Rules, type Score,
} from "./core.js";
import type { HubSpot } from "./hubspot.js";
import type { Alerts } from "./alerts.js";
import type { DeadLetterQueue } from "./dlq.js";
import { HttpError } from "./http.js";

export interface PipelineResult {
  status: "processed" | "duplicate_submission" | "invalid" | "dead_lettered";
  errors?: string[];
  lead?: Lead; score?: Score; owner?: Owner;
  contactId?: string; contactCreated?: boolean; dealId?: string; taskId?: string; dlqId?: string;
}

export interface PipelineDeps {
  hubspot: HubSpot; alerts: Alerts; dlq: DeadLetterQueue; rules: Rules;
  defaultCallingCode?: string; scoreProperty?: string; now?: () => number; log?: (...a: unknown[]) => void;
}

/** Processes one lead through: validate -> dedupe -> upsert -> score/route -> deal -> task -> alert. */
export class LeadPipeline {
  private seenSubmissions = new Set<string>();
  private rr = 0;
  constructor(private d: PipelineDeps) {}

  async process(raw: RawLead): Promise<PipelineResult> {
    const { rules, hubspot, alerts, dlq } = this.d;
    const now = this.d.now ?? Date.now;
    const log = this.d.log ?? (() => {});

    const v = validate(raw, rules, this.d.defaultCallingCode);
    if (!v.ok) return { status: "invalid", errors: v.errors };
    const lead = v.lead!;
    if (lead.submissionId) {
      if (this.seenSubmissions.has(lead.submissionId)) return { status: "duplicate_submission", lead };
      this.seenSubmissions.add(lead.submissionId);
    }
    const score = scoreLead(lead, rules);
    let step = "search_contact";
    try {
      const found = await hubspot.searchContacts(contactSearchBody(lead));
      // Prefer the email match over a phone-only match.
      const existing = found.results.find((r) => r.properties.email?.toLowerCase() === lead.email) ?? found.results[0];
      const owner: Owner = existing?.properties.hubspot_owner_id
        ? { ownerId: existing.properties.hubspot_owner_id, ownerName: `existing owner ${existing.properties.hubspot_owner_id}`, rule: "existing_owner" }
        : routeOwner(lead, rules, this.rr++);
      const props = contactProperties(lead, score, owner, this.d.scoreProperty, existing?.properties.hubspot_owner_id ?? undefined);
      let contactId: string;
      if (existing) {
        step = "update_contact";
        // Don't overwrite an existing primary email found via phone match, and don't move lifecycle backwards.
        const { email: _e, lifecyclestage: _l, hs_lead_status: _s, ...rest } = props;
        contactId = (await hubspot.updateContact(existing.id, existing.properties.email ? rest : { ...rest, email: lead.email })).id;
      } else {
        step = "create_contact";
        contactId = (await hubspot.createContact(props)).id;
      }
      step = "create_deal";
      const dealId = (await hubspot.createDeal(dealBody(lead, score, owner.ownerId, contactId, rules))).id;
      step = "create_task";
      const taskId = (await hubspot.createTask(taskBody(lead, score, owner.ownerId, contactId, dealId, now()))).id;
      step = "alert";
      try { await alerts.send(slackMessage(lead, score, owner, contactId, dealId, !existing).text, `New ${score.tier} lead: ${lead.email}`); }
      catch (e) { log("alert failed (lead already in CRM, not dead-lettered)", (e as Error).message); }
      return { status: "processed", lead, score, owner, contactId, contactCreated: !existing, dealId, taskId };
    } catch (e) {
      const err = e as Error;
      const item = dlq.push({ step, error: err.message, status: e instanceof HttpError ? e.status : undefined, payload: raw });
      if (lead.submissionId) this.seenSubmissions.delete(lead.submissionId); // allow replay
      try { await alerts.send(`:rotating_light: Lead automation failed at ${step} for ${lead.email}: ${err.message}. Saved to dead-letter queue as ${item.id}.`, `Lead automation error (${step})`); }
      catch (e2) { log("error alert failed", (e2 as Error).message); }
      return { status: "dead_lettered", lead, score, dlqId: item.id, errors: [`${step}: ${err.message}`] };
    }
  }

  async replayDeadLetters(): Promise<PipelineResult[]> {
    const out: PipelineResult[] = [];
    for (const item of this.d.dlq.drain()) out.push(await this.process(item.payload as RawLead));
    return out;
  }
}
