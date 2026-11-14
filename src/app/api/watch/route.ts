import { NextResponse } from "next/server";
import { createCompanyMonitor, monitorRuns, triggerMonitor } from "@/lib/exa";

// POST {name, domain} -> creates a daily Exa Monitor for news/complaints about the company.
export async function POST(req: Request) {
  const { name, domain } = (await req.json()) as { name?: string; domain?: string };
  if (!name) return NextResponse.json({ error: "name required" }, { status: 400 });
  const origin = process.env.PUBLIC_BASE_URL ?? new URL(req.url).origin;
  try {
    const m = await createCompanyMonitor(name, domain, `${origin}/api/exa-webhook`);
    await triggerMonitor(m.id).catch(() => null);
    // webhookSecret is returned once; keep it server-side only.
    return NextResponse.json({ id: m.id, status: m.status, name: m.name });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

// GET ?id= -> latest runs (lets the UI show results without a public webhook).
export async function GET(req: Request) {
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  try {
    return NextResponse.json(await monitorRuns(id));
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
