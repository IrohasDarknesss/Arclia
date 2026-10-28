import { withTransaction, dbQuery } from "@/lib/server/db";
import { ApiError } from "@/lib/server/http/errors";

export type ProFeatureName = "ai_chat" | "paper_compare";

export interface UsageReservationResult {
  reservationId: string;
  used: number;
  limit: number;
  remaining: number;
  resetAt: string;
}

export function getProMonthlyLimit(): number {
  const raw = parseInt(process.env.PRO_MONTHLY_LIMIT_PER_FEATURE || "100", 10);
  return Number.isFinite(raw) && raw >= 1 ? raw : 100;
}

export function getJstMonthWindow(now = new Date()): {
  periodStart: string;
  resetAtIso: string;
} {
  // Compute current calendar month in JST (UTC+9)
  const jstMs = now.getTime() + 9 * 60 * 60 * 1000;
  const jstDate = new Date(jstMs);
  const year = jstDate.getUTCFullYear();
  const month = jstDate.getUTCMonth(); // 0-indexed

  const pad2 = (n: number) => String(n).padStart(2, "0");
  const periodStart = `${year}-${pad2(month + 1)}-01`;

  const nextYear = month === 11 ? year + 1 : year;
  const nextMonth = month === 11 ? 1 : month + 2;
  const resetAtIso = `${nextYear}-${pad2(nextMonth)}-01T00:00:00+09:00`;

  return { periodStart, resetAtIso };
}

export async function reserveFeatureUsage(
  userId: string,
  feature: ProFeatureName,
): Promise<UsageReservationResult> {
  const limit = getProMonthlyLimit();
  const { periodStart, resetAtIso } = getJstMonthWindow();

  return withTransaction(async (client) => {
    // 1. Lock user row and verify Pro plan (BE.F18 DA001)
    const userRes = await client.query<{ user_id: string; plan: string }>(
      `
      SELECT user_id, plan
      FROM users
      WHERE user_id = $1::uuid
      FOR UPDATE
      `,
      [userId],
    );

    if (userRes.rows.length === 0 || userRes.rows[0].plan !== "pro") {
      throw new ApiError(
        403,
        "PRO_REQUIRED",
        "この機能はProプラン限定です。料金プランページからアップグレードしてください。",
      );
    }

    // 2. Count active reservations in current JST month (BE.F18 DA002)
    const countRes = await client.query<{ used_count: number }>(
      `
      SELECT COUNT(*)::int AS used_count
      FROM pro_feature_usages
      WHERE user_id = $1::uuid
        AND feature = $2
        AND period_start = $3::date
        AND released_at IS NULL
      `,
      [userId, feature, periodStart],
    );

    const usedBefore = countRes.rows[0]?.used_count ?? 0;
    if (usedBefore >= limit) {
      throw new ApiError(
        429,
        "PRO_QUOTA_EXCEEDED",
        "今月のPro機能の利用上限に達しました。毎月1日 00:00 (JST) にリセットされます。",
        {
          usage: {
            feature,
            used: usedBefore,
            limit,
            remaining: 0,
            resetAt: resetAtIso,
          },
        },
      );
    }

    // 3. Insert usage reservation (BE.F18 DA003)
    const insertRes = await client.query<{ id: string }>(
      `
      INSERT INTO pro_feature_usages (user_id, feature, period_start)
      VALUES ($1::uuid, $2, $3::date)
      RETURNING id
      `,
      [userId, feature, periodStart],
    );

    const usedAfter = usedBefore + 1;
    return {
      reservationId: insertRes.rows[0].id,
      used: usedAfter,
      limit,
      remaining: Math.max(0, limit - usedAfter),
      resetAt: resetAtIso,
    };
  });
}

export async function releaseFeatureUsage(reservationId: string): Promise<void> {
  await dbQuery(
    `
    UPDATE pro_feature_usages
    SET released_at = CURRENT_TIMESTAMP
    WHERE id = $1::uuid
      AND released_at IS NULL
    `,
    [reservationId],
  );
}
