// Deploy with: supabase functions deploy create-checkout-session
// Secrets needed: STRIPE_SECRET_KEY, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_URL
//
// Called from the frontend like:
//   supabase.functions.invoke('create-checkout-session', {
//     body: { mode: 'payment', paymentId, returnUrl }
//     // or: { mode: 'setup', tenantId, returnUrl }  -- to enroll in autopay
//   })
// Returns { url } — redirect the browser there.

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

Deno.serve(async (req) => {
  try {
    const { mode, paymentId, tenantId, returnUrl } = await req.json();

    if (mode === "payment") {
      // ---- one-time rent/deposit payment ----
      const { data: payment } = await supabase
        .from("payments")
        .select("*, leases(tenant_id, tenants(id, full_name, email, stripe_customer_id))")
        .eq("id", paymentId)
        .single();

      if (!payment) {
        return json({ error: "Payment not found" }, 404);
      }
      const tenant = payment.leases.tenants;
      const customerId = await ensureStripeCustomer(tenant);

      const session = await stripe.checkout.sessions.create({
        mode: "payment",
        customer: customerId,
        payment_method_types: ["card", "us_bank_account"],
        line_items: [
          {
            price_data: {
              currency: "usd",
              product_data: { name: `${payment.type} — due ${payment.due_date}` },
              unit_amount: Math.round(payment.amount * 100),
            },
            quantity: 1,
          },
        ],
        metadata: { payment_id: payment.id },
        success_url: `${returnUrl}?paid=1`,
        cancel_url: returnUrl,
      });

      return json({ url: session.url });
    }

    if (mode === "setup") {
      // ---- save a payment method for future autopay charges ----
      const { data: tenant } = await supabase
        .from("tenants")
        .select("*")
        .eq("id", tenantId)
        .single();

      if (!tenant) return json({ error: "Tenant not found" }, 404);
      const customerId = await ensureStripeCustomer(tenant);

      const session = await stripe.checkout.sessions.create({
        mode: "setup",
        customer: customerId,
        payment_method_types: ["card", "us_bank_account"],
        metadata: { tenant_id: tenant.id },
        success_url: `${returnUrl}?autopay=1`,
        cancel_url: returnUrl,
      });

      return json({ url: session.url });
    }

    return json({ error: "Invalid mode" }, 400);
  } catch (err) {
    return json({ error: String(err) }, 500);
  }
});

async function ensureStripeCustomer(tenant: {
  id: string;
  full_name: string;
  email: string;
  stripe_customer_id: string | null;
}) {
  if (tenant.stripe_customer_id) return tenant.stripe_customer_id;

  const customer = await stripe.customers.create({
    name: tenant.full_name,
    email: tenant.email,
    metadata: { tenant_id: tenant.id },
  });

  await supabase
    .from("tenants")
    .update({ stripe_customer_id: customer.id })
    .eq("id", tenant.id);

  return customer.id;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
