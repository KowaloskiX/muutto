import { getMoreRun, startMoreRun } from "@/lib/exa-agent";

// POST {job, city, exclude[]} -> {id, criteria}; GET ?id=agent_run_... -> MoreRun
export async function POST(req: Request) {
  try {
    const { job, city, exclude } = (await req.json()) as { job?: string; city?: string; exclude?: { name: string; website?: string }[] };
    if (!job?.trim()) return Response.json({ error: "job is required" }, { status: 400 });
    const started = await startMoreRun({ job, city: city?.trim() || "Espoo", exclude: (exclude ?? []).slice(0, 30) });
    return Response.json(started);
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 502 });
  }
}

export async function GET(req: Request) {
  const id = new URL(req.url).searchParams.get("id");
  if (!id || !/^[A-Za-z0-9_.:-]+$/.test(id)) return Response.json({ error: "id is required" }, { status: 400 });
  try {
    return Response.json(await getMoreRun(id), { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 502 });
  }
}
