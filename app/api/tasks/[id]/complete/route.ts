import { NextResponse } from "next/server";
import { completeTask } from "@/lib/leadEngine";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const task = await completeTask(id);
    return NextResponse.json({ task });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to complete task";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
