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

    // BE.F12 DA001: Check if user already has Pro plan or an active/billing-holding subscription
    const subRes = await dbQuery<{
      stripe_subscription_id: string;
      stripe_customer_id: string;
      status: string;
    }>(
      `
      SELECT stripe_subscription_id, stripe_customer_id, status
      FROM subscriptions
      WHERE user_id = $1::uuid
        AND status = ANY($2::text[])
      ORDER BY id DESC
      LIMIT 1
      `,
      [authUser.id, [...BILLING_HOLDING_STATUSES]],
    );

    if (userRow.plan === "pro" || subRes.rows.length > 0) {
      throw new ApiError(
        409,
        "ALREADY_SUBSCRIBED",
        "すでに有効なProプラン契約、または処理中の契約が存在します。",
      );
    }

    // Reuse existing stripe_customer_id if user had a canceled subscription previously (BE.F12 DA002)
    const prevCustomerRes = await dbQuery<{ stripe_customer_id: string }>(
      `
      SELECT stripe_customer_id
      FROM subscriptions
      WHERE user_id = $1::uuid
      ORDER BY id DESC
      LIMIT 1
      `,
      [authUser.id],
    );
    const existingCustomerId =
      prevCustomerRes.rows[0]?.stripe_customer_id || undefined;

    const appUrl = (
      process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"
    ).replace(/\/$/, "");
    const priceId = process.env.STRIPE_PRO_PRICE_ID;

    if (!priceId || !process.env.STRIPE_SECRET_KEY) {
      throw new ApiError(
        502,
        "BILLING_PROVIDER_ERROR",
        "決済サービスの設定（STRIPE_SECRET_KEY / STRIPE_PRO_PRICE_ID）が未構成です。",
      );
    }

    try {
      const stripe = getStripeClient();
      const session = await stripe.checkout.sessions.create({
        mode: "subscription",
        line_items: [{ price: priceId, quantity: 1 }],
        success_url: `${appUrl}/mypage?checkout=success`,
        cancel_url: `${appUrl}/pricing?checkout=canceled`,
        client_reference_id: authUser.id,
        customer: existingCustomerId,
        customer_email: existingCustomerId
          ? undefined
          : authUser.email || undefined,
        metadata: {
          user_id: authUser.id,
        },
        subscription_data: {
          metadata: {
            user_id: authUser.id,
          },
        },
      });

      if (!session.url) {
        throw new Error("Stripe Checkout session did not return a URL");
      }

      return jsonSuccess({
        checkoutUrl: session.url,
      });
    } catch (err) {
      if (err instanceof ApiError) throw err;
      console.error("[billing/checkout] Stripe error", err);
      throw new ApiError(
        502,
        "BILLING_PROVIDER_ERROR",
        "決済セッションの作成に失敗しました。時間をおいて再度お試しください。",
      );
    }
  });
}
