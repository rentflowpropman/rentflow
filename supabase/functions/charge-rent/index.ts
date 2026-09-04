// Deploy with: supabase functions deploy charge-rent
// Called daily by pg_cron (see schema.sql bottom for the cron.schedule
// snippet) — not called from the frontend at all.
//
// For every payment that's due today (or overdue), belongs to a tenant with
// autopay enabled, and hasn't been attempted yet, this charges their saved
// payment method directly ("off-session" — no tenant interaction needed).
// The webhook handles what happens on success/failure; this function just
// kicks the charge off and records that it tried.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import Stripe from "npm:stripe@16";
import { createClient } from "jsr:@supabase/supabase-js@2";

const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY")!, {
  apiVersion: "2024-06-20",
});
const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

Deno.serve(async () => {
  const today = new Date().toISOString().slice(0, 10);

  const { data: duePayments } = await supabase
    .from("payments")
    .select("*, leases(tenants(id, stripe_customer_id, stripe_payment_method_id, autopay_enabled))")
    .in("status", ["due", "late"])
    .eq("autopay_attempted", false)
    .lte("due_date", today);

  const results = [];

  for (const payment of duePayments ?? []) {
    const tenant = payment.leases?.tenants;
    if (!tenant?.autopay_enabled || !tenant.stripe_customer_id || !tenant.stripe_payment_method_id) {
      continue;
    }

    try {
      await stripe.paymentIntents.create({
        amount: Math.round(payment.amount * 100),
        currency: "usd",
        customer: tenant.stripe_customer_id,
        payment_method: tenant.stripe_payment_method_id,
        off_session: true,
        confirm: true,
        metadata: { payment_id: payment.id },
      });
      // the webhook (payment_intent.succeeded via checkout, or a direct
      // payment_intent.succeeded listener you add) marks it paid — here we
      // just record that a charge attempt was made so we don't double-charge
      await supabase
        .from("payments")
        .update({ autopay_attempted: true })
        .eq("id", payment.id);
      results.push({ paymentId: payment.id, status: "charged" });
    } catch (err) {
      await supabase
        .from("payments")
        .update({ autopay_attempted: true, status: "late" })
        .eq("id", payment.id);
      results.push({ paymentId: payment.id, status: "failed", error: String(err) });
    }
  }

  return new Response(JSON.stringify({ processed: results.length, results }), {
    headers: { "Content-Type": "application/json" },
  });
});
