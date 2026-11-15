"use client";

// "Apply to my 5 best flats": the agent researches each landlord (Exa), writes a tailored application
// (FI/EN) from the listing, the request and the user's profile, and lines them up as an outbox. Nothing
// leaves without the user's approval; approved messages go to our own inbox (test mode). Each card
// then tracks the reply (pasted) and the viewing in the calendar.
import { useEffect, useState } from "react";
import { ArrowUpRight, Check, CircleNotch, EnvelopeSimple, PaperPlaneTilt, UserCircle } from "@phosphor-icons/react";
import type { Application, Area, Listing, MoveIntent, TenantProfile } from "@/lib/move/types";
import { ViewingCalendar } from "./Calendar";
import { host, price } from "./model";
import x from "./Move.module.css";

type Card = { listing: Listing; area: Area; app?: Application; error?: string; status: "drafting" | "draft" | "sending" | "sent" | "failed"; lang: "fi" | "en"; sentAt?: string; sendError?: string };
const PROFILE_KEY = "muutto:profile";

/** The 5 best flats to apply to: best areas first, within budget, with someone to contact. */
export function bestFlats(ranked: Area[], intent?: MoveIntent): { listing: Listing; area: Area }[] {
  const cap = intent?.budget;
  const out: { listing: Listing; area: Area }[] = [];
  const fits = (l: Listing) => !cap || !l.price || l.price <= cap;
  // Pass 1: one per area with a named agency/landlord (so there is someone to research); pass 2: any
  // contact; pass 3: anything within budget. Best areas first, cheapest first within an area.
  const passes: ((l: Listing) => boolean)[] = [(l) => !!l.contact?.company, (l) => !!(l.contact?.email || l.contact?.formUrl || l.contact?.name), () => true];
  for (const pass of passes)
    for (const area of ranked)
      for (const l of [...area.listings].sort((a, b) => (a.price ?? 9e9) - (b.price ?? 9e9)))
        if (out.length < 5 && pass(l) && fits(l) && !out.some((o) => o.listing.url === l.url) && (pass !== passes[0] || !out.some((o) => o.area.id === area.id))) out.push({ listing: l, area });
  return out;
}

export function Applications({ ranked, intent, start, onOpen }: { ranked: Area[]; intent?: MoveIntent; start: number; onOpen: (l: Listing, a: Area) => void }) {
  const [profile, setProfile] = useState<TenantProfile>({});
  const [editing, setEditing] = useState(false);
  const [cards, setCards] = useState<Card[]>([]);
  const [running, setRunning] = useState(false);
  useEffect(() => {
    try {
      const p = JSON.parse(localStorage.getItem(PROFILE_KEY) || "{}") as TenantProfile;
      setProfile({ employer: intent?.work?.label?.split(",")[0], ...p });
    } catch {
      /* ignore */
    }
  }, [intent?.work?.label]);
  const saveProfile = (p: TenantProfile) => {
    setProfile(p);
    try {
      localStorage.setItem(PROFILE_KEY, JSON.stringify(p));
    } catch {
      /* ignore */
    }
  };
  const patch = (url: string, fn: (c: Card) => Card) => setCards((cs) => cs.map((c) => (c.listing.url === url ? fn(c) : c)));

  const prepare = async () => {
    const picks = bestFlats(ranked, intent);
    if (!picks.length || running) return;
    setRunning(true);
    setCards(picks.map((p) => ({ ...p, status: "drafting", lang: "fi" })));
    try {
      const res = await fetch("/api/move/apply", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ listings: picks.map((p) => p.listing), intent, profile }) });
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let i;
        while ((i = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, i).trim();
          buf = buf.slice(i + 1);
          if (!line) continue;
          const e = JSON.parse(line) as { type: string; application?: Application; listingUrl?: string; message?: string };
          if (e.type === "application" && e.application) patch(e.application.listingUrl, (c) => ({ ...c, app: e.application, status: "draft" }));
          if (e.type === "error" && e.listingUrl) patch(e.listingUrl, (c) => ({ ...c, status: "failed", error: e.message }));
        }
      }
    } catch (e) {
      setCards((cs) => cs.map((c) => (c.status === "drafting" ? { ...c, status: "failed", error: (e as Error).message } : c)));
    }
    setRunning(false);
  };
  // The chat chip / tour asks for it: start once per request.
  useEffect(() => {
    if (start) void prepare();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [start]);

  const approve = async (c: Card) => {
    if (!c.app || c.status === "sending" || c.status === "sent") return;
    patch(c.listing.url, (k) => ({ ...k, status: "sending", sendError: undefined }));
    const body = c.lang === "fi" ? c.app.bodyFi : c.app.bodyEn;
    try {
      const r = await fetch("/api/move/send", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ to: c.app.to, subject: c.app.subject, body, listingUrl: c.listing.url }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
      patch(c.listing.url, (k) => ({ ...k, status: "sent", sentAt: j.sentAt }));
    } catch (e) {
      patch(c.listing.url, (k) => ({ ...k, status: "draft", sendError: (e as Error).message }));
    }
  };
  const drafts = cards.filter((c) => c.status === "draft");
  const sent = cards.filter((c) => c.status === "sent").length;

  return (
    <section className={x.apps} aria-labelledby="move-apps" data-tour="applications">
      <div className={x.appsHead}>
        <div>
          <h2 id="move-apps">Applications</h2>
          <p>Pukki researches each landlord and writes a tailored application. You approve every message; in this demo it goes to your own inbox.</p>
        </div>
        <div className={x.appsActions}>
          <button type="button" className={x.ghostBtn} onClick={() => setEditing((v) => !v)}>
            <UserCircle aria-hidden /> {profile.name ? profile.name : "Your details"}
          </button>
          {cards.length === 0 || (!running && drafts.length === 0 && sent === cards.length) ? (
            <button type="button" className={x.lcPrimary} onClick={() => void prepare()} disabled={running || !ranked.length}>
              <PaperPlaneTilt aria-hidden /> Apply to my 5 best flats
            </button>
          ) : drafts.length > 1 ? (
            <button type="button" className={x.lcPrimary} onClick={() => drafts.forEach((c) => void approve(c))}>
              <Check aria-hidden /> Approve all {drafts.length}
            </button>
          ) : null}
        </div>
      </div>
      {editing && (
        <form
          className={x.profile}
          onSubmit={(e) => {
            e.preventDefault();
            setEditing(false);
          }}
        >
          {(
            [
              ["name", "Name"],
              ["email", "Email"],
              ["phone", "Phone"],
              ["employer", "Employer"],
              ["startDate", "Start date"],
              ["household", "Household"],
              ["income", "Monthly income (optional)"],
            ] as const
          ).map(([k, label]) => (
            <label key={k}>
              <span>{label}</span>
              <input value={(profile[k] as string) ?? ""} onChange={(e) => saveProfile({ ...profile, [k]: e.target.value })} />
            </label>
          ))}
          <label className={x.profileCheck}>
            <input type="checkbox" checked={profile.pets === "none"} onChange={(e) => saveProfile({ ...profile, pets: e.target.checked ? "none" : "yes" })} /> No pets
          </label>
          <label className={x.profileCheck}>
            <input type="checkbox" checked={profile.smoking === "no"} onChange={(e) => saveProfile({ ...profile, smoking: e.target.checked ? "no" : "yes" })} /> Non-smoker
          </label>
          <label className={x.profileCheck}>
            <input type="checkbox" checked={!!profile.creditOk} onChange={(e) => saveProfile({ ...profile, creditOk: e.target.checked })} /> Clean credit record
          </label>
          <button type="submit" className={x.ghostBtn}>
            Done
          </button>
        </form>
      )}
      {cards.length > 0 && (
        <ol className={x.appList}>
          {cards.map((c) => {
            const a = c.app;
            const i = a?.intel;
            return (
              <li key={c.listing.url} className={x.appCard}>
                <div className={x.appTop}>
                  {c.listing.photos?.[0] ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={c.listing.photos[0]} alt="" />
                  ) : (
                    <span className={x.appNoImg} />
                  )}
                  <div className={x.appWho}>
                    <button type="button" className={x.appTitle} onClick={() => onOpen(c.listing, c.area)}>
                      {c.listing.address || c.listing.title}
                    </button>
                    <small>
                      {[price(c.listing, intent?.tenure), c.area.name, i?.name || c.listing.contact?.company].filter(Boolean).join(" · ")}
                    </small>
                  </div>
                  <span className={`${x.appStatus} ${x[`as_${c.status}`]}`}>
                    {c.status === "drafting" ? (
                      <>
                        <CircleNotch className={x.spin} aria-hidden /> Researching
                      </>
                    ) : c.status === "draft" ? (
                      "Needs approval"
                    ) : c.status === "sending" ? (
                      "Sending…"
                    ) : c.status === "sent" ? (
                      <>
                        <Check weight="bold" aria-hidden /> Sent
                      </>
                    ) : (
                      "Failed"
                    )}
                  </span>
                </div>
                {c.error && <p className={x.errLine}>{c.error}</p>}
                {i && (i.requirements.length > 0 || i.apply) && (
                  <div className={x.appIntel}>
                    <h4>What {i.name} asks of tenants</h4>
                    <ul>
                      {i.requirements.map((r) => (
                        <li key={r.quote}>
                          <span>{r.what}</span>
                          <a href={r.url} target="_blank" rel="noreferrer" title={`“${r.quote}”`}>
                            {host(r.url)} <ArrowUpRight weight="bold" aria-hidden />
                          </a>
                        </li>
                      ))}
                      {i.apply?.how && (
                        <li>
                          <span>How to apply: {i.apply.how}</span>
                          {i.apply.url && (
                            <a href={i.apply.url} target="_blank" rel="noreferrer">
                              {host(i.apply.url)} <ArrowUpRight weight="bold" aria-hidden />
                            </a>
                          )}
                        </li>
                      )}
                    </ul>
                  </div>
                )}
                {a && (
                  <div className={x.appMsg}>
                    <div className={x.appMsgTop}>
                      <span>
                        <EnvelopeSimple aria-hidden /> To {a.to ?? (a.formUrl ? "the listing's contact form" : "the agent (no email in the listing)")}
                      </span>
                      <span className={x.langToggle}>
                        {(["fi", "en"] as const).map((l) => (
                          <button key={l} type="button" className={c.lang === l ? x.on : ""} onClick={() => patch(c.listing.url, (k) => ({ ...k, lang: l }))}>
                            {l.toUpperCase()}
                          </button>
                        ))}
                      </span>
                    </div>
                    <strong>{a.subject}</strong>
                    <pre>{c.lang === "fi" ? a.bodyFi : a.bodyEn}</pre>
                    {(a.addressed.length > 0 || a.missing.length > 0) && (
                      <p className={x.appCover}>
                        {a.addressed.length > 0 && <span>Covers: {a.addressed.slice(0, 4).join(", ")}</span>}
                        {a.missing.length > 0 && <span className={x.appMissing}>Add before sending: {a.missing.join(", ")}</span>}
                      </p>
                    )}
                    <div className={x.appBtns}>
                      {c.status !== "sent" ? (
                        <button type="button" className={x.lcPrimary} onClick={() => void approve(c)} disabled={c.status === "sending"}>
                          <Check aria-hidden /> Approve and send
                        </button>
                      ) : (
                        <span className={x.okWord}>
                          Sent {c.sentAt ? new Date(c.sentAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }) : ""} to your inbox · would have gone to {a.to ?? "the agent"}
                        </span>
                      )}
                      {c.sendError && <span className={x.errLine}>{c.sendError}</span>}
                    </div>
                    {c.status === "sent" && <ViewingCalendar l={c.listing} area={c.area} intent={intent} />}
                  </div>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
