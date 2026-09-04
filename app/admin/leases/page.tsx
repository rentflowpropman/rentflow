"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { sendEmail, emailTemplates } from "@/lib/email";
import type { Lease, Tenant, Unit, Payment } from "@/lib/types";

type LeaseRow = Lease & { tenant?: Tenant; unit?: Unit; paymentStatus?: "paid up" | "due" | "late" };

export default function LeasesPage() {
  const supabase = createClient();
  const [leases, setLeases] = useState<LeaseRow[]>([]);
  const [sendingId, setSendingId] = useState<string | null>(null);

  async function load() {
    const { data: leaseRows } = await supabase.from("leases").select("*");
    const { data: tenants } = await supabase.from("tenants").select("*");
    const { data: units } = await supabase.from("units").select("*");
    const { data: payments } = await supabase.from("payments").select("*");

    const merged = (leaseRows ?? []).map((l) => {
      const leasePayments = (payments ?? []).filter((p: Payment) => p.lease_id === l.id);
      const unpaid = leasePayments.filter((p: Payment) => p.status !== "paid");
      const paymentStatus: LeaseRow["paymentStatus"] =
        leasePayments.length === 0
          ? undefined
          : unpaid.length === 0
          ? "paid up"
          : unpaid.some((p: Payment) => p.status === "late")
          ? "late"
          : "due";

      return {
        ...l,
        tenant: tenants?.find((t) => t.id === l.tenant_id),
        unit: units?.find((u) => u.id === l.unit_id),
        paymentStatus,
      };
    });
    setLeases(merged);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function sendForSignature(lease: LeaseRow) {
    setSendingId(lease.id);
    const { error } = await supabase.functions.invoke("send-lease-for-signature", {
      body: { leaseId: lease.id },
    });
    setSendingId(null);
    if (error) {
      alert("Couldn't send the lease for signature. Please try again.");
      return;
    }
    load();
  }

  async function markSigned(lease: LeaseRow) {
    const signedAt = new Date().toISOString();
    await supabase
      .from("leases")
      .update({ status: "signed", signed_at: signedAt })
      .eq("id", lease.id);

    // mark the unit occupied
    await supabase
      .from("units")
      .update({ status: "occupied" })
      .eq("id", lease.unit_id);

    // generate 12 months of rent payments due on the 1st
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

    // deposit as its own payment, due immediately
    await supabase.from("payments").insert({
      lease_id: lease.id,
      amount: lease.deposit_amount,
      type: "deposit",
      due_date: lease.start_date,
      status: "due",
    });

    if (lease.tenant?.email) {
      const portalUrl = `${window.location.origin}/login`;
      const template = emailTemplates.leaseSigned(
        lease.tenant.full_name,
        lease.unit?.unit_number ?? "",
        portalUrl
      );
      await sendEmail(lease.tenant.email, template.subject, template.html);
    }

    load();
  }

  return (
    <div>
      <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-ink/50">
        Leases
      </h2>
      {leases.length === 0 ? (
        <p className="text-sm text-ink/40">
          No leases yet — approve an application to create one.
        </p>
      ) : (
        <div className="space-y-3">
          {leases.map((lease) => (
            <div key={lease.id} className="card flex items-center justify-between">
              <div>
                <p className="font-medium text-ink">
                  {lease.tenant?.full_name} — Unit {lease.unit?.unit_number}
                </p>
                <p className="text-sm text-ink/60">
                  {lease.start_date} → {lease.end_date} · $
                  {lease.rent_amount}/mo · deposit ${lease.deposit_amount}
                </p>
              </div>
              <div className="flex items-center gap-3">
                {lease.paymentStatus && (
                  <span
                    className={`rounded px-2 py-0.5 text-xs ${
                      lease.paymentStatus === "paid up"
                        ? "bg-forest/10 text-forest"
                        : lease.paymentStatus === "late"
                        ? "bg-clay/20 text-clay"
                        : "bg-sand text-ink/70"
                    }`}
                  >
                    {lease.paymentStatus}
                  </span>
                )}
                <span
                  className={`rounded px-2 py-0.5 text-xs ${
                    lease.status === "signed"
                      ? "bg-forest/10 text-forest"
                      : lease.status === "sent"
                      ? "bg-forest/10 text-forest"
                      : "bg-clay/15 text-clay"
                  }`}
                >
                  {lease.status === "sent" ? "awaiting signature" : lease.status}
                </span>
                {lease.status === "draft" && (
                  <>
                    <button
                      onClick={() => sendForSignature(lease)}
                      disabled={sendingId === lease.id}
                      className="btn-primary text-xs"
                    >
                      {sendingId === lease.id ? "Sending…" : "Send for signature"}
                    </button>
                    <button onClick={() => markSigned(lease)} className="btn-secondary text-xs">
                      Mark signed manually
                    </button>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
