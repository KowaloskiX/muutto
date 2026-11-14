import { NextResponse } from "next/server";
import { mailConfig, sendTestMail } from "@/lib/move/mail";

// GET  /api/move/send -> { configured, testTo, missing }  (is test email set up?)
// POST /api/move/send { to?, subject, body, listingUrl? } -> SentMail. Always to MAIL_TEST_TO.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const { configured, testTo, missing } = mailConfig();
  return NextResponse.json({ configured, testTo, missing });
}

export async function POST(req: Request) {
  const b = (await req.json().catch(() => ({}))) as { to?: string; subject?: string; body?: string; listingUrl?: string };
  const subject = String(b.subject ?? "").trim().slice(0, 200);
  const body = String(b.body ?? "").trim().slice(0, 8000);
  if (!subject || !body) return NextResponse.json({ error: "Subject and body are required." }, { status: 400 });
  try {
    return NextResponse.json(await sendTestMail({ intendedTo: b.to, subject, body, listingUrl: b.listingUrl }));
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
