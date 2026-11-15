<p align="center"><img src="public/media/logo-goat-256.png" width="120" alt="Pukki, the Muutto goat" /></p>

# Muutto — got the job. Now, where to live?

Muutto helps people moving to the Helsinki region for work find the best place to **rent or buy**, starting from where they will work. You describe the move in one sentence; Muutto ranks postal areas by your real commute and daily life, finds live listings, researches the flat and the landlord, and writes the applications — **every fact links to its source, and nothing is sent without your approval.**

Built at Junction 2026 for the Exa “Internet Butler” challenge. Next.js 15 · React · Exa API · OpenAI · Leaflet.

## What it does
- **One sentence in, a ranked move file out (~20–27 s).** Workplace geocoded, candidate postal areas (Statistics Finland Paavo) measured in parallel: transit/car/bike commute (OSRM, Digitransit when configured), shops, schools, daycare, parks, transit stops (OpenStreetMap + city service registers), air quality (FMI), traffic noise (City of Helsinki + Väylävirasto, one daytime LAeq scale), local works and city decisions (Exa).
- **Live listings with photos** from Oikotie, Vuokraovi and Etuovi (Exa Search + Contents), filtered to your budget and rooms, with facts read from the listing text (built year, lift, sauna, energy class, pipe renovation…) and each flat’s **history** — earlier, already delisted pages of the same flat.
- **Ask for anything.** Add any criterion (“public sauna”, “near the sea”, “safe at night”) in the table or the chat: venues go to Exa Places, questions to Exa Search with a judged, quoted answer per area.
- **Drive time along real roads** (Valhalla isochrones, minute by minute, up to 3 h).
- **Inside an area:** criteria tiles, nearby places, settling-in contacts, city plans for the coming years and dated resident voices.
- **Deep research on a flat** (Exa Agent): building, landlord, street works, risks and viewing questions, citations verified.
- **Pukki applies for you.** For your five best flats Muutto researches each landlord (tenant requirements, how to apply, reviews — quoted), writes a tailored application in Finnish and English from your profile, lists what is missing, and waits for **Approve**. Sending is test-only (to your own inbox via Resend). A pasted landlord reply becomes a calendar event.
- **Pukki’s guided tour** for first-time visitors, and an Exa Monitor that watches your areas for new listings.

## Run it
```bash
npm i
cp .env.example .env.local   # or create .env.local with the keys below
npm run dev                  # http://localhost:3000  (/move is the app)
```
`.env.local`:
```
EXA_API_KEY=...
OPENAI_API_KEY=...
LLM_DAILY_TOKEN_CAP=2000000      # optional spend guard
RESEND_API_KEY=...               # optional: test sending of approved emails
MAIL_TEST_TO=you@example.com     # every approved email goes here, never to landlords
DIGITRANSIT_KEY=...              # optional: timetable-based transit times
```

## Where things are
- `src/app/api/move/*` — streaming search (`/api/move`), research, criterion, apply, history, outlook, iso/heat, send, calendar…
- `src/lib/move/*` — areas, commute, amenities, noise, listings, facts, history, landlord, application, research.
- `src/components/move/*` — the app: chat, move file, map, drawer, applications, tour.
- `docs/KILPI.md` — the project before the pivot (subcontractor vetting).

Every number in the UI comes from a named source; when a source is missing the app says “unknown” instead of guessing.
