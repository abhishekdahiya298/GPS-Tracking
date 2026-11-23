import { NextResponse } from "next/server";
import { getAuth } from "./auth";

/** Signs the new owner in right after sign-up: the auth server's cookies are passed on. */
export async function signedInResponse(request: Request, email: string, password: string, body: unknown): Promise<NextResponse> {
  const res = (await getAuth().api.signInEmail({ body: { email, password }, headers: request.headers, asResponse: true })) as Response;
  const out = NextResponse.json({ ...(body as object), signedIn: res.ok }, { status: 201 });
  for (const c of res.headers.getSetCookie()) out.headers.append("set-cookie", c);
  return out;
}
