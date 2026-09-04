"use client";

"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Lease, Payment, Tenant, Unit } from "@/lib/types";

export default function PortalPage() {
  const supabase = createClient();
  const [tenant, setTenant] = useState<Tenant | null>(null);
  const [lease, setLease] = useState<Lease | null>(null);
  const [unit, setUnit] = useState<Unit | null>(null);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [maintenanceDesc, setMaintenanceDesc] = useState("");
  const [maintenanceSent, setMaintenanceSent] = useState(false);
  const [payingId, setPayingId] = useState<string | null>(null);
  const [enrollingAutopay, setEnrollingAutopay] = useState(false);

  async function load() {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;

    const { data: tenantRow } = await supabase
      .from("tenants")
      .select("*")
      .eq("user_id", user.id)
      .single();
    if (!tenantRow) return;
    setTenant(tenantRow);

    const { data: leaseRow } = await supabase
      .from("leases")
      .select("*")
      .eq("tenant_id", tenantRow.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .single();
    if (!leaseRow) return;
    setLease(leaseRow);

    const { data: unitRow } = await supabase
      .from("units")
      .select("*")
      .eq("id", leaseRow.unit_id)
      .single();
    setUnit(unitRow);

    const { data: paymentRows } = await supabase
      .from("payments")
      .select("*")
      .eq("lease_id", leaseRow.id)
      .order("due_date");
    setPayments(paymentRows ?? []);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const nextDue = payments.find((p) => p.status !== "paid");
  const balance = payments
    .filter((p) => p.status !== "paid")
    .reduce((sum, p) => sum + p.amount, 0);

  async function payNow(paymentId: string) {
    setPayingId(paymentId);
    const { data, error } = await supabase.functions.invoke(
      "create-checkout-session",
      {
        body: {
          mode: "payment",
          paymentId,
          returnUrl: window.location.href,
        },
      }
    );
    setPayingId(null);
    if (error || !data?.url) {
      alert("Couldn't start checkout. Please try again.");
      return;
    }
    window.location.href = data.url;
  }

  async function enableAutopay() {
    if (!tenant) return;
    setEnrollingAutopay(true);
    const { data, error } = await supabase.functions.invoke(
      "create-checkout-session",
      {
        body: {
          mode: "setup",
          tenantId: tenant.id,
          returnUrl: window.location.href,
        },
      }
    );
    setEnrollingAutopay(false);
    if (error || !data?.url) {
      alert("Couldn't start autopay setup. Please try again.");
      return;
    }
    window.location.href = data.url;
  }

  async function submitMaintenance() {
    if (!tenant || !unit) return;
    await supabase.from("maintenance_requests").insert({
      tenant_id: tenant.id,
      unit_id: unit.id,
      description: maintenanceDesc,
    });
    setMaintenanceSent(true);
    setMaintenanceDesc("");
  }

  if (!lease) {
    return (
      <p className="text-sm text-ink/60">
        No active lease found yet. If you just applied, we&apos;ll email you
        once it&apos;s reviewed.
      </p>
    );
  }

  return (
    <div className="space-y-6">
      <div className="card">
        <p className="text-sm text-ink/50">Your lease</p>
        <p className="mt-1 text-lg font-semibold text-ink">
          Unit {unit?.unit_number}
        </p>
        <p className="text-sm text-ink/60">
          {lease.start_date} → {lease.end_date} · ${lease.rent_amount}/mo
        </p>
      </div>

      <div className="card">
        <div className="mb-3 flex items-center justify-between">
          <p className="text-sm text-ink/50">Balance</p>
          <p className="text-lg font-semibold text-ink">
            ${balance.toLocaleString()}
          </p>
        </div>
        {nextDue && (
          <div className="flex items-center justify-between rounded bg-sand p-3">
            <div>
              <p className="text-sm font-medium text-ink">
                ${nextDue.amount} due {nextDue.due_date}
              </p>
              <p className="text-xs capitalize text-ink/50">{nextDue.type}</p>
            </div>
            <button
              onClick={() => payNow(nextDue.id)}
              disabled={payingId === nextDue.id}
              className="btn-primary"
            >
              {payingId === nextDue.id ? "Redirecting…" : "Pay now"}
            </button>
          </div>
        )}

        <div className="mt-3 flex items-center justify-between border-t border-line pt-3">
          <div>
            <p className="text-sm font-medium text-ink">Autopay</p>
            <p className="text-xs text-ink/50">
              {tenant?.autopay_enabled
                ? "On — rent is withdrawn automatically each due date."
                : "Off — save a payment method to have rent withdrawn automatically."}
            </p>
          </div>
          {!tenant?.autopay_enabled && (
            <button
              onClick={enableAutopay}
              disabled={enrollingAutopay}
              className="btn-secondary whitespace-nowrap"
            >
              {enrollingAutopay ? "Redirecting…" : "Enable autopay"}
            </button>
          )}
        </div>
      </div>

      <div className="card">
        <p className="mb-3 text-sm text-ink/50">Payment history</p>
        <div className="divide-y divide-line">
          {payments.map((p) => (
            <div key={p.id} className="flex items-center justify-between py-2 text-sm">
              <span className="capitalize text-ink/70">
                {p.type} · due {p.due_date}
              </span>
              <span
                className={
                  p.status === "paid" ? "text-forest" : "text-ink/50"
                }
              >
                {p.status === "paid" ? `Paid $${p.amount}` : `$${p.amount} ${p.status}`}
              </span>
            </div>
          ))}
        </div>
      </div>

      <div className="card">
        <p className="mb-3 text-sm text-ink/50">Submit a maintenance request</p>
        {maintenanceSent ? (
          <p className="text-sm text-forest">Request sent — thanks!</p>
        ) : (
          <div className="space-y-3">
            <textarea
              className="input"
              rows={3}
              placeholder="What's going on?"
              value={maintenanceDesc}
              onChange={(e) => setMaintenanceDesc(e.target.value)}
            />
            <button
              onClick={submitMaintenance}
              disabled={!maintenanceDesc}
              className="btn-primary"
            >
              Send request
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
