// Sending a viewing request, in TEST MODE ONLY: every email goes to MAIL_TEST_TO (our own inbox),
// never to the landlord. The address the listing gave is written into the subject and the first
// lines so the test shows exactly who would have received it. Resend REST API, no SDK.
//   RESEND_API_KEY  – resend.com API key
//   MAIL_TEST_TO    – where test emails go (with Resend's shared sender: the account's own address)
//   MAIL_FROM       – optional sender, default "Muutto <onboarding@resend.dev>"
export type MailConfig = { configured: boolean; testTo?: string; from: string; missing: string[] };

export function mailConfig(): MailConfig {
  const missing = ["RESEND_API_KEY", "MAIL_TEST_TO"].filter((k) => !process.env[k]?.trim());
  return { configured: !missing.length, testTo: process.env.MAIL_TEST_TO?.trim() || undefined, from: process.env.MAIL_FROM?.trim() || "Muutto <onboarding@resend.dev>", missing };
}

export type SentMail = { id: string; testTo: string; intendedTo?: string; subject: string; sentAt: string };

export async function sendTestMail(m: { intendedTo?: string; subject: string; body: string; listingUrl?: string }): Promise<SentMail> {
  const cfg = mailConfig();
  if (!cfg.configured) throw new Error(`Email is not set up: add ${cfg.missing.join(" and ")} to .env.local`);
  const intended = m.intendedTo?.trim() || "no email in the listing";
  const subject = `[TEST → ${intended}] ${m.subject}`.slice(0, 250);
  const text = [
    "TEST MODE: this email was NOT sent to the landlord.",
    `It would have gone to: ${intended}`,
    m.listingUrl ? `Listing: ${m.listingUrl}` : null,
    "",
    "———",
    "",
    m.body,
  ]
    .filter((l) => l !== null)
    .join("\n");
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: cfg.from, to: [cfg.testTo], subject, text }),
    signal: AbortSignal.timeout(15_000),
  });
  const j = (await res.json().catch(() => ({}))) as { id?: string; message?: string; name?: string };
  if (!res.ok || !j.id) throw new Error(`Resend: ${j.message ?? j.name ?? `HTTP ${res.status}`}`);
  return { id: j.id, testTo: cfg.testTo!, intendedTo: m.intendedTo, subject, sentAt: new Date().toISOString() };
}
