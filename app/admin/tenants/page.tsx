"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Tenant } from "@/lib/types";

export default function TenantsPage() {
  const supabase = createClient();
  const [tenants, setTenants] = useState<Tenant[]>([]);

  useEffect(() => {
    supabase
      .from("tenants")
      .select("*")
      .order("full_name")
      .then(({ data }) => setTenants(data ?? []));
  }, []);

  return (
    <div>
      <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-ink/50">
        Tenants
      </h2>
      {tenants.length === 0 ? (
        <p className="text-sm text-ink/40">
          No tenants yet — they&apos;re created automatically when you approve
          an application.
        </p>
      ) : (
        <div className="card divide-y divide-line p-0">
          {tenants.map((t) => (
            <div key={t.id} className="flex items-center justify-between p-4">
              <div>
                <p className="font-medium text-ink">{t.full_name}</p>
                <p className="text-sm text-ink/60">{t.email}</p>
              </div>
              <span className="text-sm text-ink/50">{t.phone}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
