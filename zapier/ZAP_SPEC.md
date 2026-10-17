# Zapier version (Code by Zapier)

> **Untested on live Zapier.** The two Code steps in `zapier/dist/` are executed in CI against the mock HubSpot API
> with a stand-in for Zapier's `inputData`/`output` runtime (`tests/nocode.test.ts`). The Zap itself has not been built
> or run in a Zapier account. A Make (Integromat) blueprint is **not** included.

The code in `zapier/dist/*.js` is generated from `src/core.ts` + `rules/rules.json` by `npm run build:nocode`.
Paste the whole file into each Code step.

## Zap steps

1. **Trigger**: *Webhooks by Zapier → Catch Hook* (send your form here), or *Jotform → New Submission*.
2. **Action**: *Code by Zapier → Run JavaScript*, named "Validate, score & route".
   - Input Data: `raw_json` = the whole payload as JSON if your trigger exposes it, **or** map fields one by one:
     `email`, `first_name`, `last_name` (or `name`), `phone`, `company`, `job_title`, `country`, `budget`, `timeline`,
     `message`, `source`, `submission_id`.
   - Code: paste `zapier/dist/step1_validate.js`.
3. **Filter by Zapier**: only continue if `ok` (from step 2) *(Text) Exactly matches* `true`.
4. **Action**: *Code by Zapier → Run JavaScript*, named "HubSpot sync".
   - Input Data: `lead_json`, `score_json`, `owner_json` from step 2; `hubspot_token` = your private-app token;
     optional `score_property`.
   - Code: paste `zapier/dist/step2_hubspot_sync.js`.
   - It searches by email OR phone, PATCHes or creates the contact, creates the deal and task, retries 429/5xx (3 tries)
     and **throws** on failure so the Zap run shows as errored.
5. **Action**: *Slack → Send Channel Message*, message = `slack_text` from step 4. (Or *Email by Zapier*.)
6. **Error handling**: turn on *Autoreplay* (paid plans) and Zap error notifications in Zapier settings; optionally add an
   error-handler step that posts the failed payload to a Slack channel or a Google Sheet as the dead-letter list.

## Differences from the TypeScript service

- Round-robin uses a stable hash of the email (Zapier has no shared counter without Storage).
- Submission-id dedupe is left to Zapier's own trigger dedupe; contact dedupe (email/phone search) is the same.
- Code steps have a runtime limit that depends on your plan, so in-step retries are capped at 3 tries and 4 s per wait.
- Putting a token in Input Data stores it in the Zap configuration; for production, prefer the built-in HubSpot app steps
  or a secret store.
