import { NextRequest } from "next/server";
import { dbQuery } from "@/lib/server/db";
import { ensureUserRow, requireAuthenticatedUser } from "@/lib/server/auth";
import { BILLING_HOLDING_STATUSES } from "@/lib/server/billing/planRules";
import { getStripeClient } from "@/lib/server/billing/stripeClient";
import { handleApiRoute, jsonSuccess } from "@/lib/server/http/errors";

export async function GET(req: NextRequest) {
  return handleApiRoute(async () => {
    const authUser = await requireAuthenticatedUser(req);
    const userRow = await ensureUserRow(authUser.id);

    // BE.F12 DA006: Load user's latest billing-holding or most recent subscription
    const subRes = await dbQuery<{
      stripe_subscription_id: string;
      stripe_customer_id: string;
      status: string;
    }>(
      `
      SELECT stripe_subscription_id, stripe_customer_id, status
      FROM subscriptions
      WHERE user_id = $1::uuid
      ORDER BY CASE WHEN status = ANY($2::text[]) THEN 0 ELSE 1 END,
               id DESC
      LIMIT 1
      `,
      [authUser.id, [...BILLING_HOLDING_STATUSES]],
    );

    if (subRes.rows.length === 0) {
      return jsonSuccess({
        plan: userRow.plan,
        subscription: null,
      });
    }

    const row = subRes.rows[0];
    let currentPeriodEnd: string | null = null;
    let cancelAtPeriodEnd = false;

    if (
      BILLING_HOLDING_STATUSES.includes(
        row.status as (typeof BILLING_HOLDING_STATUSES)[number],
      ) &&
      process.env.STRIPE_SECRET_KEY &&
      process.env.STRIPE_SECRET_KEY !== "sk_test_placeholder"
    ) {
      try {
        const stripe = getStripeClient();
        const stripeSub = await stripe.subscriptions.retrieve(
          row.stripe_subscription_id,
        );
        if (stripeSub.current_period_end) {
          currentPeriodEnd = new Date(
            stripeSub.current_period_end * 1000,
          ).toISOString();
        }
        cancelAtPeriodEnd = Boolean(stripeSub.cancel_at_period_end);
      } catch (err) {
        console.warn("[billing/subscription] Failed to fetch Stripe period info", err);
      }
    }

    return jsonSuccess({
      plan: userRow.plan,
      subscription: {
        stripeSubscriptionId: row.stripe_subscription_id,
        status: row.status,
        currentPeriodEnd,
        cancelAtPeriodEnd,
      },
    });
  });
}
