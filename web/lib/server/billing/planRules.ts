export const PRO_ELIGIBLE_STATUSES = new Set(["active", "trialing"]);

export const BILLING_HOLDING_STATUSES = [
  "trialing",
  "active",
  "past_due",
  "unpaid",
  "paused",
] as const;

export function derivePlanFromSubscriptionStatus(
  status: string | null | undefined,
): "free" | "pro" {
  if (status && PRO_ELIGIBLE_STATUSES.has(status)) {
    return "pro";
  }
  return "free";
}
