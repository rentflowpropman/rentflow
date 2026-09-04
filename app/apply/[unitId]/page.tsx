import Link from "next/link";
import { createClient } from "@/lib/supabase/server";

export default async function ListingsPage() {
  const supabase = createClient();
  const { data: units } = await supabase
    .from("units")
    .select("id, unit_number, bedrooms, bathrooms, rent_amount, properties(name, address, city)")
    .eq("status", "vacant")
    .order("rent_amount");

  return (
    <div className="mx-auto max-w-xl px-4 py-12">
      <div className="mb-8">
        <p className="text-sm font-medium text-forest">Now renting</p>
        <h1 className="mt-1 text-2xl font-semibold text-ink">
          Available units
        </h1>
      </div>

      {!units || units.length === 0 ? (
        <p className="text-sm text-ink/50">
          Nothing available to rent right now — check back soon.
        </p>
      ) : (
        <div className="space-y-3">
          {units.map((unit) => {
            const property = Array.isArray(unit.properties)
              ? unit.properties[0]
              : unit.properties;
            return (
              <Link
                key={unit.id}
                href={`/apply/${unit.id}`}
                className="card block hover:border-forest"
              >
                <p className="font-medium text-ink">
                  {property?.name} — Unit {unit.unit_number}
                </p>
                <p className="text-sm text-ink/60">
                  {property?.address}, {property?.city}
                </p>
                <div className="mt-2 flex gap-6 text-sm text-ink/70">
                  <span>{unit.bedrooms} bed</span>
                  <span>{unit.bathrooms} bath</span>
                  <span className="font-medium text-ink">
                    ${unit.rent_amount.toLocaleString()}/mo
                  </span>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
