"use client";

// Calendar from the move file: a viewing whose time we actually know (an open viewing the listing
// announces, or the time in the landlord's pasted reply) with when to leave work, and the moving checklist with DVV's deadline. We never
// write to anyone's calendar: the user downloads an .ics file or opens a prefilled Google Calendar event.
import { useState } from "react";
import { CalendarPlus, GoogleLogo } from "@phosphor-icons/react";
import type { Area, Listing, MoveIntent } from "@/lib/move/types";
import x from "./Move.module.css";

type Ev = { title: string; start: string; end?: string; location?: string; notes?: string; url?: string; reminderMin?: number };
const pad = (n: number) => String(n).padStart(2, "0");
const local = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
const day = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const fmt = (d: Date) => d.toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

/** "su 15.11.2026 klo 12:00 - 12:30" -> start/end Dates (Helsinki wall-clock = browser local for the demo). */
export function viewingTime(l: Listing): { start: Date; end?: Date; quote: string } | null {
  const f = l.facts?.find((x) => x.key === "viewing");
  const m = f?.value.match(/(\d{1,2})\.(\d{1,2})\.(\d{4})\D+(\d{1,2})[:.](\d{2})(?:\s*[-–]\s*(\d{1,2})[:.](\d{2}))?/);
  if (!f || !m) return null;
  const start = new Date(+m[3], +m[2] - 1, +m[1], +m[4], +m[5]);
  const end = m[6] ? new Date(+m[3], +m[2] - 1, +m[1], +m[6], +m[7]) : undefined;
  return { start, end, quote: f.quote };
}

async function addEvents(events: Ev[], name: string, google: boolean) {
  const r = await fetch("/api/move/calendar", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ events }) });
  const j = (await r.json()) as { ics?: string; google?: (string | null)[]; error?: string };
  if (!r.ok || !j.ics) throw new Error(j.error ?? `HTTP ${r.status}`);
  if (google && j.google?.[0]) {
    window.open(j.google[0], "_blank", "noopener");
    return;
  }
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([j.ics], { type: "text/calendar" }));
  a.download = `${name}.ics`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

type Reply = { found: boolean; status?: "confirmed" | "proposed"; start?: string; end?: string; place?: string; contact?: string; quote?: string; reason?: string; error?: string };

/**
 * A viewing goes to the calendar only when we actually know its time: an open viewing the listing
 * announces (Finnish "esittely": anyone can come, no booking), or a time the landlord's reply
 * proposes or confirms (pasted here; the time must match a sentence in the reply).
 */
export function ViewingCalendar({ l, area, intent, questions }: { l: Listing; area?: Area; intent?: MoveIntent; questions?: string[] }) {
  const listed = viewingTime(l);
  const [reply, setReply] = useState("");
  const [busy, setBusy] = useState(false);
  const [got, setGot] = useState<Reply | undefined>();
  const [state, setState] = useState<{ done?: string; error?: string }>({});
  const fromReply = got?.found && got.start ? { start: new Date(got.start), end: got.end ? new Date(got.end) : undefined } : null;
  const slot = listed ?? fromReply;
  const c = l.commute ?? area?.commute;
  const travel = c?.transitMin ?? null;
  const work = intent?.work?.label || intent?.workAddress;
  const hhmm = (d: Date) => d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });

  const read = async () => {
    setBusy(true);
    setGot(undefined);
    try {
      const r = await fetch("/api/move/reply", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: reply, address: l.address, today: day(new Date()) }) });
      const j = (await r.json()) as Reply;
      setGot(r.ok ? j : { found: false, error: j.error ?? `HTTP ${r.status}` });
    } catch (e) {
      setGot({ found: false, error: (e as Error).message });
    }
    setBusy(false);
  };

  let event: Ev | null = null;
  let leave: Date | null = null;
  if (slot) {
    const end = slot.end ?? new Date(slot.start.getTime() + 30 * 60000);
    leave = travel != null ? new Date(slot.start.getTime() - (travel + 5) * 60000) : null;
    const why = listed ? `Open viewing announced in the listing (no booking needed): “${listed.quote}”` : `${got?.status === "confirmed" ? "Confirmed" : "Proposed"} by the landlord: “${got?.quote}”`;
    const notes = [
      why,
      got?.place ? `Meet: ${got.place}` : null,
      got?.contact ? `Person: ${got.contact}` : l.contact ? `Contact: ${[l.contact.name, l.contact.company, l.contact.phone, l.contact.email].filter(Boolean).join(" · ")}` : null,
      leave && travel != null ? `Leave ${work ? `work (${work})` : "work"} by ${hhmm(leave)}: ${c?.estimate ? "≈" : ""}${travel} min by public transport${c?.estimate ? " (distance-based estimate)" : ""}${l.commute ? "" : ", measured from the area centre"} + 5 min.` : null,
      questions?.length ? `Ask at the viewing:\n${questions.map((q) => `- ${q}`).join("\n")}` : null,
      `Listing: ${l.url}`,
    ]
      .filter(Boolean)
      .join("\n\n");
    event = { title: `Viewing: ${l.address?.split(",")[0] || l.title}`, start: local(slot.start), end: local(end), location: l.address || got?.place, notes, url: l.url, reminderMin: travel != null ? travel + 20 : 60 };
  }
  const go = (google: boolean) =>
    event &&
    addEvents([event], "viewing", google)
      .then(() => setState({ done: google ? "Opened in Google Calendar" : "Calendar file downloaded" }))
      .catch((e: Error) => setState({ error: e.message }));

  return (
    <div className={x.cal}>
      <div className={x.calHead}>
        <CalendarPlus aria-hidden />
        <div>
          {slot ? (
            <>
              <strong>
                {listed ? "Open viewing" : got?.status === "confirmed" ? "Viewing confirmed" : "Viewing proposed"} {fmt(slot.start)}
                {slot.end ? `–${hhmm(slot.end)}` : ""}
              </strong>
              <small>
                {listed ? "Announced in the listing · no booking needed" : `From the landlord's reply`}
                {leave ? ` · leave work by ${hhmm(leave)}` : ""}
              </small>
            </>
          ) : (
            <>
              <strong>No viewing time yet</strong>
              <small>The listing announces none. Send the request; when the landlord replies, paste the reply here.</small>
            </>
          )}
        </div>
      </div>
      {fromReply && got?.quote && <blockquote className={x.newsQuote}>{got.quote}</blockquote>}
      {!listed && !fromReply && (
        <>
          <textarea className={x.calReply} value={reply} onChange={(e) => setReply(e.target.value)} placeholder="Paste the landlord's reply, e.g. “Esittely onnistuu tiistaina klo 17.30, tavataan ulko-ovella.”" rows={3} aria-label="Landlord's reply" />
          <div className={x.calBtns}>
            <button type="button" className={x.ghostBtn} onClick={() => void read()} disabled={busy || reply.trim().length < 15}>
              {busy ? "Reading…" : "Find the viewing time"}
            </button>
          </div>
          {got && !got.found && <small className={got.error ? x.errLine : x.noSrc}>{got.error ?? got.reason}</small>}
        </>
      )}
      {event && (
        <>
          <div className={x.calBtns}>
            <button type="button" className={x.lcPrimary} onClick={() => void go(false)}>
              <CalendarPlus aria-hidden /> Add to calendar (.ics)
            </button>
            <button type="button" className={x.ghostBtn} onClick={() => void go(true)}>
              <GoogleLogo aria-hidden /> Google Calendar
            </button>
            {fromReply && (
              <button type="button" className={x.ghostBtn} onClick={() => (setGot(undefined), setState({}))}>
                Use another reply
              </button>
            )}
          </div>
          {state.done ? <small className={x.okWord}>{state.done}</small> : state.error ? <small className={x.errLine}>{state.error}</small> : <small className={x.noSrc}>Reminder {travel != null ? `${travel + 20} min` : "1 h"} before, with the address, contact and questions.</small>}
        </>
      )}
    </div>
  );
}

const DVV = "https://dvv.fi/en/moving-in-finland";
const DVV_QUOTE = "Submit a notification of move at the earliest one month before the date of the move or at the latest one week after the move.";

export function MovingChecklist({ a, intent }: { a: Area; intent?: MoveIntent }) {
  const [move, setMove] = useState(() => {
    const d = new Date();
    d.setMonth(d.getMonth() + 1, 1);
    return day(d);
  });
  const [state, setState] = useState<{ done?: string; error?: string }>({});
  const md = new Date(`${move}T09:00`);
  const plus = (n: number) => day(new Date(md.getTime() + n * 86400000));
  const events: Ev[] = [
    { title: `Moving day: ${a.name}`, start: move, notes: intent?.summary ? `Your search: ${intent.summary}` : undefined, reminderMin: 24 * 60 },
    { title: "Notify DVV of your move (window opens)", start: plus(-30), notes: `DVV: “${DVV_QUOTE}”`, url: DVV, reminderMin: 600 },
    { title: "Deadline: notify DVV of your move", start: plus(7), notes: `DVV: “${DVV_QUOTE}”`, url: DVV, reminderMin: 2 * 24 * 60 },
  ];
  const go = () =>
    addEvents(events, "moving-checklist", false)
      .then(() => setState({ done: `${events.length} events downloaded` }))
      .catch((e: Error) => setState({ error: e.message }));
  return (
    <div className={x.cal}>
      <div className={x.calHead}>
        <CalendarPlus aria-hidden />
        <div>
          <strong>Moving checklist</strong>
          <small>Moving day, and DVV&rsquo;s window: from 30 days before to 7 days after</small>
        </div>
      </div>
      <label className={x.calRow}>
        <span>Moving day</span>
        <input type="date" value={move} onChange={(e) => setMove(e.target.value)} className={x.calInput} />
      </label>
      <ul className={x.calList}>
        <li>
          <b>{plus(-30)}</b> DVV notification opens
        </li>
        <li>
          <b>{move}</b> Moving day
        </li>
        <li>
          <b>{plus(7)}</b> DVV deadline ·{" "}
          <a href={DVV} target="_blank" rel="noreferrer">
            dvv.fi
          </a>
        </li>
      </ul>
      <div className={x.calBtns}>
        <button type="button" className={x.lcPrimary} onClick={() => void go()}>
          <CalendarPlus aria-hidden /> Add all to calendar (.ics)
        </button>
      </div>
      {state.done ? <small className={x.okWord}>{state.done}</small> : state.error ? <small className={x.errLine}>{state.error}</small> : null}
    </div>
  );
}
