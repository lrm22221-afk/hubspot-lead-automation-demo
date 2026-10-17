// n8n Code node "Prepare task + alert".
/*__LEAD_CORE__*/
const ctx = $('Validate, score & route').first().json;
const up = $('Prepare contact upsert').first().json;
const contactId = $('Prepare deal').first().json.contactId;
const dealId = $input.first().json.id;
const owner = { ...ctx.owner, ownerId: up.ownerId, ownerName: up.ownerId === ctx.owner.ownerId ? ctx.owner.ownerName : `existing owner ${up.ownerId}` };
return [{ json: {
  contactId, dealId,
  body: LeadCore.taskBody(ctx.lead, ctx.score, up.ownerId, contactId, dealId, Date.now()),
  slack: LeadCore.slackMessage(ctx.lead, ctx.score, owner, contactId, dealId, up.isNew),
} }];
