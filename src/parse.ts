/** Parses JSON, application/x-www-form-urlencoded, and multipart/form-data (text fields only, as Jotform sends). */
export function parseBody(raw: Buffer, contentType = ""): Record<string, unknown> {
  const ct = contentType.toLowerCase();
  if (ct.includes("application/json")) return JSON.parse(raw.toString("utf8") || "{}");
  if (ct.includes("application/x-www-form-urlencoded")) return Object.fromEntries(new URLSearchParams(raw.toString("utf8")));
  if (ct.includes("multipart/form-data")) {
    const boundary = /boundary="?([^";]+)"?/i.exec(contentType)?.[1];
    if (!boundary) throw new Error("multipart boundary missing");
    const out: Record<string, string> = {};
    for (const part of raw.toString("utf8").split(`--${boundary}`)) {
      const m = /^\r?\n([\s\S]*?)\r?\n\r?\n([\s\S]*?)\r?\n?$/.exec(part);
      if (!m) continue;
      const name = /name="([^"]+)"/i.exec(m[1])?.[1];
      if (name && !/filename="/i.test(m[1])) out[name] = m[2];
    }
    return out;
  }
  throw new Error(`unsupported content-type: ${contentType || "(none)"}`);
}
