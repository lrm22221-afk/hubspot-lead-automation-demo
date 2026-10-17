// n8n Code node "Prepare deal".
/*__LEAD_CORE__*/
const RULES = /*__RULES__*/;
const ctx = $('Validate, score & route').first().json;
const up = $('Prepare contact upsert').first().json;
const contactId = $input.first().json.id;
return [{ json: { contactId, body: LeadCore.dealBody(ctx.lead, ctx.score, up.ownerId, contactId, RULES) } }];
