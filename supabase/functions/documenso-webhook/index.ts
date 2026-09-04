// Deploy with: supabase functions deploy documenso-webhook --no-verify-jwt
// Secrets needed: SUPABASE_SERVICE_ROLE_KEY, SUPABASE_URL, RESEND_API_KEY,
//   DOCUMENSO_WEBHOOK_SECRET
//
// In Documenso: Settings → Webhooks → add endpoint pointing at
//   https://YOUR_PROJECT_REF.supabase.co/functions/v1/documenso-webhook
// listening for the "document completed" / signed event.
// --no-verify-jwt because Documenso calls this directly, not a logged-in user.
//
// NOTE: check Documenso's current webhook payload shape and signature
// header against their docs before going live — this reads the most
// commonly documented shape (a `secret` header matching your configured
// webhook secret, and event.data.documentId) but confirm before relying on it.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);
const WEBHOOK_SECRET = Deno.env.get("DOCUMENSO_WEBHOOK_SECRET");
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
const FROM_EMAIL = Deno.env.get("FROM_EMAIL") ?? "RentFlow <onboarding@resend.dev>";

Deno.serve(async (req) => {
  const providedSecret = req.headers.get("x-documenso-secret") ?? req.headers.get("secret");
  if (WEBHOOK_SECRET && providedSecret !== WEBHOOK_SECRET) {
    return new Response("Invalid signature", { status: 401 });
  }

  const event = await req.json();
  const documentId = String(event?.data?.documentId ?? event?.documentId ?? "");
  const isCompleted =
    event?.event === "document.completed" || event?.data?.status === "COMPLETED";

  if (!isCompleted || !documentId) {
    return new Response(JSON.stringify({ ignored: true }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  const { data: lease } = await supabase
    .from("leases")
    .select("*, tenants(full_name, email), units(unit_number, rent_amount)")
    .eq("documenso_document_id", documentId)
    .single();

  if (!lease) {
    return new Response(JSON.stringify({ error: "No matching lease" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  // mark the lease signed
  await supabase
    .from("leases")
    .update({ status: "signed", signed_at: new Date().toISOString() })
    .eq("id", lease.id);

  // mark the unit occupied
  await supabase.from("units").update({ status: "occupied" }).eq("id", lease.unit_id);

  // generate 12 months of rent payments + the deposit, same as the manual flow
  const start = new Date(lease.start_date);
  const payments = Array.from({ length: 12 }, (_, i) => {
    const due = new Date(start);
    due.setMonth(due.getMonth() + i);
    return {
      lease_id: lease.id,
      amount: lease.rent_amount,
      type: "rent" as const,
      due_date: due.toISOString().slice(0, 10),
      status: "due" as const,
    };
  });
  await supabase.from("payments").insert(payments);
  await supabase.from("payments").insert({
    lease_id: lease.id,
    amount: lease.deposit_amount,
    type: "deposit",
    due_date: lease.start_date,
    status: "due",
  });

  // email the tenant
  if (lease.tenants?.email) {
    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: FROM_EMAIL,
        to: lease.tenants.email,
        subject: "Your lease is signed — welcome!",
        html: `<p>Hi ${lease.tenants.full_name},</p>
          <p>Your lease for Unit ${lease.units?.unit_number} is signed and active.
          Sign in to your portal any time to see your rent schedule and make payments.</p>`,
      }),
    });
  }

  return new Response(JSON.stringify({ success: true }), {
    headers: { "Content-Type": "application/json" },
  });
});
