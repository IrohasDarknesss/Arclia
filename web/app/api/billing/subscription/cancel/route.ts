import { NextRequest } from "next/server";
import { dbQuery } from "@/lib/server/db";
import { ensureUserRow, requireAuthenticatedUser } from "@/lib/server/auth";
import { BILLING_HOLDING_STATUSES } from "@/lib/server/billing/planRules";
import { getStripeClient } from "@/lib/server/billing/stripeClient";
import {
  ApiError,
  handleApiRoute,
  jsonSuccess,
} from "@/lib/server/http/errors";

export async function POST(req: NextRequest) {
  return handleApiRoute(async () => {
    const authUser = await requireAuthenticatedUser(req);
    const userRow = await ensureUserRow(authUser.id);

    // BE.F12 DA007: Find active/billing-holding subscription
    const subRes = await dbQuery<{
      stripe_subscription_id: string;
      status: string;
    }>(
      `
      SELECT stripe_subscription_id, status
      FROM subscriptions
      WHERE user_id = $1::uuid
        AND status = ANY($2::text[])
      ORDER BY id DESC
      LIMIT 1
      `,
      [authUser.id, [...BILLING_HOLDING_STATUSES]],
    );

    if (subRes.rows.length === 0) {
      throw new ApiError(
        409,
        "NO_ACTIVE_SUBSCRIPTION",
        "解約可能な有効なProプラン契約が見つかりません。",
      );
    }

    const row = subRes.rows[0];
    try {
      const stripe = getStripeClient();
      const updated = await stripe.subscriptions.update(
        row.stripe_subscription_id,
        {
          cancel_at_period_end: true,
        },
      );

      const currentPeriodEnd = updated.current_period_end
        ? new Date(updated.current_period_end * 1000).toISOString()
        : null;

      return jsonSuccess({
        plan: userRow.plan,
        subscription: {
          stripeSubscriptionId: row.stripe_subscription_id,
          status: updated.status || row.status,
          currentPeriodEnd,
          cancelAtPeriodEnd: Boolean(updated.cancel_at_period_end),
        },
      });
    } catch (err) {
      console.error("[billing/subscription/cancel] Stripe error", err);
      throw new ApiError(
        502,
        "BILLING_PROVIDER_ERROR",
        "解約予約の手続きに失敗しました。時間をおいて再度お試しください。",
      );
    }
  });
}
