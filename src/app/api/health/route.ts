import { sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { aiConfigured } from "@/server/ai";
import { checkRlsEffective } from "@/db/safety";

export async function GET() {
  try {
    await getDb().execute(sql`select 1`);
    return NextResponse.json({ ok: true, db: true, rls: (await checkRlsEffective()).ok, ai: aiConfigured() });
  } catch {
    return NextResponse.json({ ok: false, db: false }, { status: 503 });
  }
}
