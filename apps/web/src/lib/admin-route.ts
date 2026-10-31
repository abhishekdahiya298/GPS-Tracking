import { NextResponse } from "next/server";
import { z } from "zod";
import { requireSuperAdmin } from "./admin-guard";
import type { AuthenticatedUser } from "./authz";
import { assertSameOrigin } from "./csrf";
import { errorResponse, NotFoundError } from "./errors";
import { readJson, requestMeta } from "./request-meta";
import { parseOrThrow } from "./vehicles";

type Meta = ReturnType<typeof requestMeta>;
type Params = { params: Promise<Record<string, string>> };

/**
 * A platform-admin write endpoint: same-origin check, platform admin check, every path id
 * validated as a UUID (an invalid one answers 404 like an unknown one), JSON body parsed with
 * the schema. Never cached.
 */
export function platformWrite<S extends z.ZodTypeAny, R>(
  route: string,
  schema: S | null,
  handler: (a: { user: AuthenticatedUser; ids: Record<string, string>; body: z.infer<S>; meta: Meta }) => Promise<R>,
  opts: { status?: number; notFound?: string } = {}
) {
  return async (request: Request, ctx: Params) => {
    try {
      assertSameOrigin(request);
      const user = await requireSuperAdmin(request);
      const ids = (await ctx?.params) ?? {};
      for (const v of Object.values(ids)) if (!z.string().uuid().safeParse(v).success) throw new NotFoundError(opts.notFound ?? "Not found");
      const body = schema ? parseOrThrow(schema, await readJson(request)) : (undefined as z.infer<S>);
      const out = await handler({ user, ids, body, meta: requestMeta(request) });
      if (out === undefined) return new NextResponse(null, { status: 204 });
      return NextResponse.json(out, { status: opts.status ?? 200, headers: { "Cache-Control": "no-store" } });
    } catch (err) {
      return errorResponse(err, { route });
    }
  };
}
