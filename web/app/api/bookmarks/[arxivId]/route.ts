import { NextRequest, NextResponse } from "next/server";
import { dbQuery } from "@/lib/server/db";
import { ensureUserRow, requireAuthenticatedUser } from "@/lib/server/auth";
import {
  decodeRouteArxivId,
  validateBaseArxivId,
} from "@/lib/server/arxiv/id";
import { handleApiRoute } from "@/lib/server/http/errors";

export async function DELETE(
  req: NextRequest,
  context: { params: { arxivId: string } },
) {
  return handleApiRoute(async () => {
    const user = await requireAuthenticatedUser(req);
    await ensureUserRow(user.id);

    const rawId = decodeRouteArxivId(context.params.arxivId);
    const arxivId = validateBaseArxivId(rawId);

    // BE.F07 DA003: Idempotent DELETE (returns 204 even if already removed)
    await dbQuery(
      `
      DELETE FROM bookmarks b
      USING papers p
      WHERE b.paper_id = p.id
        AND b.user_id = $1::uuid
        AND p.arxiv_id = $2
      `,
      [user.id, arxivId],
    );

    return new NextResponse(null, { status: 204 });
  });
}
