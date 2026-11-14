# Kilpi for contractors: pitch

Sources for every legal claim below:

- Act: <https://www.finlex.fi/fi/lainsaadanto/2006/1233>
- Työsuojeluhallinto guide: <https://tyosuojelu.fi/documents/154017715/168016298/Tilaajavastuulaki_FI.pdf/e44a5af6-0128-457e-ab25-65c3bcd5b59e/Tilaajavastuulaki_FI.pdf>
- Vero construction reporting: <https://www.vero.fi/en/detailed-guidance/guidance/48413/the-information-reporting-requirement-in-the-construction-industry2/>

Source for the opening example (Hilma tender result): <https://www.hankintailmoitukset.fi/en/public/procedure/27355/enotice/59955/results/contract/CON-0001/tender/TEN-0001>

There are no customer stories or market numbers here, because we don't have sourced ones. The only story is a public tender result, with its source. The pitch rests on the law and the live demo.

---

## 3-minute pitch script

### 0:00–0:15 Opening: a real tender

> "On 22 October 2026, Hilma, Finland's procurement notice service, published a result. The City of Helsinki awarded *Katajanokan ala-asteen koulun ja LPK Luotsin perusparannus* to NCC Suomi Oy, worth about €15.7 million, as a project-management contract. In that model the main contractor buys nearly every trade as a subcontract. So the site team now has to find and vet about a dozen subcontractors, fast, each one under the Contractor's Liability Act. Every winning bid starts a second, hidden procurement: the subcontractors."

Slide: the Hilma result (buyer: Helsinki kaupunkiympäristön toimiala; winner: NCC Suomi Oy, 1765514-2; projektinjohtourakka with target and ceiling price; tender value 15 720 744,34 EUR), with the source URL at the bottom.

This is only a public example of the situation. Don't say or imply that NCC uses Kilpi, and don't add anything about NCC beyond the notice.

### 0:15–0:35 Problem

> "In Finland, every construction subcontract of €9,000 or more falls under the Contractor's Liability Act, tilaajavastuulaki. Before signing, the main contractor has to collect seven things: register status, a trade register extract, tax payments, pension insurance, the collective agreement, occupational health care and accident insurance. None of them may be older than three months. Skip it, and the Act lets the authorities charge a negligence fee."

Slide: the seven § 5 items as a checklist, with the guide URL at the bottom.

### 0:35–0:50 Why it's still manual

> "Today a site manager does this by hand: YTJ, the tax-debt register, emails for certificates. Then they still don't know the things that actually decide the job: has this ventilation firm done a school renovation before, are they big enough, are they in the news for a bankruptcy? Existing compliance reports only cover firms that joined a paid programme, and they say nothing about references."

### 0:50–2:15 Live demo (85 s)

1. **0:50: one sentence in.** Click *"Ventilation subcontractor for a school renovation in Katajanokka, Helsinki, ~€400k"*. The chip sends: *"Ventilation (IV) subcontractor for a school renovation (perusparannus) in Katajanokka, Helsinki, about 400 000 €, start in spring"*.
   > "One of those dozen trades. One sentence. Kilpi parses the trade, scope, place, value and start, and tells me the Act applies."
2. **1:00: candidates stream in.** Point at the map and the live checks.
   > "Exa finds ventilation contractors in Helsinki by what they've built, not by ad spend. That's the company index for headcount and revenue, semantic search over their reference pages, and Places for the map."
3. **1:15: open the top candidate's checklist drawer.**
   > "Green: in the prepayment, employer and VAT registers, from PRH open data, or from a dated stored copy of the YTJ page when PRH is down. Tax-debt register: read live from YTJ through Exa, with a re-check link. Grey: the four documents no public register has, so Kilpi asks for them. Every line has a source. Click one and it jumps to the exact sentence."
   Click one evidence link to show the text-fragment jump.
4. **1:30: the catch.** Open a candidate marked "clarify first" whose register row is missing the employer register.
   > "This firm is bidding for a €400,000 job, and the register page doesn't list it in the employer register. A model without Exa can't know that. Here is the source and the date it was read."
   At the last live run this was Helsingin ilmanvaihto Oy (#3). Use whatever the run shows, and don't promise the same result.
5. **1:45: references and capacity.**
   > "Their site lists reference projects. Kilpi checked one against an independent page Exa found. Headcount from Exa's company index, set against a €400,000 school job."
6. **1:55: next step with approval.** Type *"request quotes from the top 2"*.
   > "It drafts an RFQ and a § 5 document request in Finnish, listing only what's still missing. Nothing is sent until I approve."
7. **2:05: watch.** Type *"watch #1"*.
   > "After signing, an Exa Monitor checks daily for konkurssi, yrityssaneeraus or complaints about them."

If the result comes from the warm-up cache, say: *"These checks ran N minutes ago. I'll run a fresh one if you give me a company."*

### 2:15–2:35 Why Exa

Slide text:

> **Why Exa is the core, not a plug-in**
> - The facts are on small Finnish company sites and local news, not in any model: references, licences, headcount, complaints.
> - Search (company index, Places, `userLocation: FI`) finds subcontractors by what they've built.
> - Contents + subpages read `/referenssit` and the YTJ tax-debt register, which has no API.
> - outputSchema grounding returns citations per field. We keep a quote only if it appears word for word on the page.
> - Monitors keep watching after signing. Search + Monitors cover the whole contract, not one day.
> - Agent API handles "find all X matching criteria" when one search isn't enough.

> "Without Exa there is no shortlist and no references, and no evidence, just a checklist."

### 2:35–2:50 Business model

> "Main contractors pay per check, and per subcontractor watched during the project."

Slide (all prices are **assumptions** to test, not validated):

| Item | Assumed price |
|---|---|
| Vetting check per candidate (full report + document request) | €9 |
| Monitored subcontractor | €5 / month while the contract runs |
| Team plan (unlimited checks, 50 monitored) | €249 / month |

Costs per check are Exa calls (about 20 per shortlist of 4) plus a small model. The code caches every result, so repeat checks cost nothing for 6 hours.

### 2:50–3:00 Roadmap and close

> "Next: collect the subcontractor's documents into the case file and check their dates automatically, query the Tukes register directly, and team accounts. Kilpi: vet subcontractors before you sign, with a source for every line."

---

## Roadmap (slide or Q&A)

1. **Document inbox.** The subcontractor uploads the § 5 certificates, Kilpi reads them and flags any older than 3 months. At 12 months it reminds you to renew, as the guide requires for longer contracts.
2. **Direct register checks.** Query the Tukes register for electrical contractors and Vastuu Group reports where a firm has one.
3. **Persistent projects and monitors.** Server-side project store, team accounts, monitor secrets that survive restarts.
4. **Construction reporting export.** Contract details for the monthly Vero report (contracts over €15,000).
5. **Bring the errand agent into the B2B scope.** Its prompt is still worded for household hiring.

## Likely judge questions

- **"Is this real data?"** Yes. There is no seeded data. Every company and finding comes from Exa, PRH open data or the YTJ page, with a link. Try your own query.
- **"What if the model makes up a quote?"** The quote is dropped. Every quote is matched word for word against the fetched page text before it's shown.
- **"Does it send emails on its own?"** No. Drafts open in your mail app only after you click Approve. Monitors start only after approval.
- **"Why not just use Vastuu Group?"** Use it where the firm has it, and Kilpi points to it when a firm's site shows the programme. Most small subcontractors aren't in it, and it doesn't cover references, capacity or news.

---

## 90-second video script

Record at 1920×1080 on `/chat` with a warm cache. Voice-over is in quotes. If a shot uses cached results, the on-screen caption says "results from a live run N min earlier".

| Time | Shot | Voice-over / caption |
|---|---|---|
| 0:00–0:08 | Title card: "Kilpi for contractors: vet subcontractors before you sign" over a building-site photo you own or a plain background | "In Finland, every construction subcontract of €9,000 or more comes with a legal checklist." |
| 0:08–0:18 | Slide: the seven § 5 items, guide URL visible | "Seven documents, none older than three months, collected by hand for every subcontractor. And it still doesn't tell you if they can do the job." |
| 0:18–0:26 | Screen: `/chat` welcome, cursor clicks the Katajanokka ventilation example | "Kilpi starts from one sentence." |
| 0:26–0:40 | Screen: progress steps, candidates appearing on the map and in the shortlist | "Exa finds Helsinki ventilation contractors by their reference projects, headcount and location, and Kilpi checks each one in parallel." |
| 0:40–0:55 | Screen: open the top candidate's checklist drawer, scroll the green and grey items | "The registers come from PRH and the YTJ tax-debt page, read through Exa. What no register shows becomes a document request, with the section of the Act." |
| 0:55–1:05 | Screen: click an evidence link, browser jumps to the highlighted sentence on the company's site | "Every line has a source. Quotes are checked word for word against the page." |
| 1:05–1:15 | Screen: type "request quotes from the top 2", outbox shows drafts, hover "Approve and send" | "It drafts the quote request and the document request. Nothing goes out until you approve." |
| 1:15–1:23 | Screen: type "watch #1", the watch card appears | "After signing, an Exa Monitor watches for bankruptcy, restructuring or complaints." |
| 1:23–1:30 | End card: "Exa Search · Contents · outputSchema grounding · Monitors · Agent API" + repo URL | "Kilpi. Vet subcontractors before you sign." |

Shot list checklist:

- [ ] Title card and § 5 slide (static)
- [ ] Clean browser profile: no bookmarks bar or other tabs, zoom 110%
- [ ] Warm cache (run the query twice before recording)
- [ ] Screen recording of the full flow in one take, cut in editing
- [ ] Close-up of the text-fragment jump on the company site
- [ ] Outbox with "waiting for your OK"
- [ ] End card with Exa products
