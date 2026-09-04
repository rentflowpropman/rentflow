"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { Payment, Tenant, Lease, Property } from "@/lib/types";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  CartesianGrid,
} from "recharts";

type PaymentRow = Payment & { tenantName?: string };

function lastNMonths(n: number) {
  const months: { key: string; label: string }[] = [];
  const now = new Date();
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push({
      key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`,
      label: d.toLocaleString("en-US", { month: "short" }),
    });
  }
  return months;
}

export default function FinancesPage() {
  const supabase = createClient();
  const router = useRouter();
  const [payments, setPayments] = useState<PaymentRow[]>([]);
  const [expenses, setExpenses] = useState<any[]>([]);
  const [properties, setProperties] = useState<Property[]>([]);
  const [showAddExpense, setShowAddExpense] = useState(false);
  const [recordingPaymentId, setRecordingPaymentId] = useState<string | null>(null);

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

  async function recordManualPayment(paymentId: string, formData: FormData) {
    const paidDate = formData.get("paid_date") as string;
    await supabase
      .from("payments")
      .update({
        status: "paid",
        paid_at: paidDate ? new Date(paidDate).toISOString() : new Date().toISOString(),
        payment_method: formData.get("payment_method"),
        notes: formData.get("notes"),
      })
      .eq("id", paymentId);
    setRecordingPaymentId(null);
    load();
  }

  async function markUnpaid(paymentId: string) {
    if (!confirm("Mark this back as unpaid? Use this if a payment was recorded by mistake.")) return;
    await supabase
      .from("payments")
      .update({ status: "due", paid_at: null, payment_method: null, notes: null })
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

  // build the last 6 months of collected rent vs expenses for the chart
  const months = lastNMonths(6);
  const monthlyData = months.map(({ key, label }) => {
    const collected = payments
      .filter((p) => p.status === "paid" && p.paid_at?.slice(0, 7) === key)
      .reduce((sum, p) => sum + p.amount, 0);
    const monthExpenses = expenses
      .filter((e) => e.incurred_on?.slice(0, 7) === key)
      .reduce((sum, e) => sum + Number(e.amount), 0);
    return { month: label, Collected: collected, Expenses: monthExpenses, Net: collected - monthExpenses };
  });

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
          Last 6 months
        </h2>
        <div className="card" style={{ height: 280 }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={monthlyData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#DCD5C4" vertical={false} />
              <XAxis dataKey="month" tick={{ fontSize: 12, fill: "#211F1B99" }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 12, fill: "#211F1B99" }} axisLine={false} tickLine={false} width={48} />
              <Tooltip
                contentStyle={{ fontSize: 12, borderRadius: 6, border: "1px solid #DCD5C4" }}
                formatter={(value: number) => `$${value.toLocaleString()}`}
              />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Bar dataKey="Collected" fill="#2F4B3C" radius={[3, 3, 0, 0]} />
              <Bar dataKey="Expenses" fill="#B5654A" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-ink/50">
          Rent roll
        </h2>
        <div className="card divide-y divide-line p-0">
          {payments.map((p) => (
            <div key={p.id} className="p-3 text-sm">
              <div className="flex items-center justify-between">
                <div>
                  <span className="text-ink/70">
                    {p.tenantName ?? "Unassigned"} · {p.type} due {p.due_date}
                  </span>
                  {p.status === "paid" && (p.payment_method || p.notes) && (
                    <p className="mt-0.5 text-xs text-ink/50">
                      {[p.payment_method, p.notes].filter(Boolean).join(" · ")}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-3">
                  <span className={p.status === "paid" ? "text-forest" : "text-clay"}>
                    ${p.amount} — {p.status}
                  </span>
                  {p.status !== "paid" ? (
                    <button
                      onClick={() => setRecordingPaymentId(recordingPaymentId === p.id ? null : p.id)}
                      className="text-xs font-medium text-forest hover:underline"
                    >
                      Record payment
                    </button>
                  ) : (
                    <button
                      onClick={() => markUnpaid(p.id)}
                      className="text-xs font-medium text-ink/50 hover:underline"
                    >
                      Undo
                    </button>
                  )}
                </div>
              </div>

              {recordingPaymentId === p.id && (
                <form
                  action={(fd) => recordManualPayment(p.id, fd)}
                  className="mt-3 grid grid-cols-2 gap-2 rounded bg-sand p-3"
                >
                  <div>
                    <label className="label">Date received</label>
                    <input
                      name="paid_date"
                      type="date"
                      defaultValue={new Date().toISOString().slice(0, 10)}
                      required
                      className="input"
                    />
                  </div>
                  <div>
                    <label className="label">How was it paid?</label>
                    <select name="payment_method" className="input">
                      <option value="Cash">Cash</option>
                      <option value="Check">Check</option>
                      <option value="E-transfer">E-transfer</option>
                      <option value="Bank transfer">Bank transfer</option>
                      <option value="Other">Other</option>
                    </select>
                  </div>
                  <div className="col-span-2">
                    <label className="label">Notes (optional)</label>
                    <input name="notes" placeholder="e.g. check #204" className="input" />
                  </div>
                  <div className="col-span-2 flex gap-2">
                    <button type="submit" className="btn-primary">
                      Save payment
                    </button>
                    <button
                      type="button"
                      onClick={() => setRecordingPaymentId(null)}
                      className="btn-secondary"
                    >
                      Cancel
                    </button>
                  </div>
                </form>
              )}
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
