import { loadConfig } from "./config.js";
import { createApp } from "./app.js";

const cfg = loadConfig();
const { server } = createApp(cfg, { log: (...a) => console.log(new Date().toISOString(), ...a) });
server.listen(cfg.port, () => console.log(`Lead automation demo listening on :${cfg.port} (HubSpot: ${cfg.hubspotBaseUrl})`));
