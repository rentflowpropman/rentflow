// Deploy with: supabase functions deploy send-rent-reminders
// Called daily by pg_cron (see schema.sql). Not called from the frontend.
//
// Two kinds of email:
//  - "upcoming" reminder: rent due in 3 days, not on autopay, not reminded yet
//  - "late" notice: rent overdue, no late notice sent yet
// Each is sent once per payment (tracked via reminder_sent_at / late_notice_sent_at).

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
const FROM_EMAIL = Deno.env.get("FROM_EMAIL") ?? "RentFlow <onboarding@resend.dev>";

Deno.serve(async () => {
  const today = new Date();
  const in3Days = new Date(today);
  in3Days.setDate(in3Days.getDate() + 3);
  const in3DaysStr = in3Days.toISOString().slice(0, 10);
  const todayStr = today.toISOString().slice(0, 10);

  const results = { reminders: 0, lateNotices: 0 };

  // ---- upcoming reminders ----
  const { data: upcoming } = await supabase
    .from("payments")
    .select("*, leases(tenants(full_name, email, autopay_enabled))")
    .eq("status", "due")
    .eq("due_date", in3DaysStr)
    .is("reminder_sent_at", null);

  for (const payment of upcoming ?? []) {
    const tenant = payment.leases?.tenants;
    if (!tenant?.email || tenant.autopay_enabled) continue; // autopay tenants don't need a nudge

    await sendMail(
      tenant.email,
      "Rent due in 3 days",
      `<p>Hi ${tenant.full_name},</p>
       <p>A reminder that $${payment.amount} ${payment.type} is due on ${payment.due_date}.
       Sign in to your portal to pay.</p>`
    );
    await supabase
      .from("payments")
      .update({ reminder_sent_at: new Date().toISOString() })
      .eq("id", payment.id);
    results.reminders++;
  }

  // ---- late notices ----
  const { data: overdue } = await supabase
    .from("payments")
    .select("*, leases(tenants(full_name, email))")
    .in("status", ["due", "late"])
    .lt("due_date", todayStr)
    .is("late_notice_sent_at", null);

  for (const payment of overdue ?? []) {
    const tenant = payment.leases?.tenants;
    if (!tenant?.email) continue;

    await sendMail(
      tenant.email,
      "Your rent payment is overdue",
      `<p>Hi ${tenant.full_name},</p>
       <p>Our records show $${payment.amount} ${payment.type} due ${payment.due_date} hasn't been received yet.
       Please sign in to your portal to take care of this as soon as you can.</p>`
    );
    await supabase
      .from("payments")
      .update({ late_notice_sent_at: new Date().toISOString(), status: "late" })
      .eq("id", payment.id);
    results.lateNotices++;
  }

  return new Response(JSON.stringify(results), {
    headers: { "Content-Type": "application/json" },
  });
});

async function sendMail(to: string, subject: string, html: string) {
  await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from: FROM_EMAIL, to, subject, html }),
  });
}
