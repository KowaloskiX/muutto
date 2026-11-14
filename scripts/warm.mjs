// Pre-populate the kilpailutus cache before the demo by running the demo queries live.
// Usage: node warm.mjs [baseUrl]   (default http://localhost:3000)
// Runs sequentially so Exa rate limits are never hit. Re-run within ~6 h of the demo
// (verification reports stay fresh for 6 h, Exa responses for 1 h; the 6 h report
// cache is what makes the demo instant).
const BASE = process.argv[2] ?? "http://localhost:3000";
const QUERIES = [
  // Must match what /chat sends: the welcome chip text + audience "b2b".
  "Ventilation (IV) subcontractor for a school renovation (perusparannus) in Katajanokka, Helsinki, about 400 000 €, start in spring",
  "Electrical subcontractor for a 40-apartment pipe renovation (linjasaneeraus) in Espoo, start March",
];

async function run(query) {
  const t0 = Date.now();
  const res = await fetch(`${BASE}/api/find`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ query, audience: "b2b" }) });
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
  const dec = new TextDecoder();
  let buf = "";
  let done, error, first;
  for await (const chunk of res.body) {
    buf += dec.decode(chunk, { stream: true });
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i);
      buf = buf.slice(i + 1);
      if (!line.trim()) continue;
      const e = JSON.parse(line);
      if (e.type === "company" && e.status === "done") first ??= Date.now() - t0;
      if (e.type === "done") done = e;
      if (e.type === "error") error = e.message;
    }
  }
  const ms = Date.now() - t0;
  if (error) return console.log(`✗ ${query} — ${error} (${ms} ms)`);
  const rows = (done?.ranked ?? []).map((r) => `${r.report.domain ?? r.report.name} ${r.fit}${r.report.cachedAt ? " (cached)" : ""}`);
  console.log(`✓ ${query} — first company ${first ?? "-"} ms, total ${ms} ms\n    ${rows.join(" | ")}`);
}

for (const q of QUERIES) {
  try {
    await run(q);
  } catch (e) {
    console.log(`✗ ${q} — ${e.message}`);
  }
}
