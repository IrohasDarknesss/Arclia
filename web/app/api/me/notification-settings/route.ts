import { NextRequest } from "next/server";
import { dbQuery } from "@/lib/server/db";
import { ensureUserRow, requireAuthenticatedUser } from "@/lib/server/auth";
import {
  ApiError,
  handleApiRoute,
  jsonSuccess,
} from "@/lib/server/http/errors";

export async function GET(req: NextRequest) {
  return handleApiRoute(async () => {
    const user = await requireAuthenticatedUser(req);
    await ensureUserRow(user.id);

    const res = await dbQuery<{
      digest_enabled: boolean;
      updated_at: Date;
    }>(
      `
      SELECT digest_enabled, updated_at
      FROM user_notification_settings
      WHERE user_id = $1::uuid
      `,
      [user.id],
    );

    if (res.rows.length === 0) {
      return jsonSuccess({
        digestEnabled: false,
        updatedAt: null,
      });
    }

    const row = res.rows[0];
    return jsonSuccess({
      digestEnabled: Boolean(row.digest_enabled),
      updatedAt: new Date(row.updated_at).toISOString(),
    });
  });
}

export async function PUT(req: NextRequest) {
  return handleApiRoute(async () => {
    const user = await requireAuthenticatedUser(req);
    await ensureUserRow(user.id);

    let body: { digestEnabled?: unknown };
    try {
      body = (await req.json()) as { digestEnabled?: unknown };
    } catch {
      throw new ApiError(400, "VALIDATION_ERROR", "リクエストボディのJSON形式が不正です。");
    }

    if (typeof body.digestEnabled !== "boolean") {
      throw new ApiError(
        400,
        "VALIDATION_ERROR",
        "digestEnabledは真偽値（trueまたはfalse）で指定してください。",
      );
    }

    const res = await dbQuery<{
      digest_enabled: boolean;
      updated_at: Date;
    }>(
      `
      INSERT INTO user_notification_settings (user_id, digest_enabled, updated_at)
      VALUES ($1::uuid, $2, CURRENT_TIMESTAMP)
      ON CONFLICT (user_id) DO UPDATE
      SET digest_enabled = EXCLUDED.digest_enabled,
          updated_at     = CURRENT_TIMESTAMP
      RETURNING digest_enabled, updated_at
      `,
      [user.id, body.digestEnabled],
    );

    const row = res.rows[0];
    return jsonSuccess({
      digestEnabled: Boolean(row.digest_enabled),
      updatedAt: new Date(row.updated_at).toISOString(),
    });
  });
}
