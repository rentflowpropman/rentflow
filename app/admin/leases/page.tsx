"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { Payment, Tenant, Lease, Property } from "@/lib/types";

type PaymentRow = Payment & { tenantName?: string };

export default function FinancesPage() {
  const supabase = createClient();
  const router = useRouter();
  const [payments, setPayments] = useState<PaymentRow[]>([]);
  const [expenses, setExpenses] = useState<any[]>([]);
  const [properties, setProperties] = useState<Property[]>([]);
  const [showAddExpense, setShowAddExpense] = useState(false);

  async function checkAccess() {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;
    const { data: profile } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .single();
    if (profile?.role !== "owner") router.replace("/admin");
  }

  async function load() {
    const { data: paymentRows } = await supabase
      .from("payments")
      .select("*")
      .order("due_date");
    const { data: leases } = await supabase.from("leases").select("*");
    const { data: tenants } = await supabase.from("tenants").select("*");
    const { data: expenseRows } = await supabase
      .from("expenses")
      .select("*")
      .order("incurred_on", { ascending: false });
    const { data: propertyRows } = await supabase.from("properties").select("*");

    const merged = (paymentRows ?? []).map((p) => {
      const lease = leases?.find((l: Lease) => l.id === p.lease_id);
      const tenant = tenants?.find((t: Tenant) => t.id === lease?.tenant_id);
      return { ...p, tenantName: tenant?.full_name };
    });

    setPayments(merged);
    setExpenses(expenseRows ?? []);
    setProperties(propertyRows ?? []);
  }

  useEffect(() => {
    checkAccess();
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function addExpense(formData: FormData) {
    await supabase.from("expenses").insert({
      property_id: formData.get("property_id"),
      category: formData.get("category"),
      vendor: formData.get("vendor"),
      amount: Number(formData.get("amount")),
      incurred_on: formData.get("incurred_on"),
      notes: formData.get("notes"),
    });
    setShowAddExpense(false);
    load();
  }

  async function markPaidManually(paymentId: string) {
    await supabase
      .from("payments")
      .update({ status: "paid", paid_at: new Date().toISOString() })
      .eq("id", paymentId);
    load();
  }

  const totalOwed = payments
    .filter((p) => p.status !== "paid")
    .reduce((sum, p) => sum + p.amount, 0);
  const totalCollected = payments
    .filter((p) => p.status === "paid")
    .reduce((sum, p) => sum + p.amount, 0);
  const totalExpenses = expenses.reduce((sum, e) => sum + Number(e.amount), 0);

  return (
    <div className="space-y-8">
      <div className="grid grid-cols-3 gap-4">
        <div className="card">
          <p className="text-sm text-ink/50">Outstanding</p>
          <p className="mt-1 text-xl font-semibold text-clay">${totalOwed.toLocaleString()}</p>
        </div>
        <div className="card">
          <p className="text-sm text-ink/50">Collected</p>
          <p className="mt-1 text-xl font-semibold text-forest">${totalCollected.toLocaleString()}</p>
        </div>
        <div className="card">
          <p className="text-sm text-ink/50">Expenses</p>
          <p className="mt-1 text-xl font-semibold text-ink">${totalExpenses.toLocaleString()}</p>
        </div>
      </div>

      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-ink/50">
          Rent roll
        </h2>
        <div className="card divide-y divide-line p-0">
          {payments.map((p) => (
            <div key={p.id} className="flex items-center justify-between p-3 text-sm">
              <span className="text-ink/70">
                {p.tenantName ?? "Unassigned"} · {p.type} due {p.due_date}
              </span>
              <div className="flex items-center gap-3">
                <span className={p.status === "paid" ? "text-forest" : "text-clay"}>
                  ${p.amount} — {p.status}
                </span>
                {p.status !== "paid" && (
                  <button
                    onClick={() => markPaidManually(p.id)}
                    className="text-xs font-medium text-forest hover:underline"
                  >
                    Mark paid manually
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-ink/50">
            Expenses
          </h2>
          <button onClick={() => setShowAddExpense(!showAddExpense)} className="btn-secondary">
            + Add expense
          </button>
        </div>

        {showAddExpense && (
          <form action={addExpense} className="card mb-4 grid grid-cols-2 gap-3">
            <select name="property_id" required className="input col-span-2">
              <option value="">Select property…</option>
              {properties.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            <input name="category" placeholder="Category (e.g. repairs)" required className="input" />
            <input name="vendor" placeholder="Vendor" className="input" />
            <input name="amount" type="number" placeholder="Amount $" required className="input" />
            <input name="incurred_on" type="date" required className="input" />
            <textarea name="notes" placeholder="Notes" className="input col-span-2" />
            <button type="submit" className="btn-primary col-span-2">
              Save expense
            </button>
          </form>
        )}

        <div className="card divide-y divide-line p-0">
          {expenses.map((e) => (
            <div key={e.id} className="flex items-center justify-between p-3 text-sm">
              <span className="text-ink/70">
                {e.category} · {e.vendor} · {e.incurred_on}
              </span>
              <span className="text-ink">${e.amount}</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
