"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowUp, NotePencil, Paperclip, ShieldCheck, SquaresFour } from "@phosphor-icons/react";
import type { Ranked } from "@/lib/rationale";
import type { QuoteInput, QuoteRow, Recommendation } from "@/lib/compare";
import type { QuoteReport } from "@/lib/quote";
import { SAMPLE_QUOTE } from "@/components/QuoteChecker";
import { keywordIntent, type ChatIntent } from "./intent";
import { CheckingCard, CompanyCard, CompareCard, DraftCard, ExaBadge, QuoteCheckCard, Sources, WatchCard, companyKey, host } from "./Bubbles";
import { EMPTY_CTX, type Action, type Chip, type Ctx, type Draft, type Msg, type NewMsg } from "./types";
import s from "./Chat.module.css";

const STORE = "kilpi-chat-v1";
const uid = () => Math.random().toString(36).slice(2, 10);

// Second, well-formed demo quote so a comparison has a real choice (mirrors QuoteCompare's sample).
const SAMPLE_QUOTE_GOOD = `TARJOUS 14.11.2026
LVI-Vesiniitty Oy, Y-tunnus 2941791-8, www.vesiniitty.fi

Kohde: kylpyhuoneen putkiremontti ja vedeneristys, kerrostaloasunto 6 m², Espoo

Hinta-erittely (sis. ALV 25,5 %):
- Työn osuus 7 900 € (kotitalousvähennyskelpoinen)
- Tarvikkeet ja materiaalit 5 600 €
Yhteensä 13 500 € sis. ALV 25,5 %

Maksuerät: 20 % töiden alkaessa, 50 % kun putkityöt valmiit, 30 % vastaanoton jälkeen.
Sopimusehdot: KSE 2013. Takuu 2 vuotta työlle, vedeneristykselle sertifioitu asennus.

Ystävällisin terveisin, LVI-Vesiniitty Oy`;

const EXAMPLE = "Need someone to reline the pipes in my Espoo flat, English speaking";

const welcome = (): Msg => ({
  id: uid(),
  role: "bot",
  kind: "text",
  text: "Hi, I'm Kilpi. Tell me what needs doing at home. I'll find contractors, check them against the trade register and their own sites, and get quotes for you. Nothing goes out without your OK.",
  chips: [
    { label: "Reline the pipes in my Espoo flat", action: "example", payload: EXAMPLE, primary: true },
    { label: "Load demo quotes", action: "demo_quotes" },
  ],
});

const isQuoteText = (t: string) => t.length > 160 && /tarjous|urakka|y-tunnus|alv|€|maksuehdot|quote/i.test(t);

function quoteMeta(text: string, n: number): QuoteInput {
  const line = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find((l) => /\b(Oy|Ab|Ky|Tmi|Oyj)\b/.test(l) && !/^(asiakas|kohde|ystävällisin)/i.test(l));
  const company = line?.split(/,|·|\bY-tunnus/i)[0].replace(/^ystävällisin terveisin,?\s*/i, "").trim() || `Quote ${n}`;
  const w = text.match(/(?:https?:\/\/)?((?:www\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:fi|com|net|eu))\b/i);
  return { company, website: w ? `https://${w[1]}` : undefined, text };
}

// Exa traces are large and only useful for the classic view's debug panel: keep storage small.
const slimRanked = (r: Ranked): Ranked => ({ ...r, report: { ...r.report, trace: [] } });
const slimReport = (r: QuoteReport): QuoteReport => ({ ...r, trace: [] });

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? `Request failed (${res.status})`);
  return data as T;
}

export default function ChatApp() {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [ctx, setCtxState] = useState<Ctx>(EMPTY_CTX);
  const ctxRef = useRef<Ctx>(EMPTY_CTX);
  const [busy, setBusy] = useState(false);
  const [input, setInput] = useState("");
  const [ready, setReady] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const setCtx = useCallback((fn: (c: Ctx) => Ctx) => {
    ctxRef.current = fn(ctxRef.current);
    setCtxState(ctxRef.current);
  }, []);

  // ---- persistence -------------------------------------------------------
  useEffect(() => {
    let restored = false;
    try {
      const raw = localStorage.getItem(STORE);
      if (raw) {
        const saved = JSON.parse(raw) as { msgs: Msg[]; ctx: Ctx };
        if (Array.isArray(saved.msgs) && saved.msgs.length) {
          // Anything that was mid-flight when the tab closed is not coming back.
          const msgs = saved.msgs.map((m) =>
            m.kind === "checking" ? { ...m, items: m.items.map((i) => (i.status === "scanning" ? { ...i, status: "failed" as const } : i)) } : m,
          );
          setMsgs(msgs);
          ctxRef.current = { ...EMPTY_CTX, ...saved.ctx };
          setCtxState(ctxRef.current);
          restored = true;
        }
      }
    } catch {
      /* storage blocked or corrupt: start fresh */
    }
    if (!restored) setMsgs([welcome()]);
    setReady(true);
  }, []);

  useEffect(() => {
    if (!ready) return;
    try {
      localStorage.setItem(STORE, JSON.stringify({ msgs, ctx }));
    } catch {
      /* quota or blocked storage: chat still works in memory */
    }
  }, [msgs, ctx, ready]);

  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [msgs.length, busy]);

  // ---- message helpers ---------------------------------------------------
  const push = useCallback((m: NewMsg) => {
    const id = m.id ?? uid();
    setMsgs((prev) => [...prev, { ...m, id } as Msg]);
    return id;
  }, []);
  const patch = useCallback((id: string, fn: (m: Msg) => Msg) => setMsgs((prev) => prev.map((m) => (m.id === id ? fn(m) : m))), []);
  const say = useCallback(
    (text: string, extra: { chips?: Chip[]; tone?: "progress" | "error" | "success"; exa?: boolean; sources?: { url: string; quote?: string }[] } = {}) =>
      push({ role: "bot", kind: "text", text, ...extra }),
    [push],
  );
  const echo = useCallback((text: string, attachment?: string) => push({ role: "user", kind: "text", text, attachment }), [push]);
  const retireChips = () => setMsgs((prev) => prev.map((m) => (m.chips && !m.chipsUsed ? { ...m, chipsUsed: true } : m)));

  // ---- tools -------------------------------------------------------------
  async function runFind(query: string) {
    setCtx((c) => ({ ...c, ranked: [], selected: [] }));
    let checkingId: string | null = null;
    const checking: { name: string; domain: string; status: "scanning" | "done" | "failed" }[] = [];
    try {
      const res = await fetch("/api/find", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query }) });
      if (!res.body) throw new Error("No response from search");
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      let finished = false;
      while (!finished) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          const e = JSON.parse(line);
          if (e.type === "intent") {
            setCtx((c) => ({ ...c, job: e.service, city: e.city }));
            say(`Looking for ${e.service} companies in ${e.city}…`, { tone: "progress", exa: true });
          } else if (e.type === "stage" && e.id === "find" && e.status === "done") {
            const n = Number(/checking (\d+)/i.exec(e.detail ?? "")?.[1] ?? 0);
            const found = (e.detail ?? "").match(/\d+/g)?.slice(0, 2).reduce((a: number, b: string) => a + Number(b), 0) ?? 0;
            say(
              n
                ? `Found ${found} candidates. Checking ${n} companies against the trade register and their own sites…`
                : "I couldn't find companies for that yet. Let me double-check…",
              { tone: "progress", exa: true },
            );
          } else if (e.type === "company") {
            const i = checking.findIndex((x) => x.domain === e.domain);
            const row = { name: e.report?.name ?? e.place.name, domain: e.domain, status: e.status };
            if (i < 0) checking.push(row);
            else checking[i] = row;
            const items = [...checking];
            if (!checkingId) checkingId = push({ role: "bot", kind: "checking", items });
            else patch(checkingId, (m) => ({ ...m, items }) as Msg);
          } else if (e.type === "done") {
            finished = true;
            const ranked = (e.ranked as Ranked[]).map(slimRanked);
            setCtx((c) => ({ ...c, ranked }));
            if (!ranked.length) {
              say("I couldn't find anyone I'd trust for that yet. Could you tell me a bit more, or try a nearby city?", { chips: [{ label: "Try the relining example", action: "example", payload: EXAMPLE }] });
              break;
            }
            say(`Here's who I'd trust, best fit first. ${ranked[0].report.name || ranked[0].place.name} looks strongest.`);
            ranked.slice(0, 4).forEach((item, i) => push({ role: "bot", kind: "company", item, rank: i + 1 }));
            const n = Math.min(3, ranked.length);
            say(`Want me to ask the top ${n === 1 ? "one" : n} for quotes?`, {
              chips: [
                { label: `Yes, ask top ${n}`, action: "ask_top3", primary: true },
                { label: "Pick myself", action: "pick_myself" },
                { label: "Not now", action: "not_now" },
              ],
            });
          } else if (e.type === "error") {
            throw new Error(e.message);
          }
        }
      }
    } catch (err) {
      say(`Something went wrong while searching: ${(err as Error).message}. Want to try again?`, { tone: "error", chips: [{ label: "Try again", action: "example", payload: query }] });
    }
  }

  async function runDrafts(companies: Ranked[]) {
    const c = ctxRef.current;
    const job = [c.job, c.city && `in ${c.city}`].filter(Boolean).join(" ") || "home repair job";
    try {
      const { drafts } = await postJson<{ drafts: Omit<Draft, "lang">[] }>("/api/draft", {
        job,
        companies: companies.map((r) => ({
          name: r.report.name || r.place.name,
          email: r.report.contact.emails[0],
          concerns: r.why.filter((w) => w.status === "yellow" || w.status === "red").map((w) => w.sentence),
        })),
      });
      say(`Here ${drafts.length === 1 ? "is the draft" : `are ${drafts.length} drafts`}. I added questions about anything that looked off. Nothing is sent until you tap Approve and send.`);
      drafts.forEach((d) => push({ role: "bot", kind: "draft", draft: { ...d, lang: "en" } }));
      say("When quotes come back, paste them here and I'll compare them.", {
        chips: [
          { label: "Load demo quotes", action: "demo_quotes", primary: true },
          { label: "I'll paste one", action: "paste_another" },
        ],
      });
    } catch (err) {
      say(`I couldn't draft the requests: ${(err as Error).message}`, { tone: "error", chips: [{ label: "Try again", action: "ask_top3" }] });
    }
  }

  async function runQuotes(added: QuoteInput[]) {
    const known = new Set(ctxRef.current.quotes.map((q) => q.text));
    const fresh = added.filter((q) => !known.has(q.text));
    setCtx((c) => ({ ...c, quotes: [...c.quotes, ...fresh].slice(-4) }));
    const all = ctxRef.current.quotes;
    if (all.length === 1) {
      const q = all[0];
      say(`Checking ${q.company}'s quote: business ID, payment terms, VAT and their claims against the register, their site and consumer guidance…`, { tone: "progress", exa: true });
      try {
        const report = slimReport(await postJson<QuoteReport>("/api/check-quote", { text: q.text, website: q.website }));
        push({ role: "bot", kind: "quoteCheck", company: q.company, report });
        const reds = report.checks.filter((x) => x.status === "red").length;
        const yellows = report.checks.filter((x) => x.status === "yellow").length;
        say(
          reds
            ? `I'd hold off signing this one: ${reds} serious issue${reds > 1 ? "s" : ""}${yellows ? ` and ${yellows} thing${yellows > 1 ? "s" : ""} to clarify` : ""}. Paste the next quote when it arrives and I'll compare them.`
            : `Looks reasonable${yellows ? `, with ${yellows} thing${yellows > 1 ? "s" : ""} to clarify` : ""}. Paste the next quote when it arrives and I'll compare them.`,
          { chips: [{ label: "Load demo quotes", action: "demo_quotes" }, { label: "Paste another", action: "paste_another", primary: true }] },
        );
      } catch (err) {
        say(`I couldn't check that quote: ${(err as Error).message}`, { tone: "error" });
      }
      return;
    }
    await runCompare(all);
  }

  async function runCompare(all: QuoteInput[]) {
    say(`Comparing ${all.length} quotes: price incl. VAT, payment schedule, itemised labour, and whether each company checks out…`, { tone: "progress", exa: true });
    try {
      const out = await postJson<{ rows: QuoteRow[]; recommendation: Recommendation }>("/api/compare-quotes", { quotes: all });
      const rows = out.rows.map((r) => ({ ...r, report: slimReport(r.report) }));
      push({ role: "bot", kind: "compare", rows, recommendation: out.recommendation });
      const best = rows[out.recommendation.pick];
      if (!best) {
        say("Honestly, I wouldn't sign any of these as written. Ask each company for a staged payment schedule and itemised labour first.");
        return;
      }
      const ranked = ctxRef.current.ranked.find((r) => (r.report.name || r.place.name).toLowerCase() === best.company.toLowerCase());
      const domain = host(best.website ?? best.report.company?.website ?? ranked?.place.website);
      setCtx((c) => ({ ...c, pick: { name: best.company, domain: domain || undefined } }));
      say(`${best.company} is the safer hire. Want me to go with them?`, {
        chips: [
          { label: `Hire ${best.company} and keep watching them`, action: "hire", primary: true },
          { label: "Not yet", action: "not_yet" },
        ],
      });
    } catch (err) {
      say(`I couldn't compare the quotes: ${(err as Error).message}`, { tone: "error" });
    }
  }

  async function runWatch() {
    const c = ctxRef.current;
    const top = c.ranked[0];
    const target = c.pick ?? (top ? { name: top.report.name || top.place.name, domain: host(top.place.website) || undefined } : undefined);
    if (!target) {
      say("Who should I keep an eye on? Find a contractor or paste their quotes first, and I'll watch whoever you hire.");
      return;
    }
    try {
      const out = await postJson<{ id: string; webhook: string }>("/api/watch", { name: target.name, domain: target.domain });
      setCtx((x) => ({ ...x, hired: target.name }));
      push({ role: "bot", kind: "watch", name: target.name, domain: target.domain, monitorId: out.id, mode: out.webhook });
      say(`Done. I'll keep an eye on ${target.name} until the job's done (Exa Monitor). If anything worrying shows up, you'll hear from me first.`, { tone: "success", exa: true });
    } catch (err) {
      say(`I couldn't start watching ${target.name}: ${(err as Error).message}`, { tone: "error", chips: [{ label: "Try again", action: "hire" }] });
    }
  }

  // ---- input -------------------------------------------------------------
  async function work(fn: () => Promise<void>) {
    setBusy(true);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  }

  async function send(raw: string) {
    const text = raw.trim();
    if (!text || busy) return;
    setInput("");
    retireChips();
    if (isQuoteText(text)) {
      const q = quoteMeta(text, ctxRef.current.quotes.length + 1);
      echo(text, `Quote from ${q.company}`);
      await work(() => runQuotes([q]));
      return;
    }
    echo(text);
    await work(async () => {
      const c = ctxRef.current;
      let intent: ChatIntent = keywordIntent(text);
      let reply: string | undefined;
      try {
        const r = await postJson<{ intent: ChatIntent; reply?: string }>("/api/chat-route", { text, hasShortlist: c.ranked.length > 0, quotes: c.quotes.length, hired: c.hired });
        intent = r.intent;
        reply = r.reply;
      } catch {
        /* keyword fallback already set */
      }
      if (intent === "find_contractor") return runFind(text);
      if (intent === "check_quote") {
        say("Paste the quote text (tarjous) here and I'll check it line by line.", { chips: [{ label: "Load demo quotes", action: "demo_quotes" }] });
        return;
      }
      if (intent === "compare_quotes") {
        if (c.quotes.length >= 2) return runCompare(c.quotes);
        say(c.quotes.length ? "I have one quote so far. Paste another and I'll compare them." : "Paste at least two quotes and I'll compare them.", { chips: [{ label: "Load demo quotes", action: "demo_quotes" }] });
        return;
      }
      if (intent === "watch") return runWatch();
      say(reply ?? "I'm best at home jobs: finding and vetting contractors, drafting quote requests, comparing quotes and watching whoever you hire. What needs doing?", {
        chips: [{ label: "Reline the pipes in my Espoo flat", action: "example", payload: EXAMPLE }],
      });
    });
  }

  async function onChip(msgId: string, chip: Chip) {
    if (busy) return;
    patch(msgId, (m) => ({ ...m, chipsUsed: true }));
    const act: Action = chip.action;
    const c = ctxRef.current;
    if (act === "example" || act === "find_again") return send(chip.payload ?? EXAMPLE);
    if (act === "paste_another") {
      inputRef.current?.focus();
      return;
    }
    retireChips();
    if (act === "demo_quotes") {
      const qs = [quoteMeta(SAMPLE_QUOTE, 1), quoteMeta(SAMPLE_QUOTE_GOOD, 2)];
      echo("Here are the two quotes I got back.", qs.map((q) => q.company).join(" · "));
      setCtx((x) => ({ ...x, quotes: [] }));
      return work(() => runQuotes(qs));
    }
    echo(chip.label);
    if (act === "ask_top3") return work(() => runDrafts(c.ranked.slice(0, 3)));
    if (act === "pick_myself") {
      say("Sure. Tap Pick on the companies above, then let me know.", { chips: [{ label: "Draft for my picks", action: "draft_selected", primary: true }] });
      return;
    }
    if (act === "draft_selected") {
      const picks = c.ranked.filter((r) => c.selected.includes(companyKey(r)));
      if (!picks.length) {
        say("You haven't picked anyone yet. Tap Pick on a card first.", { chips: [{ label: "Draft for my picks", action: "draft_selected", primary: true }] });
        return;
      }
      return work(() => runDrafts(picks));
    }
    if (act === "not_now") {
      say("No problem, your shortlist stays right here. When you have quotes, paste them in and I'll compare them.", { chips: [{ label: "Load demo quotes", action: "demo_quotes" }] });
      return;
    }
    if (act === "compare_now") return work(() => runCompare(c.quotes));
    if (act === "hire") return work(runWatch);
    if (act === "not_yet") say("Okay, I'll hold off. Ask me any time, or paste another quote to add it to the comparison.");
  }

  function newChat() {
    if (busy) return;
    ctxRef.current = EMPTY_CTX;
    setCtxState(EMPTY_CTX);
    setMsgs([welcome()]);
    setInput("");
  }

  const togglePick = (key: string) =>
    setCtx((c) => ({ ...c, selected: c.selected.includes(key) ? c.selected.filter((k) => k !== key) : [...c.selected, key] }));

  // ---- render ------------------------------------------------------------
  const lastChipMsg = [...msgs].reverse().find((m) => m.chips?.length && !m.chipsUsed)?.id;

  function body(m: Msg) {
    switch (m.kind) {
      case "text":
        if (m.role === "user")
          return (
            <div className={`${s.bubble} ${s.user}`}>
              {m.attachment && (
                <span className={s.attach}>
                  <Paperclip weight="bold" /> {m.attachment}
                </span>
              )}
              <span className={s.text}>{m.text.length > 220 ? `${m.text.slice(0, 200).trim()}…` : m.text}</span>
            </div>
          );
        return (
          <div className={`${s.bubble} ${s.bot} ${m.tone ? s[m.tone] : ""}`}>
            <span className={s.text}>{m.text}</span>
            {(m.sources?.length || m.exa) && (
              <span className={s.srcRow}>
                <Sources list={m.sources} />
                {m.exa && <ExaBadge />}
              </span>
            )}
          </div>
        );
      case "checking":
        return <div className={`${s.bubble} ${s.bot}`}><CheckingCard items={m.items} /></div>;
      case "company":
        return <CompanyCard item={m.item} rank={m.rank} selected={ctx.selected.includes(companyKey(m.item))} onToggle={() => togglePick(companyKey(m.item))} />;
      case "draft":
        return <DraftCard draft={m.draft} onChange={(d) => patch(m.id, (x) => ({ ...x, draft: d }) as Msg)} />;
      case "quoteCheck":
        return <QuoteCheckCard company={m.company} report={m.report} />;
      case "compare":
        return <CompareCard rows={m.rows} recommendation={m.recommendation} />;
      case "watch":
        return <WatchCard name={m.name} domain={m.domain} monitorId={m.monitorId} mode={m.mode} />;
    }
  }

  return (
    <div className={s.stage}>
      <aside className={s.aside}>
        <span className={s.asideMark}><ShieldCheck weight="fill" /></span>
        <h1>Text Kilpi the job. It does the legwork.</h1>
        <p>Finds local contractors with Exa, checks each one against the Finnish trade register and their own site, drafts your quote requests and compares the replies. You approve every step.</p>
        <Link href="/" className={s.asideLink}><SquaresFour weight="bold" /> Open the classic view</Link>
      </aside>

      <main className={s.phone} aria-label="Chat with Kilpi">
        <header className={s.header}>
          <span className={s.avatar} aria-hidden><ShieldCheck weight="fill" /></span>
          <div className={s.who}>
            <strong>Kilpi</strong>
            <small>{busy ? "working on it…" : "your contractor butler"}</small>
          </div>
          <Link href="/" className={s.headBtn} title="Classic view"><SquaresFour weight="bold" /><span>Classic</span></Link>
          <button type="button" className={s.headBtn} onClick={newChat} disabled={busy} title="New chat"><NotePencil weight="bold" /><span>New chat</span></button>
        </header>

        <div className={s.scroll} ref={scroller} role="log" aria-live="polite">
          {msgs.map((m, i) => {
            const prev = msgs[i - 1];
            const showAvatar = m.role === "bot" && prev?.role !== "bot";
            return (
              <div key={m.id} className={`${s.row} ${m.role === "user" ? s.rowUser : s.rowBot} ${prev && prev.role !== m.role ? s.gap : ""}`}>
                {m.role === "bot" && <span className={`${s.mini} ${showAvatar ? "" : s.hidden}`} aria-hidden><ShieldCheck weight="fill" /></span>}
                <div className={s.col}>
                  {body(m)}
                  {m.chips && !m.chipsUsed && m.id === lastChipMsg && (
                    <div className={s.chips}>
                      {m.chips.map((c) => (
                        <button key={c.label} type="button" className={`${s.chip} ${c.primary ? s.chipPrimary : ""}`} onClick={() => onChip(m.id, c)} disabled={busy}>
                          {c.label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
          {busy && (
            <div className={`${s.row} ${s.rowBot}`}>
              <span className={s.mini} aria-hidden><ShieldCheck weight="fill" /></span>
              <div className={`${s.bubble} ${s.bot} ${s.typing}`} aria-label="Kilpi is typing"><i /><i /><i /></div>
            </div>
          )}
        </div>

        <form
          className={s.composer}
          onSubmit={(e) => {
            e.preventDefault();
            send(input);
          }}
        >
          <textarea
            ref={inputRef}
            value={input}
            rows={1}
            placeholder={ctx.ranked.length ? "Message Kilpi, or paste a quote…" : "What needs doing?"}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                send(input);
              }
            }}
            aria-label="Message"
          />
          <button type="submit" className={s.sendBtn} disabled={busy || !input.trim()} aria-label="Send"><ArrowUp weight="bold" /></button>
        </form>
      </main>
    </div>
  );
}
