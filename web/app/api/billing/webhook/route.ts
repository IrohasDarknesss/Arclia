import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { getStripeClient } from "@/lib/server/billing/stripeClient";
import { handleStripeWebhookEvent } from "@/lib/server/billing/webhookService";
import { jsonError } from "@/lib/server/http/errors";

export async function POST(req: NextRequest) {
  const sig = req.headers.get("stripe-signature");
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!sig || !webhookSecret) {
    return jsonError(
      400,
      "INVALID_SIGNATURE",
      "Stripe Webhookの署名またはシークレットが不足しています。",
    );
  }

  let rawBody: string;
  try {
    rawBody = await req.text();
  } catch {
    return jsonError(400, "INVALID_SIGNATURE", "リクエスト本文の読み取りに失敗しました。");
  }

  const stripe = getStripeClient();
  let event: Stripe.Event;

  try {
    event = stripe.webhooks.constructEvent(rawBody, sig, webhookSecret);
  } catch (err) {
    console.warn("[billing/webhook] Signature verification failed", err);
    return jsonError(400, "INVALID_SIGNATURE", "Stripe Webhookの署名検証に失敗しました。");
  }

  try {
    await handleStripeWebhookEvent(event, (subId) =>
      stripe.subscriptions.retrieve(subId),
    );
    return NextResponse.json({ received: true }, { status: 200 });
  } catch (err) {
    console.error("[billing/webhook] Processing error", err);
    return jsonError(
      500,
      "INTERNAL_ERROR",
      "Webhookイベントの反映中にエラーが発生しました。",
    );
  }
}
