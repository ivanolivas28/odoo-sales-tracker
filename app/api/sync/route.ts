import { NextResponse } from "next/server";
import { runSync } from "@/lib/leadEngine";

export async function POST() {
  try {
    const summary = await runSync();
    return NextResponse.json(summary);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Sync failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
