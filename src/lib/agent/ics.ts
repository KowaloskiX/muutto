// Minimal RFC 5545 calendar file for a proposed event. Times are given as local
// Europe/Helsinki wall-clock ("2026-11-21T19:00") and written out in UTC.

export const TZ = "Europe/Helsinki";

/** Offset (minutes) of a time zone at a given instant, via Intl. */
function tzOffsetMin(at: Date, tz: string): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })
      .formatToParts(at)
      .map((p) => [p.type, p.value]),
  );
  const asUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
  return Math.round((asUtc - at.getTime()) / 60000);
}

/** Parses "YYYY-MM-DD" (all-day) or "YYYY-MM-DDTHH:mm" local time; explicit offsets/Z are honoured. */
export function parseLocal(s: string, tz = TZ): { date: Date; allDay: boolean } | null {
  const v = s.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) {
    const d = new Date(`${v}T00:00:00Z`);
    return Number.isNaN(d.getTime()) ? null : { date: d, allDay: true };
  }
  if (/[zZ]|[+-]\d{2}:?\d{2}$/.test(v)) {
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : { date: d, allDay: false };
  }
  const m = v.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/);
  if (!m) return null;
  const guess = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
  const off = tzOffsetMin(new Date(guess), tz);
  const d = new Date(guess - off * 60000);
  return Number.isNaN(d.getTime()) ? null : { date: d, allDay: false };
}

const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
const stamp = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
const dateOnly = (d: Date) => d.toISOString().slice(0, 10).replace(/-/g, "");

/** Folds lines at 75 octets (approximate by chars) per RFC 5545. */
const fold = (line: string) => line.match(/.{1,73}/g)?.join("\r\n ") ?? line;

export function buildIcs(ev: { title: string; start: string; end?: string; location?: string; notes?: string; url?: string; reminderMin?: number }): string | null {
  const s = parseLocal(ev.start);
  if (!s) return null;
  let e = ev.end ? parseLocal(ev.end) : null;
  if (!e || e.date <= s.date) e = { date: new Date(s.date.getTime() + (s.allDay ? 86400000 : 3600000)), allDay: s.allDay };
  const uid = `${stamp(new Date())}-${Math.random().toString(36).slice(2, 10)}@kilpi-agent`;
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Kilpi//Errand agent//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${uid}`,
    `DTSTAMP:${stamp(new Date())}`,
    s.allDay ? `DTSTART;VALUE=DATE:${dateOnly(s.date)}` : `DTSTART:${stamp(s.date)}`,
    s.allDay ? `DTEND;VALUE=DATE:${dateOnly(e.date)}` : `DTEND:${stamp(e.date)}`,
    `SUMMARY:${esc(ev.title)}`,
    ...(ev.location ? [`LOCATION:${esc(ev.location)}`] : []),
    ...(ev.notes ? [`DESCRIPTION:${esc(ev.notes)}`] : []),
    ...(ev.url ? [`URL:${ev.url}`] : []),
    "BEGIN:VALARM",
    "ACTION:DISPLAY",
    `DESCRIPTION:${esc(ev.title)}`,
    `TRIGGER:-PT${Math.max(0, Math.round(ev.reminderMin ?? (s.allDay ? 600 : 60)))}M`,
    "END:VALARM",
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return lines.map(fold).join("\r\n") + "\r\n";
}

export type IcsEvent = { title: string; start: string; end?: string; location?: string; notes?: string; url?: string; reminderMin?: number };

/** Several events in one calendar file (one VEVENT each), same rules as buildIcs. */
export function buildIcsMulti(events: IcsEvent[]): string | null {
  const vevents: string[] = [];
  for (const ev of events) {
    const one = buildIcs(ev);
    if (!one) continue;
    const m = one.match(/BEGIN:VEVENT[\s\S]*?END:VEVENT/);
    if (m) vevents.push(m[0]);
  }
  if (!vevents.length) return null;
  return ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Muutto//Move agent//EN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH", ...vevents, "END:VCALENDAR"].join("\r\n") + "\r\n";
}

/** "Add to Google Calendar" link for one event (opens a prefilled event; nothing is created by us). */
export function googleCalendarUrl(ev: IcsEvent): string | null {
  const s = parseLocal(ev.start);
  if (!s) return null;
  let e = ev.end ? parseLocal(ev.end) : null;
  if (!e || e.date <= s.date) e = { date: new Date(s.date.getTime() + (s.allDay ? 86400000 : 3600000)), allDay: s.allDay };
  const fmt = (d: Date, allDay: boolean) => (allDay ? dateOnly(d) : stamp(d));
  const q = new URLSearchParams({ action: "TEMPLATE", text: ev.title, dates: `${fmt(s.date, s.allDay)}/${fmt(e.date, s.allDay)}`, ctz: TZ });
  if (ev.location) q.set("location", ev.location);
  if (ev.notes || ev.url) q.set("details", [ev.notes, ev.url].filter(Boolean).join("\n\n"));
  return `https://calendar.google.com/calendar/render?${q}`;
}
