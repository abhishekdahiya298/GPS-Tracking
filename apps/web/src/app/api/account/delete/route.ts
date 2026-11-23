import { NextResponse } from "next/server";
import { deleteOwnAccount, DeleteAccountSchema } from "@/lib/account-delete";
import { requireAuthenticatedUser } from "@/lib/authz";
import { assertSameOrigin } from "@/lib/csrf";
import { errorResponse } from "@/lib/errors";
import { readJson, requestMeta } from "@/lib/request-meta";
import { parseOrThrow } from "@/lib/vehicles";

export const dynamic = "force-dynamic";

/** POST /api/account/delete: the signed-in person deletes their own account (password + typed DELETE). */
export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const user = await requireAuthenticatedUser(request);
    const result = await deleteOwnAccount(user.userId, parseOrThrow(DeleteAccountSchema, await readJson(request)), requestMeta(request));
    const res = NextResponse.json(result);
    // The session row is gone with the user; clear the cookie too.
    for (const name of ["rio.session_token", "__Secure-rio.session_token"]) res.cookies.set(name, "", { path: "/", maxAge: 0 });
    return res;
  } catch (err) {
    return errorResponse(err, { route: "account.delete" });
  }
}
