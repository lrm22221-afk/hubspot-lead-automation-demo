// n8n Code node "Prepare contact upsert": decide PATCH (existing by email/phone) or POST (new).
/*__LEAD_CORE__*/
const ctx = $('Validate, score & route').first().json;
const found = $input.first().json.results || [];
const existing = found.find((r) => (r.properties.email || '').toLowerCase() === ctx.lead.email) || found[0];
const ownerId = (existing && existing.properties.hubspot_owner_id) || ctx.owner.ownerId;
const props = LeadCore.contactProperties(ctx.lead, ctx.score, ctx.owner, $env.HUBSPOT_SCORE_PROPERTY || undefined, existing && existing.properties.hubspot_owner_id);
if (existing) {
  delete props.lifecyclestage; delete props.hs_lead_status;
  if (existing.properties.email) delete props.email;
}
return [{ json: {
  method: existing ? 'PATCH' : 'POST',
  path: existing ? `/crm/v3/objects/contacts/${existing.id}` : '/crm/v3/objects/contacts',
  isNew: !existing, ownerId, body: { properties: props },
} }];
