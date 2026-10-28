import Stripe from "stripe";

let cachedStripe: Stripe | null = null;

export function getStripeClient(): Stripe {
  if (!cachedStripe) {
    const key = process.env.STRIPE_SECRET_KEY || "sk_test_placeholder";
    cachedStripe = new Stripe(key, {
      apiVersion: "2024-06-20" as Stripe.LatestApiVersion,
    });
  }
  return cachedStripe;
}
