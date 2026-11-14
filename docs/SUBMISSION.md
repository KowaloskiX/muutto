# Junction 2026 submission: Kilpi for contractors

**Challenge:** Exa: Internet Butler / Your Personal Assistant

## Short description (~150 words)

Kilpi helps Finnish construction companies find and vet subcontractors before they sign. Under the Contractor's Liability Act (tilaajavastuulaki 1233/2006), every construction subcontract of €9,000 or more requires the main contractor to collect seven checks, none older than three months. Today that's done by hand, and it still doesn't show whether a firm can do the job.

Describe the job in one sentence, for example "electrical subcontractor for a 40-apartment pipe renovation in Espoo". Kilpi uses Exa to find local firms by their reference projects, headcount and location. It checks each firm against the Finnish registers and the YTJ tax-debt page, reads their site for references and licences, and searches the web for complaints and bankruptcy news. Every finding links to its source, and quotes are checked word for word against the page. Kilpi then drafts quote and document requests for your approval, and can watch a signed subcontractor daily with Exa Monitors.

## Features

- One-sentence request in English, Finnish or Swedish, parsed into trade, scope, place, start date and contract value, with a note on whether the Act applies
- Subcontractor discovery from Exa's company index, semantic search over company sites and reference pages, and Exa Places, shown on a map
- Tilaajavastuu checklist per candidate: prepayment, employer and VAT registers, trade register, insolvency (PRH open data); tax debt and missed filings (YTJ page via Exa Contents); the remaining § 5 documents named with their legal basis
- Capability checks: references cross-checked on independent pages, capacity against job size, Tukes and waterproofing licence claims, certifications
- Reputation from third-party pages via Exa structured output with per-field grounding
- Fit score 0–100 with evidence-backed reasons
- Drafts of quote requests and § 5 document requests (Finnish and English) in an outbox, sent only on approval
- Daily Exa Monitor per subcontractor during the project, with signed webhooks
- Research agent for questions (thresholds, YSE 1998, reporting duty, disputes) with cited answers and proposed actions: draft letter, calendar deadline, official form link, monitor
- Quote check and comparison for pasted subcontractor quotes
- Guards: verbatim-quote check, links only from retrieved evidence, approval before any action, no dummy data, business-ID checksum, Finland-only scope, shared daily LLM token cap

## Exa products used

- **Search:** `type: auto`, `userLocation: "FI"`, include/exclude domains; `category: "company"` for headcount, revenue and founding year; Places via `userLocation` coordinates
- **Contents:** `subpages` + `subpageTarget` to read references, contact and certificate pages; YTJ tax-debt register page; `livecrawlTimeout`
- **Structured output:** `outputSchema` with grounding (deep-lite) for reputation and service proof, plus per-field citations and confidence
- **Dynamic highlights** (beta)
- **Monitors:** daily search for bankruptcy, restructuring, complaints and news per subcontractor, with webhook and HMAC signature verification
- **Agent API:** `/agent/runs` with `outputSchema` for "find all X matching criteria" research
- **Also in the classic view or opt-in:** Agent Monitors backtest (beta), Snapshot for price history (`EXA_SNAPSHOT=1`), Exa Connect Fiber (`EXA_CONNECT_FIBER=1`)

## Tech

Next.js 15, TypeScript, OpenAI Responses API (`gpt-5.4-mini`) with zod structured output, PRH/YTJ open data API, OpenStreetMap Nominatim, Leaflet.
