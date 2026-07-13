import { NextRequest, NextResponse } from "next/server";
import { handleGoogleCallback } from "@/lib/google";

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  if (!code) {
    return NextResponse.redirect(new URL("/?google=error", request.url));
  }

  try {
    await handleGoogleCallback(code);
    return NextResponse.redirect(new URL("/?google=connected", request.url));
  } catch (err) {
    const message = err instanceof Error ? err.message : "Google connection failed";
    return NextResponse.redirect(new URL(`/?google=error&message=${encodeURIComponent(message)}`, request.url));
  }
}
