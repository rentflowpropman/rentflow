"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { MaintenanceRequest, Tenant, Unit } from "@/lib/types";

type RequestRow = MaintenanceRequest & { tenant?: Tenant; unit?: Unit };

export default function MaintenancePage() {
  const supabase = createClient();
  const [requests, setRequests] = useState<RequestRow[]>([]);

  async function load() {
    const { data: reqRows } = await supabase
      .from("maintenance_requests")
      .select("*")
      .order("created_at", { ascending: false });
    const { data: tenants } = await supabase.from("tenants").select("*");
    const { data: units } = await supabase.from("units").select("*");

    const merged = (reqRows ?? []).map((r) => ({
      ...r,
      tenant: tenants?.find((t) => t.id === r.tenant_id),
      unit: units?.find((u) => u.id === r.unit_id),
    }));
    setRequests(merged);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function updateStatus(id: string, status: MaintenanceRequest["status"]) {
    await supabase.from("maintenance_requests").update({ status }).eq("id", id);
    load();
  }

  const statusStyle: Record<MaintenanceRequest["status"], string> = {
    open: "bg-clay/15 text-clay",
    in_progress: "bg-sand text-ink/70",
    resolved: "bg-forest/10 text-forest",
  };

  return (
    <div>
      <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-ink/50">
        Maintenance requests
      </h2>
      {requests.length === 0 ? (
        <p className="text-sm text-ink/40">No maintenance requests yet.</p>
      ) : (
        <div className="space-y-3">
          {requests.map((r) => (
            <div key={r.id} className="card">
              <div className="flex items-start justify-between">
                <div>
                  <p className="font-medium text-ink">
                    {r.tenant?.full_name} — Unit {r.unit?.unit_number}
                  </p>
                  <p className="mt-1 text-sm text-ink/70">{r.description}</p>
                  <p className="mt-1 text-xs text-ink/40">
                    {new Date(r.created_at).toLocaleDateString()}
                  </p>
                </div>
                <span className={`rounded px-2 py-0.5 text-xs ${statusStyle[r.status]}`}>
                  {r.status.replace("_", " ")}
                </span>
              </div>
              <div className="mt-3 flex gap-2">
                {r.status === "open" && (
                  <button
                    onClick={() => updateStatus(r.id, "in_progress")}
                    className="btn-secondary text-xs"
                  >
                    Mark in progress
                  </button>
                )}
                {r.status !== "resolved" && (
                  <button
                    onClick={() => updateStatus(r.id, "resolved")}
                    className="btn-primary text-xs"
                  >
                    Mark resolved
                  </button>
                )}
                {r.status === "resolved" && (
                  <button
                    onClick={() => updateStatus(r.id, "open")}
                    className="text-xs font-medium text-ink/50 hover:underline"
                  >
                    Reopen
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
