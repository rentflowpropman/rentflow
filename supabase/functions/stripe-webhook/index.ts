// Deploy with: supabase functions deploy stripe-webhook --no-verify-jwt
// Secrets needed: STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET,
//   SUPABASE_SERVICE_ROLE_KEY, SUPABASE_URL, RESEND_API_KEY (optional, for receipts)
//
// In the Stripe Dashboard, add a webhook endpoint pointing at:
//   https://YOUR_PROJECT_REF.supabase.co/functions/v1/stripe-webhook
// listening for: checkout.session.completed, payment_intent.payment_failed,
//   payment_intent.succeeded
//
// --no-verify-jwt is required because Stripe calls this directly, not through
// a logged-in user — the Stripe signature check below is what verifies it
// instead.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import Stripe from "npm:stripe@16";
import { createClient } from "jsr:@supabase/supabase-js@2";

const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY")!, {
  apiVersion: "2024-06-20",
});
const webhookSecret = Deno.env.get("STRIPE_WEBHOOK_SECRET")!;

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

Deno.serve(async (req) => {
  const signature = req.headers.get("stripe-signature");
  const body = await req.text();

  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(
      body,
      signature!,
      webhookSecret
    );
  } catch (err) {
    return new Response(`Webhook signature verification failed: ${err}`, {
      status: 400,
    });
  }

  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;

      if (session.mode === "payment" && session.metadata?.payment_id) {
        await supabase
          .from("payments")
          .update({
            status: "paid",
            paid_at: new Date().toISOString(),
            stripe_payment_intent_id: session.payment_intent as string,
          })
          .eq("id", session.metadata.payment_id);
      }

      if (session.mode === "setup" && session.metadata?.tenant_id) {
        // fetch the payment method that was just saved
        const setupIntent = await stripe.setupIntents.retrieve(
          session.setup_intent as string
        );
        await supabase
          .from("tenants")
          .update({
            stripe_payment_method_id: setupIntent.payment_method as string,
            autopay_enabled: true,
          })
          .eq("id", session.metadata.tenant_id);
      }
      break;
    }

    case "payment_intent.payment_failed": {
      const intent = event.data.object as Stripe.PaymentIntent;
      // best-effort: find the payment row this intent belongs to
      await supabase
        .from("payments")
        .update({ status: "late" })
        .eq("stripe_payment_intent_id", intent.id);
      break;
    }

    case "payment_intent.succeeded": {
      // covers autopay charges from charge-rent, which create a
      // PaymentIntent directly (no Checkout session involved)
      const intent = event.data.object as Stripe.PaymentIntent;
      const paymentId = intent.metadata?.payment_id;
      if (paymentId) {
        await supabase
          .from("payments")
          .update({
            status: "paid",
            paid_at: new Date().toISOString(),
            stripe_payment_intent_id: intent.id,
          })
          .eq("id", paymentId);
      }
      break;
    }
  }

  return new Response(JSON.stringify({ received: true }), {
    headers: { "Content-Type": "application/json" },
  });
});
