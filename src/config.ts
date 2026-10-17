export interface Config {
  port: number; webhookToken: string; adminToken: string;
  hubspotBaseUrl: string; hubspotToken: string; scoreProperty?: string; defaultCallingCode: string;
  slackWebhookUrl?: string; emailWebhookUrl?: string; alertEmailTo?: string;
  retryMaxAttempts: number; retryBaseMs: number; dlqFile?: string; rulesFile?: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const req = (n: string) => { const v = env[n]; if (!v) throw new Error(`Missing required env var ${n} (see .env.example)`); return v; };
  return {
    port: Number(env.PORT ?? 3000),
    webhookToken: req("WEBHOOK_TOKEN"),
    adminToken: req("ADMIN_TOKEN"),
    hubspotBaseUrl: (env.HUBSPOT_BASE_URL ?? "https://api.hubapi.com").replace(/\/+$/, ""),
    hubspotToken: req("HUBSPOT_PRIVATE_APP_TOKEN"),
    scoreProperty: env.HUBSPOT_SCORE_PROPERTY || undefined,
    defaultCallingCode: env.DEFAULT_CALLING_CODE ?? "972",
    slackWebhookUrl: env.SLACK_WEBHOOK_URL || undefined,
    emailWebhookUrl: env.EMAIL_WEBHOOK_URL || undefined,
    alertEmailTo: env.ALERT_EMAIL_TO || undefined,
    retryMaxAttempts: Number(env.RETRY_MAX_ATTEMPTS ?? 5),
    retryBaseMs: Number(env.RETRY_BASE_MS ?? 500),
    dlqFile: env.DLQ_FILE ?? "data/dead-letter.jsonl",
    rulesFile: env.RULES_FILE || undefined,
  };
}
