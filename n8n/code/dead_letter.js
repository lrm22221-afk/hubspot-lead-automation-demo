// n8n Code node "Dead-letter + error alert": runs from the error output of any HubSpot HTTP node.
const state = $getWorkflowStaticData('global');
state.dlq = state.dlq || [];
const ctx = $('Validate, score & route').first().json;
const err = $input.first().json.error || $input.first().json;
const item = { id: `dlq_${Date.now()}`, at: new Date().toISOString(), step: $input.first().json.step || 'hubspot', error: typeof err === 'string' ? err : (err.message || JSON.stringify(err)).slice(0, 500), payload: ctx.raw };
state.dlq.push(item);
if (ctx.lead && ctx.lead.submissionId && state.seen) delete state.seen[ctx.lead.submissionId];
return [{ json: { dlqId: item.id, slack: { text: `:rotating_light: Lead automation failed for ${ctx.lead ? ctx.lead.email : 'unknown'}: ${item.error}. Saved to dead-letter queue as ${item.id}.` } } }];
