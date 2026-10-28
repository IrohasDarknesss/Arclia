import { NextRequest, NextResponse } from "next/server";
import { dbQuery, withTransaction } from "@/lib/server/db";
import {
  deleteSupabaseAuthUser,
  ensureUserRow,
  requireAuthenticatedUser,
} from "@/lib/server/auth";
import { BILLING_HOLDING_STATUSES } from "@/lib/server/billing/planRules";
import { getStripeClient } from "@/lib/server/billing/stripeClient";
import { handleApiRoute, jsonSuccess } from "@/lib/server/http/errors";

export async function GET(req: NextRequest) {
  return handleApiRoute(async () => {
    const authUser = await requireAuthenticatedUser(req);
    const userRow = await ensureUserRow(authUser.id);

    const subRes = await dbQuery<{
      status: string;
      stripe_subscription_id: string;
    }>(
      `
      SELECT status, stripe_subscription_id
      FROM subscriptions
      WHERE user_id = $1::uuid
        AND status = ANY($2::text[])
      ORDER BY id DESC
      LIMIT 1
      `,
      [authUser.id, [...BILLING_HOLDING_STATUSES]],
    );

    const sub = subRes.rows[0] || null;
    return jsonSuccess({
      userId: userRow.userId,
      email: authUser.email,
      plan: userRow.plan,
      createdAt: userRow.createdAt,
      subscription: sub
        ? {
            status: sub.status,
            stripeSubscriptionId: sub.stripe_subscription_id,
          }
        : null,
    });
  });
}

export async function POST(req: NextRequest) {
  return handleApiRoute(async () => {
    const authUser = await requireAuthenticatedUser(req);
    const userRow = await ensureUserRow(authUser.id);
    return jsonSuccess(
      {
        userId: userRow.userId,
        email: authUser.email,
        plan: userRow.plan,
        createdAt: userRow.createdAt,
        isNewUser: userRow.isNewUser,
      },
      userRow.isNewUser ? 201 : 200,
    );
  });
}

export async function DELETE(req: NextRequest) {
  return handleApiRoute(async () => {
    const authUser = await requireAuthenticatedUser(req);

    // 1. Check if the user has any active/billing-holding Stripe subscription (BE.F16 DA001)
    const subRes = await dbQuery<{
      stripe_subscription_id: string;
      status: string;
    }>(
      `
      SELECT stripe_subscription_id, status
      FROM subscriptions
      WHERE user_id = $1::uuid
        AND status = ANY($2::text[])
      `,
      [authUser.id, [...BILLING_HOLDING_STATUSES]],
    );

    // 2. Immediately cancel any billing-holding Stripe subscription before deleting DB rows
    if (subRes.rows.length > 0 && process.env.STRIPE_SECRET_KEY) {
      const stripe = getStripeClient();
      for (const s of subRes.rows) {
        try {
          await stripe.subscriptions.cancel(s.stripe_subscription_id);
        } catch (stripeErr) {
          console.warn(
            `[account delete] Stripe cancel warning for ${s.stripe_subscription_id}:`,
            stripeErr,
          );
        }
      }
    }

    // 3. Delete user row from `users` (cascades to user_interests, bookmarks, view_events, subscriptions, etc.)
    await withTransaction(async (client) => {
      await client.query(`DELETE FROM users WHERE user_id = $1::uuid`, [
        authUser.id,
      ]);
    });

    // 4. Delete user from Supabase Auth
    await deleteSupabaseAuthUser(authUser.id);

    return new NextResponse(null, { status: 204 });
  });
}
