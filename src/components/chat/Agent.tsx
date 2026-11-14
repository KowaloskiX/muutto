"use client";

import { useState, type ReactNode } from "react";
import {
  ArrowSquareOut,
  Bell,
  CalendarPlus,
  CheckCircle,
  Circle,
  CircleNotch,
  ClipboardText,
  Copy,
  Envelope,
  EnvelopeSimple,
  Link as LinkIcon,
  ListChecks,
  PencilSimple,
  Phone,
  XCircle,
} from "@phosphor-icons/react";
import { withTextFragment } from "@/lib/textFragment";
import { Sources, host } from "./Bubbles";
import { t, type Key } from "./i18n";
import type { ActionEdit, ActionStatus, AgentAction, Evidence, PlanStep, Source } from "./types";
import s from "./Chat.module.css";

// ---- payload helpers: the agent's payloads are loosely shaped, read them defensively ----
type P = Record<string, unknown>;
export const str = (p: P | undefined, ...keys: string[]) => {
  for (const k of keys) {
    const v = p?.[k];
    if (typeof v === "string" && v.trim()) return v.trim();
    if (typeof v === "number") return String(v);
  }
  return undefined;
};
const list = (p: P | undefined, ...keys: string[]) => {
  for (const k of keys) {
    const v = p?.[k];
    if (Array.isArray(v)) return v.map((x) => (typeof x === "string" ? x : typeof x === "object" && x ? Object.values(x).filter((y) => typeof y === "string").join(": ") : String(x))).filter(Boolean);
  }
  return [];
};
const isWeb = (u?: string): u is string => !!u && /^https?:\/\//i.test(u);
const isEmail = (u?: string) => !!u && /^[^\s@<>]+@[^\s@<>]+\.[a-z]{2,}$/i.test(u);
const emailIn = (u?: string) => u?.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0];
const phoneIn = (u?: string) => u?.replace(/^tel:/i, "").match(/\+?\d[\d\s()-]{6,}\d/)?.[0];

const TOOLS: Record<string, string> = {
  exa_search: "Exa search",
  exa_read: "Exa read",
  exa_places: "Exa Places",
  exa_find_list: "Exa Agent",
  watch_changes: "Exa Monitor",
  draft_message: "Draft",
  calendar_event: "Calendar",
  booking_link: "Link check",
  contractors_handoff: "Contractor check",
};

/** Agent tool ids -> short badges. */
export function toolLabel(tool?: string) {
  if (!tool) return undefined;
  if (TOOLS[tool]) return TOOLS[tool];
  const x = tool.toLowerCase();
  if (/place|map/.test(x)) return "Exa Places";
  if (/monitor|watch/.test(x)) return "Exa Monitor";
  if (/read|content|fetch|crawl/.test(x)) return "Exa read";
  if (/search|exa/.test(x)) return "Exa search";
  return tool.replace(/[_-]+/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}

function StepIcon({ status }: { status: PlanStep["status"] }) {
  if (status === "active") return <CircleNotch className={s.spin} />;
  if (status === "done") return <CheckCircle weight="fill" className={`${s.dot} ${s.green}`} />;
  if (status === "failed") return <XCircle weight="fill" className={`${s.dot} ${s.red}`} />;
  return <Circle className={`${s.dot} ${s.grey}`} />;
}

type PlanProps = { plan?: string[]; steps: PlanStep[]; evidence: Evidence[]; finished?: boolean; failed?: boolean; exaCalls?: number; lang?: string };

/** Live errand checklist: the agent's plan, the tool calls it makes (with Exa badges), and what it read. */
export function PlanCard({ plan = [], steps, evidence, finished, failed, exaCalls, lang }: PlanProps) {
  const [all, setAll] = useState(false);
  const [open, setOpen] = useState(false);
  // One chip per site (deep-linked to the first page we quoted there), with a count.
  const sites = [...evidence.reduce((m, e) => {
    const h = host(e.url);
    const g = m.get(h);
    if (!g) m.set(h, { first: e, n: 1, titles: [e.title ?? e.url] });
    else {
      g.n++;
      g.titles.push(e.title ?? e.url);
      if (!g.first.quote && e.quote) g.first = e;
    }
    return m;
  }, new Map<string, { first: Evidence; n: number; titles: string[] }>())];
  const shown = all ? sites : sites.slice(0, 6);
  const running = steps.some((x) => x.status === "active");
  // Once finished, the tool calls fold into one summary line ("3 Exa search · 2 Exa read").
  const badgeCounts = [...steps.reduce((m, st) => m.set(toolLabel(st.tool) ?? "Step", (m.get(toolLabel(st.tool) ?? "Step") ?? 0) + 1), new Map<string, number>())];
  const folded = finished && !open && steps.length > 2 && !steps.some((x) => x.status === "failed");
  // Plan items are intentions, not tool calls: they tick together once the errand is done.
  const planStatus: PlanStep["status"] = finished ? (failed ? "skipped" : "done") : "pending";
  return (
    <div className={`${s.card} ${s.plan}`}>
      <div className={s.planHead}>
        <ListChecks weight="bold" />
        <small>{t(lang, "planTitle")}</small>
        <span className={s.planCount}>
          {finished ? `${exaCalls ? `${exaCalls} Exa calls · ` : ""}${t(lang, failed ? "planStopped" : "planDone")}` : running || !steps.length ? <CircleNotch className={s.spin} /> : null}
        </span>
      </div>
      {plan.length > 0 && (
        <ul className={s.steps}>
          {plan.map((label, i) => (
            <li key={i} className={planStatus === "done" ? "" : s.stepIdle}>
              <StepIcon status={planStatus} />
              <span>{label}</span>
            </li>
          ))}
        </ul>
      )}
      {folded ? (
        <button type="button" className={`${s.activity} ${s.fold}`} onClick={() => setOpen(true)} aria-expanded={false}>
          {badgeCounts.map(([label, n]) => (
            <span key={label} className={s.tool}>
              {n > 1 ? `${n}× ` : ""}
              {label}
            </span>
          ))}
          <span className={s.foldHint}>{steps.length} steps</span>
        </button>
      ) : steps.length > 0 && (
        <ul className={`${s.steps} ${plan.length ? s.activity : ""}`}>
          {steps.map((st) => (
            <li key={st.id} className={st.status === "pending" || st.status === "skipped" ? s.stepIdle : ""} title={st.detail}>
              <StepIcon status={st.status} />
              <span>
                {st.label}
                {st.status === "failed" && st.detail ? <small className={s.stepDetail}>{st.detail}</small> : null}
              </span>
              {toolLabel(st.tool) && <span className={s.tool}>{toolLabel(st.tool)}</span>}
            </li>
          ))}
        </ul>
      )}
      {evidence.length > 0 && (
        <div className={s.evidence}>
          <small>{t(lang, "planRead")}</small>
          <span className={s.evRow}>
            {shown.map(([h, { first, n, titles }]) => (
              <a
                key={h}
                className={s.src}
                href={withTextFragment(first.url, first.quote)}
                target="_blank"
                rel="noopener noreferrer"
                title={[...titles.slice(0, 6), first.quote && `“${first.quote.slice(0, 180)}”`, first.via && `via ${first.via}`].filter(Boolean).join("\n")}
              >
                {h}
                {n > 1 && <b className={s.srcN}>{n}</b>}
                <ArrowSquareOut weight="bold" />
              </a>
            ))}
            {sites.length > shown.length && (
              <button type="button" className={s.more} onClick={() => setAll(true)}>
                +{sites.length - shown.length}
              </button>
            )}
          </span>
        </div>
      )}
    </div>
  );
}

// ---- calendar ----------------------------------------------------------------------
const icsEsc = (x: string) => x.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
const utc = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
const dateOnly = (x: string) => /^\d{4}-\d{2}-\d{2}$/.test(x);

function calTimes(p: P) {
  const start = str(p, "start", "startTime", "date", "when", "dtstart");
  const end = str(p, "end", "endTime", "dtend");
  if (!start) return undefined;
  if (dateOnly(start)) {
    const next = new Date(`${(end && dateOnly(end) ? end : start)}T00:00:00Z`);
    if (!end || end === start) next.setUTCDate(next.getUTCDate() + 1);
    return { allDay: true, start: new Date(`${start}T00:00:00Z`), end: next };
  }
  const a = new Date(start);
  if (Number.isNaN(a.getTime())) return undefined;
  const b = end ? new Date(end) : new Date(a.getTime() + Number(p.durationMinutes ?? 60) * 60000);
  return { allDay: false, start: a, end: Number.isNaN(b.getTime()) ? new Date(a.getTime() + 3600000) : b };
}

export function buildIcs(title: string, p: P) {
  const when = calTimes(p);
  if (!when) return undefined;
  const ymd = (d: Date) => d.toISOString().slice(0, 10).replace(/-/g, "");
  const desc = [str(p, "description", "notes", "details"), str(p, "link", "url") && !/\.ics(\?|$)/i.test(str(p, "link", "url")!) ? str(p, "link", "url") : undefined].filter(Boolean).join("\n\n");
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Kilpi//Butler//EN",
    "CALSCALE:GREGORIAN",
    "BEGIN:VEVENT",
    `UID:${Date.now()}-${Math.random().toString(36).slice(2)}@kilpi`,
    `DTSTAMP:${utc(new Date())}`,
    when.allDay ? `DTSTART;VALUE=DATE:${ymd(when.start)}` : `DTSTART:${utc(when.start)}`,
    when.allDay ? `DTEND;VALUE=DATE:${ymd(when.end)}` : `DTEND:${utc(when.end)}`,
    `SUMMARY:${icsEsc(str(p, "title", "summary") ?? title)}`,
    ...(str(p, "location") ? [`LOCATION:${icsEsc(str(p, "location")!)}`] : []),
    ...(desc ? [`DESCRIPTION:${icsEsc(desc)}`] : []),
    ...(p.alarm !== false
      ? ["BEGIN:VALARM", "ACTION:DISPLAY", `DESCRIPTION:${icsEsc(title)}`, when.allDay ? "TRIGGER:PT9H" : `TRIGGER:-PT${Math.max(0, Number(p.reminderMinutes ?? 60)) || 60}M`, "END:VALARM"]
      : []),
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return lines.join("\r\n");
}

function download(name: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

const fmtWhen = (p: P, lang?: string) => {
  const w = calTimes(p);
  if (!w) return str(p, "start", "date", "when");
  const loc = lang && lang.length === 2 ? lang : undefined;
  try {
    return w.allDay
      ? w.start.toLocaleDateString(loc, { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })
      : `${w.start.toLocaleString(loc, { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })} – ${w.end.toLocaleTimeString(loc, { hour: "2-digit", minute: "2-digit" })}`;
  } catch {
    return w.start.toISOString();
  }
};

// ---- action cards -------------------------------------------------------------------
const ICON = { email: Envelope, letter: EnvelopeSimple, calendar: CalendarPlus, booking_link: LinkIcon, form_link: ClipboardText, call_script: Phone, watch: Bell } as const;

export type ActionProps = {
  action: AgentAction;
  status: ActionStatus;
  edit?: ActionEdit;
  editing?: boolean;
  result?: string;
  lang?: string;
  onChange: (x: { status?: ActionStatus; edit?: ActionEdit; editing?: boolean; result?: string }) => void;
  /** watch: the parent calls the endpoint (and remembers the monitor). Resolves to a short result line. */
  onWatch: () => Promise<void>;
  /** Sources the proposal rests on (payload.basedOn), shown under the card. */
  basis?: Source[];
};

function CopyBtn({ text, lang }: { text: string; lang?: string }) {
  const [ok, setOk] = useState(false);
  return (
    <button
      type="button"
      className={s.ghost}
      onClick={() => {
        void navigator.clipboard?.writeText(text).then(
          () => {
            setOk(true);
            setTimeout(() => setOk(false), 1600);
          },
          () => undefined,
        );
      }}
    >
      <Copy /> {ok ? t(lang, "copied") : t(lang, "copy")}
    </button>
  );
}

export function ActionCard({ action, status, edit, editing, result, lang, onChange, onWatch, basis = [] }: ActionProps) {
  const p = (action.payload ?? {}) as P;
  const tr = (k: Key, v?: Record<string, string | number>) => t(lang, k, v);
  const Icon = ICON[action.kind] ?? ClipboardText;
  const done = status === "done";
  const [working, setWorking] = useState(false);
  const note = str(p, "summary", "description", "notes", "instructions", "why");
  const doneLine = (text: string) => (
    <span className={s.sentNote}>
      <CheckCircle weight="fill" /> {text}
    </span>
  );
  const failed = status === "failed" && result ? <small className={`${s.muted} ${s.red}`}>{result}</small> : null;

  let main: ReactNode = null;
  let actions: ReactNode = null;

  switch (action.kind) {
    case "email":
    case "letter": {
      const rawTo = str(p, "to", "email", "recipientEmail");
      const to = edit?.to ?? emailIn(rawTo) ?? "";
      const recipient = rawTo && !isEmail(rawTo) ? rawTo : str(p, "recipient", "toName", "name", "company");
      const address = str(p, "address", "postalAddress");
      const subject = edit?.subject ?? str(p, "subject", "title") ?? action.title;
      const body = edit?.body ?? str(p, "body", "text", "content", "letter") ?? "";
      const href = `mailto:${isEmail(to) ? to : ""}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
      // Text to paste into an online form: copying it is the approval, there is nothing to mail.
      const formText = str(p, "format") === "form_text";
      main = (
        <>
          <p className={s.actMeta}>
            {[recipient, isEmail(to) && !recipient?.includes(to) ? to : undefined, address].filter(Boolean).join(" · ") ||
              (action.kind === "email" ? "No address found in the sources: add one in your mail app" : undefined)}
          </p>
          {editing ? (
            <>
              <input className={s.actInput} value={to} placeholder="to@example.com" onChange={(e) => onChange({ edit: { ...edit, to: e.target.value } })} aria-label="Recipient email" />
              <input className={s.actInput} value={subject} onChange={(e) => onChange({ edit: { ...edit, subject: e.target.value } })} aria-label="Subject" />
              <textarea className={s.draftEdit} value={body} rows={10} onChange={(e) => onChange({ edit: { ...edit, body: e.target.value } })} aria-label="Message body" />
            </>
          ) : (
            <>
              <div className={s.subject}>{subject}</div>
              <p className={s.draftBody}>{body}</p>
            </>
          )}
        </>
      );
      actions = (
        <>
          {done ? doneLine(tr(formText ? "copied" : "sentMail")) : formText ? (
            <button
              type="button"
              className={s.approve}
              onClick={() => void navigator.clipboard?.writeText(body).then(() => onChange({ status: "done", editing: false }), () => undefined)}
            >
              <Copy weight="bold" /> {tr("copyForForm")}
            </button>
          ) : (
            <a className={s.approve} href={href} onClick={() => onChange({ status: "done", editing: false })}>
              {tr("approveSend")}
            </a>
          )}
          <button type="button" className={s.ghost} onClick={() => onChange({ editing: !editing })}>
            <PencilSimple /> {editing ? tr("editDone") : tr("edit")}
          </button>
          <CopyBtn text={`${subject}\n\n${body}`} lang={lang} />
        </>
      );
      break;
    }
    case "calendar": {
      // An .ics to download: explicit ics fields, or a url that is clearly a calendar file / our own API.
      const icsUrl = str(p, "icsUrl", "ics", "downloadUrl") ?? (/\.ics(\?|$)|^\/api\//i.test(str(p, "url") ?? "") ? str(p, "url") : undefined);
      const remote = icsUrl && /^(https?:\/\/|\/api\/|data:text\/calendar)/i.test(icsUrl) ? icsUrl : undefined;
      const ics = remote ? undefined : buildIcs(action.title, p);
      const when = fmtWhen(p, lang);
      main = (
        <p className={s.actMeta}>
          {[when, str(p, "location")].filter(Boolean).join(" · ")}
          {note ? <span className={s.actNote}>{note}</span> : null}
        </p>
      );
      actions = done ? doneLine(tr("addedCal")) : remote ? (
        <a className={s.approve} href={remote} download={`${action.title.replace(/[^\p{L}\p{N}]+/gu, "-").slice(0, 40) || "event"}.ics`} onClick={() => onChange({ status: "done" })}>
          <CalendarPlus weight="bold" /> {tr("addCal")}
        </a>
      ) : (
        <button
          type="button"
          className={s.approve}
          disabled={!ics}
          title={ics ? undefined : "No date in this suggestion"}
          onClick={() => {
            if (!ics) return;
            download(`${action.title.replace(/[^\p{L}\p{N}]+/gu, "-").slice(0, 40) || "event"}.ics`, ics, "text/calendar");
            onChange({ status: "done" });
          }}
        >
          <CalendarPlus weight="bold" /> {tr("addCal")}
        </button>
      );
      break;
    }
    case "booking_link":
    case "form_link": {
      const url = str(p, "url", "link", "href");
      const fields = p.fields && typeof p.fields === "object" && !Array.isArray(p.fields) ? Object.entries(p.fields as P).filter(([, v]) => typeof v === "string" || typeof v === "number") : [];
      const steps = list(p, "steps", "checklist", "bring");
      main = (
        <>
          <p className={s.actMeta}>
            {[str(p, "provider", "venue", "name"), isWeb(url) ? host(url) : undefined, fmtWhen(p, lang)].filter(Boolean).join(" · ")}
            {str(p, "label") && str(p, "label") !== action.title ? <span className={s.actNote}>{str(p, "label")}</span> : null}
            {note ? <span className={s.actNote}>{note}</span> : null}
          </p>
          {fields.length > 0 && (
            <dl className={s.fields}>
              {fields.map(([k, v]) => (
                <div key={k}>
                  <dt>{k.replace(/[_-]+/g, " ")}</dt>
                  <dd>{String(v)}</dd>
                </div>
              ))}
            </dl>
          )}
          {steps.length > 0 && <ol className={s.actList}>{steps.map((x, i) => <li key={i}>{x}</li>)}</ol>}
        </>
      );
      actions = (
        <>
          {!isWeb(url) ? <small className={s.muted}>No link given</small> : done ? (
            <>
              {doneLine(tr("opened"))}
              <a className={s.ghost} href={url} target="_blank" rel="noopener noreferrer"><ArrowSquareOut /> {host(url)}</a>
            </>
          ) : (
            <a className={s.approve} href={url} target="_blank" rel="noopener noreferrer" onClick={() => onChange({ status: "done" })}>
              {action.kind === "booking_link" ? tr("openBooking") : tr("openForm")} <ArrowSquareOut weight="bold" />
            </a>
          )}
          {fields.length > 0 && <CopyBtn text={fields.map(([k, v]) => `${k}: ${v}`).join("\n")} lang={lang} />}
        </>
      );
      break;
    }
    case "call_script": {
      const phone = phoneIn(str(p, "phone", "tel", "number")) ?? phoneIn(str(p, "to"));
      const who = str(p, "name", "to", "company", "recipient");
      const script = str(p, "script", "body", "text");
      const points = list(p, "points", "talkingPoints", "bullets", "steps");
      const full = [script, ...points.map((x) => `- ${x}`)].filter(Boolean).join("\n");
      main = (
        <>
          <p className={s.actMeta}>
            {[who, who?.includes(phone ?? "\u0000") ? undefined : phone, str(p, "hours", "openingHours")].filter(Boolean).join(" · ")}
          </p>
          {str(p, "subject") && <div className={s.subject}>{str(p, "subject")}</div>}
          {script && <p className={s.draftBody}>{script}</p>}
          {points.length > 0 && <ul className={s.actList}>{points.map((x, i) => <li key={i}>{x}</li>)}</ul>}
        </>
      );
      actions = (
        <>
          {phone ? (done ? doneLine(tr("called")) : (
            <a className={s.approve} href={`tel:${phone.replace(/[^\d+]/g, "")}`} onClick={() => onChange({ status: "done" })}>
              <Phone weight="fill" /> {tr("callNow", { phone })}
            </a>
          )) : null}
          {full && <CopyBtn text={full} lang={lang} />}
        </>
      );
      break;
    }
    case "watch": {
      const what = str(p, "query", "name", "target", "topic");
      const domains = list(p, "includeDomains");
      main = (
        <p className={s.actMeta}>
          {[what && `“${what}”`, domains.length ? domains.join(", ") : undefined, str(p, "cadence", "frequency", "schedule"), str(p, "engine") === "exa.monitors" ? "Exa Monitor" : undefined].filter(Boolean).join(" · ")}
          {note ? <span className={s.actNote}>{note}</span> : null}
        </p>
      );
      actions = done ? doneLine(result || tr("watchStarted")) : (
        <button
          type="button"
          className={s.approve}
          disabled={working}
          onClick={async () => {
            setWorking(true);
            try {
              await onWatch();
            } finally {
              setWorking(false);
            }
          }}
        >
          {working ? <CircleNotch className={s.spin} /> : <Bell weight="fill" />} {tr("startWatch")}
        </button>
      );
      break;
    }
  }

  return (
    <div className={`${s.card} ${s.action}`}>
      <div className={s.draftHead}>
        <Icon weight="fill" />
        <div>
          <strong>{action.title}</strong>
        </div>
        {done ? <span className={s.green}><CheckCircle weight="fill" className={s.dot} /></span> : <span className={s.okBadge}>{tr("needsOk")}</span>}
      </div>
      {main}
      {list(p, "warnings").length > 0 && (
        <ul className={s.warnings}>
          {list(p, "warnings").map((w, i) => <li key={i}>{w}</li>)}
        </ul>
      )}
      {basis.length > 0 && (
        <p className={s.basis}>
          <small>{tr("basedOn")}</small> <Sources list={basis} />
        </p>
      )}
      {failed}
      <div className={s.draftActions}>{actions}</div>
    </div>
  );
}
