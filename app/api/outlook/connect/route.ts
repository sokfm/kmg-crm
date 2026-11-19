import { NextResponse } from "next/server";
import { requireProfile } from "@/lib/auth";
import { authorizeUrl } from "@/lib/mail/microsoft";

// Ξεκινά τη σύνδεση με το Outlook: στέλνει τον χρήστη στη σελίδα της Microsoft.
export async function GET(request: Request) {
  await requireProfile();
  const origin = new URL(request.url).origin;
  const state = crypto.randomUUID();
  const res = NextResponse.redirect(authorizeUrl(`${origin}/api/outlook/callback`, state));
  res.cookies.set("ms_state", state, { httpOnly: true, secure: true, sameSite: "lax", maxAge: 600, path: "/" });
  return res;
}
