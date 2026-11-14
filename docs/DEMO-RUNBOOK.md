# Demo runbook

**Rule:** never present cached results as live. If a result came from the warm-up, say *"checked N minutes ago"*. The `/chat` candidate panel shows "checked N min ago" in its meta line; the classic view `/` also shows it in the Exa trace panel.

---

## T-6 h to T-30 min: pre-demo checklist

### 1. Keys and budget

- [ ] `.env.local` has `EXA_API_KEY` and `OPENAI_API_KEY`. Leave `KILP_CACHE` unset (cache on). Leave `EXA_CONNECT_FIBER` and `EXA_SNAPSHOT` unset (off).
- [ ] Exa dashboard: credits left for at least 10 fresh searches. One fresh shortlist of 4 is about 20+ Exa calls.
- [ ] OpenAI dashboard: key active, spend limit not reached.
- [ ] LLM daily cap not near the limit:
  ```bash
  cat "$(node -e 'console.log(require("os").tmpdir())')/kilpailutus-llm-usage.json"
  ```
  `input + output` must be well below `LLM_DAILY_TOKEN_CAP` (default 1,500,000). If it's close, raise the cap in `.env.local` and restart.
- [ ] Optional: start a tunnel and set `PUBLIC_BASE_URL=https://…` for live monitor webhooks. Without it, the watch card says monitors are checked on demand, which is fine for the demo.

### 2. Start the server

```bash
cd "/Users/lukasz/Code/Junction Hackathon/kilpailutus"
npm run build && npm start      # production build: faster and steadier than dev
# fallback: npm run dev
```

Open <http://localhost:3000/chat>. Clear the old conversation by typing *"start over"*, or clear the site's localStorage (key `kilpi-contractors-v1`).

### 3. Warm the cache (within 6 h of the demo)

Reports are served without re-checking for 6 h. Between 6 and 24 h they are shown at once and then re-checked live. After 24 h they are never served. Warm through the **UI** so the router rewrites the queries exactly as it will on stage:

1. Click the primary chip *"Ventilation subcontractor for a school renovation in Katajanokka, Helsinki, ~€400k"*. Wait for "fits best". Then do the same for the second chip, *"Electrical subcontractor for a 40-apartment pipe renovation in Espoo, start March"*, which is the backup case.
2. Type *"start over"*, then click the same chip again. It should finish in a few seconds with the same shortlist. If the shortlist differs, the router reworded the query. Run it once more and use the chip, not typed text, on stage.
3. Run each stress-test query below once, so the judge path is warm too.
4. Ask *"Which documents must I collect from a subcontractor?"* (third chip) and read the whole answer. It uses the errand agent, whose prompt is still worded for household hiring. If the answer is off-topic or declined, leave this chip out of the demo.

At the last live run (no cache, 27 s in total, first company after about 12 s), the Katajanokka ventilation query returned:

1. Saipu Oy (saipu.fi), fit 94: looks clear. Registered line is HVAC installation (Lämpö-, vesijohto- ja ilmastointiasennus).
2. Ilma-Ahti Oy, fit 79: clarify first. A real customer complaint about a delayed after-sales repair was found in reviews.
3. Helsingin ilmanvaihto Oy (h10.fi), fit 68: clarify first. The register data page (Asiakastieto, data from YTJ) lists the trade register, the Tax Administration basic register and VAT, but not the prepayment register or the employer register. This is the key demo moment: a firm without the employer register bidding for a €400,000 job. A model without Exa cannot know this, and Kilpi shows the source and the date.
4. Abcool Oy, fit 57: clarify first. Business ID not on their site, and the employer register is not listed.

Expect something like this, but don't promise it. Use whatever your run returns. The chip sends the exact text *"Ventilation (IV) subcontractor for a school renovation (perusparannus) in Katajanokka, Helsinki, about 400 000 €, start in spring"*.

At an earlier warm-up, the Espoo electrical backup shortlist was Systempoint Oy, Sähkö-Kamut Oy, Sähkö-Huhta Oy and Digisähkö Oy.

**Everything runs live by default** (`KILP_LIVE` unset): every click searches Exa, reads the registers and builds the reports fresh, about 30 s with the first company after 10–15 s. Only map geocodes are reused, and identical Exa calls are de-duplicated for 2 minutes inside one run. Rehearse once ~30 min before to catch network or key problems. Emergency backup only: start the server with `KILP_LIVE=0` to re-enable the replay cache (then `node scripts/warm.mjs` warms both chips) and say "checked N minutes ago" out loud.

### 4. Browser tabs (in this order)

1. `http://localhost:3000/chat`: the demo, warmed, conversation reset
2. `http://localhost:3000/classic`: classic view with the Exa trace panel, for "show me the Exa calls"
3. Työsuojeluhallinto guide PDF: <https://tyosuojelu.fi/documents/154017715/168016298/Tilaajavastuulaki_FI.pdf/e44a5af6-0128-457e-ab25-65c3bcd5b59e/Tilaajavastuulaki_FI.pdf>
4. Backup video, downloaded locally and open in a player
5. README on GitHub (architecture diagram)

Turn off notifications. Set browser zoom to 110–125%. Put the laptop on power.

---

## Demo queries (cached and stable)

| # | Exact input | Expected |
|---|---|---|
| 1 | Click primary chip: *Ventilation subcontractor for a school renovation in Katajanokka, Helsinki, ~€400k* | Notice that the Act applies (about €400,000 is well above €9,000). 4 candidates on the map. Ranking with fit scores and reasons, including "clarify first" candidates. |
| 1b | Backup: click second chip *Electrical subcontractor for a 40-apartment pipe renovation in Espoo, start March* | Notice that the Act applies (no value given: "€9,000 or more" note). 4 candidates on the map. Ranking with fit scores and reasons. |
| 2 | *tell me more about #1* | Detail card / checklist drawer: tilaajavastuu checks, references, capacity, reputation, documents to request |
| 3 | *request quotes from the top 2* | Two drafts in the outbox: RFQ + § 5 document request (FI/EN), "2 waiting for your OK" |
| 4 | *watch #1* | Watch card: daily Exa Monitor created (webhook live, or "checked on demand while running locally") |
| 5 | *Check subcontractor: Näsin Vesijohtoliike Oy* | Single-company report (checked in the last warm-up, Tampere plumbing) |

## Click path

1. `/chat` welcome → click the primary chip.
2. Watch the progress steps (Understand → Find → Verify → Rank) and the map pins appear.
3. Shortlist in the case file → click candidate #1 → the checklist drawer opens.
4. In the drawer: point at the green registry rows, the tax-debt row with its "Re-check in YTJ" link, and the grey "request" rows with `1233/2006 5 § n kohta`.
5. Click one evidence quote. A new tab jumps to the highlighted sentence on the source page. Come back.
6. Open the "clarify first" candidate whose register row lacks the employer register (Helsingin ilmanvaihto Oy, #3, at the last live run). Point at the source and the date.
7. Close the drawer → type *request quotes from the top 2* → show the outbox → hover "Approve and send" (don't click unless the mail app is ready).
8. Type *watch #1* → show the watch card.
9. If time allows: switch to `/classic` and open the Exa trace panel to show each call, its time, and "cached N min ago".

---

## Fallback plan

| Failure | What to do | What to say |
|---|---|---|
| Wi-Fi down | Phone hotspot. If that fails too, play the backup video. | "The network is down, so this is a recording of the same flow from earlier today." |
| Exa errors or 429s | Restart with `KILP_LIVE=0` and use only warmed queries (served from cache). Don't run new ones. | "These results were checked N minutes ago. The live Exa call is failing right now." |
| OpenAI down or LLM cap reached | `/api/find` falls back to a keyword parser. Use demo query 1 only. The router falls back to keywords. | "The model is unavailable, so we're on the keyword fallback. The checks themselves come from Exa and the registers." |
| Server crash | `npm start` again. The cache file survives restarts. Reload `/chat`, and the conversation is restored from localStorage. | Nothing special. |
| Everything fails | Play the 90-second video. | "This is a recording. Every result in it came from live API calls." |

Never edit or stage results. Never say "live" for a cached run.

### Register outage

Since 14.11.2026 at about 07:15, the PRH open-data API refuses connections. Kilpi then reads Exa's stored copy of the YTJ company page (or Asiakastieto's register page). Every check says which copy and which date it used, and has a "Re-check in YTJ" link. If a judge asks, say so plainly: "The PRH API is down today, so this register row comes from a stored copy of the YTJ page, dated here. You can re-check it in YTJ with this link."

---

## Judge stress tests: expected behaviour

| Judge input | Expected behaviour | Source in code |
|---|---|---|
| Out of scope: *"Book me a flight to Rome"*, *"write a poem"* | A short friendly reply saying Kilpi only helps vet construction subcontractors, plus two in-scope suggestion chips. No research. | `chat-route` `out_of_scope` |
| Fake business ID: *"Check subcontractor 1234567-8"* | Warning: "1234567-8" is not a valid Finnish business ID because the check digit fails. A valid ID starting 1234567 would end in -1. If a contractor gave you this number, treat it as a red flag. No register lookup with the bad ID. | `ytunnus.ts`, `find/route.ts` |
| Valid ID not in the open register | "Passes the checksum but is not in the open trade register (PRH/YTJ)… ask the contractor for an extract from the trade register." | `find/route.ts` |
| Company name: *"Check subcontractor: <any Finnish company Oy>"* | Looks up the name in PRH, finds the firm's own site (register first, then Exa), and runs the full checklist. If no site is found, it says so and the checks turn grey with documents to request. A fresh run is live and slower. | `resolveCompany`, `verifyCompany` |
| Company website: *"Check subcontractor: example-firm.fi"* | Looked up by bare domain. Business ID taken from the site footer or contact page. | `ChatApp` `check_company` |
| Other city: *"Plumbing subcontractor for a school renovation in Oulu"* | Geocoded with OpenStreetMap. Local firms ranked first, out-of-town sites only fill empty slots. This is a fresh live run, so say so. | `geo.ts`, `find/route.ts` |
| Outside Finland: *"Electrician in Stockholm"* | Refused: Kilpi only covers Finland because the registers don't list firms abroad. | `find/route.ts` |
| Below threshold: *"Painting subcontractor in Vantaa, contract €6,000"* | Notice: under the €9,000 threshold, so the checks are good practice rather than mandatory, and splitting a job into smaller contracts doesn't avoid the duty. | `tilaajavastuu.ts` `applicability` |
| Finnish input: *"Tarvitsen vedeneristäjän aliurakoitsijaksi Helsinkiin"* | Parsed as B2B waterproofing in Helsinki. Replies in Finnish. | `find/route.ts` intent, `i18n.ts` |
| *"Did you make that up?"* on a quote | Click the evidence: the browser jumps to the exact sentence on the source page. | `textFragment.ts` |
| Gibberish / empty | "Describe the job you need done…" with examples. | `find/route.ts` |

Timings: each company check has a 55 s timeout, and results stream in as each company finishes. Measure fresh and cached times during the warm-up and write them here: fresh ____ s, cached ____ s. (At the last live run, the Katajanokka ventilation query took 27 s fresh, with the first company after about 12 s.)
