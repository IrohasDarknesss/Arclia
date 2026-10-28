import Stripe from "stripe";
import { withTransaction } from "@/lib/server/db";
import { derivePlanFromSubscriptionStatus } from "@/lib/server/billing/planRules";

export async function upsertSubscriptionAndSyncUserPlan(params: {
  userId: string;
  stripeCustomerId: string;
  stripeSubscriptionId: string;
  status: string;
}): Promise<void> {
  const { userId, stripeCustomerId, stripeSubscriptionId, status } = params;

  await withTransaction(async (client) => {
    // Upsert subscriptions row (BE.F12 DA004)
    await client.query(
      `
      INSERT INTO subscriptions (user_id, stripe_customer_id, stripe_subscription_id, status)
      VALUES ($1::uuid, $2, $3, $4)
      ON CONFLICT (stripe_subscription_id)
      DO UPDATE SET
        stripe_customer_id = EXCLUDED.stripe_customer_id,
        status             = EXCLUDED.status
      `,
      [userId, stripeCustomerId, stripeSubscriptionId, status],
    );

    // Check if the user has any active/trialing subscription and sync users.plan (BE.F12 DA005)
    const activeRes = await client.query<{ has_pro: boolean }>(
      `
      SELECT EXISTS (
        SELECT 1
        FROM subscriptions
        WHERE user_id = $1::uuid
          AND status IN ('active', 'trialing')
      ) AS has_pro
      `,
      [userId],
    );
    const nextPlan = activeRes.rows[0]?.has_pro
      ? "pro"
      : derivePlanFromSubscriptionStatus(status);

    await client.query(
      `
      UPDATE users
      SET plan = $1
      WHERE user_id = $2::uuid
        AND plan IS DISTINCT FROM $1
      `,
      [nextPlan, userId],
    );
  });
}

export async function handleStripeWebhookEvent(
  event: Stripe.Event,
  fetchSubscriptionById?: (subId: string) => Promise<Stripe.Subscription>,
): Promise<void> {
  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;
      if (session.mode !== "subscription") return;
      const userId =
        session.metadata?.user_id || session.client_reference_id || null;
      const customerId =
        typeof session.customer === "string"
          ? session.customer
          : session.customer?.id || null;
      const subscriptionId =
        typeof session.subscription === "string"
          ? session.subscription
          : session.subscription?.id || null;

      if (!userId || !customerId || !subscriptionId) return;

      let status = "active";
      if (fetchSubscriptionById) {
        try {
          const sub = await fetchSubscriptionById(subscriptionId);
          status = sub.status;
        } catch {
          status = "active";
        }
      }

      await upsertSubscriptionAndSyncUserPlan({
        userId,
        stripeCustomerId: customerId,
        stripeSubscriptionId: subscriptionId,
        status,
      });
      return;
    }

    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted": {
      const sub = event.data.object as Stripe.Subscription;
      const subscriptionId = sub.id;
      const customerId =
        typeof sub.customer === "string" ? sub.customer : sub.customer.id;
      let userId: string | null = sub.metadata?.user_id || null;

      if (!userId) {
        // Resolve user_id by existing stripe_subscription_id or stripe_customer_id (BE.F12 DA003)
        userId = await withTransaction(async (client) => {
          const bySub = await client.query<{ user_id: string }>(
            `SELECT user_id FROM subscriptions WHERE stripe_subscription_id = $1 LIMIT 1`,
            [subscriptionId],
          );
          if (bySub.rows.length > 0) return bySub.rows[0].user_id;

          const byCus = await client.query<{ user_id: string }>(
            `SELECT user_id FROM subscriptions WHERE stripe_customer_id = $1 ORDER BY id DESC LIMIT 1`,
            [customerId],
          );
          return byCus.rows[0]?.user_id ?? null;
        });
      }

      if (!userId) return;

      await upsertSubscriptionAndSyncUserPlan({
        userId,
        stripeCustomerId: customerId,
        stripeSubscriptionId: subscriptionId,
        status: sub.status,
      });
      return;
    }

    default:
      return;
  }
}
