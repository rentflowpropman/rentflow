import { createClient } from "@/lib/supabase/server";
import ApplicationForm from "@/components/ApplicationForm";
import { notFound } from "next/navigation";

export default async function ApplyPage({
  params,
}: {
  params: { unitId: string };
}) {
  const supabase = createClient();
  const { data: unit } = await supabase
    .from("units")
    .select("id, unit_number, bedrooms, bathrooms, rent_amount, properties(name, address, city)")
    .eq("id", params.unitId)
    .single();

  if (!unit) notFound();

  const { data: settings } = await supabase
    .from("settings")
    .select("application_form_fields")
    .single();

  const property = Array.isArray(unit.properties)
    ? unit.properties[0]
    : unit.properties;

  return (
    <div className="mx-auto max-w-xl px-4 py-12">
      <div className="mb-8">
        <p className="text-sm font-medium text-forest">Apply to rent</p>
        <h1 className="mt-1 text-2xl font-semibold text-ink">
          {property?.name} — Unit {unit.unit_number}
        </h1>
        <p className="mt-1 text-sm text-ink/60">
          {property?.address}, {property?.city}
        </p>
        <div className="mt-4 flex gap-6 text-sm text-ink/70">
          <span>{unit.bedrooms} bed</span>
          <span>{unit.bathrooms} bath</span>
          <span className="font-medium text-ink">
            ${unit.rent_amount.toLocaleString()}/mo
          </span>
        </div>
      </div>

      <ApplicationForm unitId={unit.id} fields={settings?.application_form_fields ?? []} />
    </div>
  );
}
