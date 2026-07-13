import { NextResponse } from "next/server";
import { getGoogleStatus } from "@/lib/google";

export async function GET() {
  const status = await getGoogleStatus();
  return NextResponse.json(status);
}
