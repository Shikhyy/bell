import { NextResponse, type NextRequest } from "next/server";
import { BellError, TOOLS, calibration, history, liquidations, pretrade, quote, quotes, risk, session, type Position } from "@/lib/signals";

export const dynamic = "force-dynamic";

const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type" };
const ok = (data: unknown) => NextResponse.json(data, { headers: { ...CORS, "Cache-Control": "no-store" } });
const fail = (status: number, message: string) => NextResponse.json({ error: message }, { status, headers: CORS });

async function run(tool: string, q: URLSearchParams, body: unknown) {
  const sym = q.get("symbol") ?? "";
  switch (tool) {
    case "tools": return { tools: TOOLS, docs: "/agents" };
    case "session": return session();
    case "quotes": return quotes();
    case "quote": return quote(sym);
    case "risk": return risk(sym, q.has("confidence") ? Number(q.get("confidence")) : 0.95);
    case "pretrade": return pretrade(sym, (q.get("side") ?? "buy") as "buy" | "sell", Number(q.get("size") ?? 10000));
    case "history": return history(sym, Number(q.get("n") ?? 12));
    case "calibration": return calibration();
    case "liquidations": {
      const positions = (body as { positions?: Position[] } | null)?.positions;
      return liquidations(positions ?? []);
    }
    default: throw new BellError(`Unknown tool "${tool}". See /api/v1/tools`);
  }
}

async function handle(req: NextRequest, tool: string, body: unknown) {
  try {
    return ok(await run(tool, req.nextUrl.searchParams, body));
  } catch (e) {
    if (e instanceof BellError) return fail(400, e.message);
    console.error(`[api] ${tool}:`, e);
    return fail(502, "Upstream data unavailable, try again shortly.");
  }
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ tool: string }> }) {
  return handle(req, (await params).tool, null);
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ tool: string }> }) {
  let body: unknown = null;
  try { body = await req.json(); } catch { return fail(400, "Body must be JSON"); }
  return handle(req, (await params).tool, body);
}

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}
