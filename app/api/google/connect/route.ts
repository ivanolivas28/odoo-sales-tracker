import { NextResponse } from "next/server";
import { buildGoogleAuthUrl } from "@/lib/google";

export async function GET() {
  return NextResponse.redirect(buildGoogleAuthUrl());
}
