"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { sendEmail, emailTemplates } from "@/lib/email";
import type { Property, Unit, Application } from "@/lib/types";

export default function AdminDashboard() {
  const supabase = createClient();
  const [properties, setProperties] = useState<Property[]>([]);
  const [units, setUnits] = useState<Unit[]>([]);
  const [applications, setApplications] = useState<Application[]>([]);
  const [showAddProperty, setShowAddProperty] = useState(false);
  const [showAddUnit, setShowAddUnit] = useState<string | null>(null);
  const [editingProperty, setEditingProperty] = useState<string | null>(null);
  const [editingUnit, setEditingUnit] = useState<string | null>(null);

  async function loadAll() {
    const [{ data: props }, { data: unitsData }, { data: apps }] =
      await Promise.all([
        supabase.from("properties").select("*").order("name"),
        supabase.from("units").select("*").order("unit_number"),
        supabase
          .from("applications")
          .select("*")
          .eq("status", "pending")
          .order("created_at", { ascending: false }),
      ]);
    setProperties(props ?? []);
    setUnits(unitsData ?? []);
    setApplications(apps ?? []);
  }

  useEffect(() => {
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function approveApplication(app: Application) {
    // 1. create the tenant record
    const { data: tenant, error: tenantErr } = await supabase
      .from("tenants")
      .insert({
        full_name: app.applicant_name,
        email: app.applicant_email,
        phone: app.applicant_phone,
      })
      .select()
      .single();

    if (tenantErr || !tenant) {
      alert("Couldn't create tenant record: " + tenantErr?.message);
      return;
    }

    // 2. create a draft lease for the unit they applied to
    const unit = units.find((u) => u.id === app.unit_id);
    const today = new Date().toISOString().slice(0, 10);
    const nextYear = new Date();
    nextYear.setFullYear(nextYear.getFullYear() + 1);

    await supabase.from("leases").insert({
      unit_id: app.unit_id,
      tenant_id: tenant.id,
      start_date: today,
      end_date: nextYear.toISOString().slice(0, 10),
      rent_amount: unit?.rent_amount ?? 0,
      deposit_amount: unit?.rent_amount ?? 0,
      status: "draft",
    });

    // 3. mark the application approved
    await supabase
      .from("applications")
      .update({ status: "approved" })
      .eq("id", app.id);

    // 4. let the applicant know
    const portalUrl = `${window.location.origin}/login`;
    const template = emailTemplates.applicationApproved(app.applicant_name, portalUrl);
    await sendEmail(app.applicant_email, template.subject, template.html);

    loadAll();
  }

  async function denyApplication(app: Application) {
    await supabase
      .from("applications")
      .update({ status: "denied" })
      .eq("id", app.id);

    const template = emailTemplates.applicationDenied(app.applicant_name);
    await sendEmail(app.applicant_email, template.subject, template.html);

    loadAll();
  }

  async function viewDocument(path: string) {
    const { data, error } = await supabase.storage
      .from("application-documents")
      .createSignedUrl(path, 60);
    if (error || !data?.signedUrl) {
      alert("Couldn't open that document. Please try again.");
      return;
    }
    window.open(data.signedUrl, "_blank");
  }

  async function addProperty(formData: FormData) {
    await supabase.from("properties").insert({
      name: formData.get("name"),
      address: formData.get("address"),
      city: formData.get("city"),
      province: formData.get("province"),
    });
    setShowAddProperty(false);
    loadAll();
  }

  async function addUnit(propertyId: string, formData: FormData) {
    await supabase.from("units").insert({
      property_id: propertyId,
      unit_number: formData.get("unit_number"),
      bedrooms: Number(formData.get("bedrooms")),
      bathrooms: Number(formData.get("bathrooms")),
      rent_amount: Number(formData.get("rent_amount")),
    });
    setShowAddUnit(null);
    loadAll();
  }

  async function updateProperty(propertyId: string, formData: FormData) {
    await supabase
      .from("properties")
      .update({
        name: formData.get("name"),
        address: formData.get("address"),
        city: formData.get("city"),
        province: formData.get("province"),
      })
      .eq("id", propertyId);
    setEditingProperty(null);
    loadAll();
  }

  async function deleteProperty(property: Property) {
    const propertyUnitIds = units.filter((u) => u.property_id === property.id).map((u) => u.id);
    if (propertyUnitIds.length > 0) {
      const { data: existingLeases } = await supabase
        .from("leases")
        .select("id")
        .in("unit_id", propertyUnitIds)
        .limit(1);
      if (existingLeases && existingLeases.length > 0) {
        alert(
          "Can't delete this property — one of its units has a lease on file. Remove that lease first."
        );
        return;
      }
    }
    if (!confirm(`Delete "${property.name}" and all its units? This can't be undone.`)) return;
    await supabase.from("properties").delete().eq("id", property.id);
    loadAll();
  }

  async function updateUnit(unitId: string, formData: FormData) {
    await supabase
      .from("units")
      .update({
        unit_number: formData.get("unit_number"),
        bedrooms: Number(formData.get("bedrooms")),
        bathrooms: Number(formData.get("bathrooms")),
        rent_amount: Number(formData.get("rent_amount")),
      })
      .eq("id", unitId);
    setEditingUnit(null);
    loadAll();
  }

  async function deleteUnit(unit: Unit) {
    const { data: existingLeases } = await supabase
      .from("leases")
      .select("id")
      .eq("unit_id", unit.id)
      .limit(1);
    if (existingLeases && existingLeases.length > 0) {
      alert("Can't delete this unit — it has a lease on file. Remove that lease first.");
      return;
    }
    if (!confirm(`Delete Unit ${unit.unit_number}? This can't be undone.`)) return;
    await supabase.from("units").delete().eq("id", unit.id);
    loadAll();
  }

  return (
    <div className="space-y-8">
      {applications.length > 0 && (
        <section>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-ink/50">
            Pending applications
          </h2>
          <div className="space-y-3">
            {applications.map((app) => (
              <div key={app.id} className="card flex items-center justify-between">
                <div>
                  <p className="font-medium text-ink">{app.applicant_name}</p>
                  <p className="text-sm text-ink/60">
                    {app.applicant_email}
                    {app.monthly_income &&
                      ` · $${app.monthly_income.toLocaleString()}/mo income`}
                  </p>
                  {Object.keys(app.custom_fields ?? {}).length > 0 && (
                    <p className="mt-1 text-xs text-ink/50">
                      {Object.entries(app.custom_fields)
                        .map(([k, v]) => `${k.replace(/_/g, " ")}: ${v}`)
                        .join(" · ")}
                    </p>
                  )}
                  {Object.entries(app.documents ?? {}).length > 0 && (
                    <div className="mt-1 flex flex-wrap gap-x-3 text-xs">
                      {Object.entries(app.documents).map(([key, paths]) =>
                        paths.map((path, i) => (
                          <button
                            key={path}
                            onClick={() => viewDocument(path)}
                            className="font-medium text-forest hover:underline"
                          >
                            View {key.replace(/_/g, " ")}
                            {paths.length > 1 ? ` (${i + 1})` : ""} ↗
                          </button>
                        ))
                      )}
                    </div>
                  )}
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => denyApplication(app)}
                    className="btn-secondary"
                  >
                    Deny
                  </button>
                  <button
                    onClick={() => approveApplication(app)}
                    className="btn-primary"
                  >
                    Approve
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-ink/50">
            Properties
          </h2>
          <button
            onClick={() => setShowAddProperty(!showAddProperty)}
            className="btn-secondary"
          >
            + Add property
          </button>
        </div>

        {showAddProperty && (
          <form
            action={addProperty}
            className="card mb-4 grid grid-cols-2 gap-3"
          >
            <input name="name" placeholder="Property name" required className="input col-span-2" />
            <input name="address" placeholder="Address" required className="input col-span-2" />
            <input name="city" placeholder="City" className="input" />
            <input name="province" placeholder="Province" className="input" />
            <button type="submit" className="btn-primary col-span-2">
              Save property
            </button>
          </form>
        )}

        <div className="space-y-4">
          {properties.map((property) => {
            const propertyUnits = units.filter(
              (u) => u.property_id === property.id
            );
            return (
              <div key={property.id} className="card">
                <div className="mb-3 flex items-center justify-between">
                  <div>
                    <p className="font-medium text-ink">{property.name}</p>
                    <p className="text-sm text-ink/60">{property.address}</p>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() =>
                        setEditingProperty(editingProperty === property.id ? null : property.id)
                      }
                      className="btn-secondary text-xs"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => deleteProperty(property)}
                      className="text-xs font-medium text-clay hover:underline"
                    >
                      Delete
                    </button>
                    <button
                      onClick={() =>
                        setShowAddUnit(
                          showAddUnit === property.id ? null : property.id
                        )
                      }
                      className="btn-secondary text-xs"
                    >
                      + Add unit
                    </button>
                  </div>
                </div>

                {editingProperty === property.id && (
                  <form
                    action={(fd) => updateProperty(property.id, fd)}
                    className="mb-3 grid grid-cols-2 gap-3 rounded bg-sand p-3"
                  >
                    <input name="name" defaultValue={property.name} placeholder="Property name" required className="input col-span-2" />
                    <input name="address" defaultValue={property.address} placeholder="Address" required className="input col-span-2" />
                    <input name="city" defaultValue={property.city ?? ""} placeholder="City" className="input" />
                    <input name="province" defaultValue={property.province ?? ""} placeholder="Province" className="input" />
                    <button type="submit" className="btn-primary col-span-2">
                      Save changes
                    </button>
                  </form>
                )}

                {showAddUnit === property.id && (
                  <form
                    action={(fd) => addUnit(property.id, fd)}
                    className="mb-3 grid grid-cols-4 gap-2 rounded bg-sand p-3"
                  >
                    <input name="unit_number" placeholder="Unit #" required className="input" />
                    <input name="bedrooms" type="number" placeholder="Beds" className="input" />
                    <input name="bathrooms" type="number" placeholder="Baths" className="input" />
                    <input name="rent_amount" type="number" placeholder="Rent $" required className="input" />
                    <button type="submit" className="btn-primary col-span-4">
                      Save unit
                    </button>
                  </form>
                )}

                {propertyUnits.length === 0 ? (
                  <p className="text-sm text-ink/40">No units yet.</p>
                ) : (
                  <div className="space-y-2">
                    {propertyUnits.map((unit) =>
                      editingUnit === unit.id ? (
                        <form
                          key={unit.id}
                          action={(fd) => updateUnit(unit.id, fd)}
                          className="grid grid-cols-4 gap-2 rounded bg-sand p-3"
                        >
                          <input name="unit_number" defaultValue={unit.unit_number} placeholder="Unit #" required className="input" />
                          <input name="bedrooms" type="number" defaultValue={unit.bedrooms ?? ""} placeholder="Beds" className="input" />
                          <input name="bathrooms" type="number" defaultValue={unit.bathrooms ?? ""} placeholder="Baths" className="input" />
                          <input name="rent_amount" type="number" defaultValue={unit.rent_amount} placeholder="Rent $" required className="input" />
                          <div className="col-span-4 flex gap-2">
                            <button type="submit" className="btn-primary">
                              Save changes
                            </button>
                            <button
                              type="button"
                              onClick={() => setEditingUnit(null)}
                              className="btn-secondary"
                            >
                              Cancel
                            </button>
                          </div>
                        </form>
                      ) : (
                        <div key={unit.id} className="flex items-center justify-between border-t border-line py-2 text-sm">
                          <span>Unit {unit.unit_number}</span>
                          <span className="text-ink/60">
                            {unit.bedrooms} bed · {unit.bathrooms} bath
                          </span>
                          <span>${unit.rent_amount}/mo</span>
                          <span
                            className={`rounded px-2 py-0.5 text-xs ${
                              unit.status === "vacant"
                                ? "bg-clay/15 text-clay"
                                : "bg-forest/10 text-forest"
                            }`}
                          >
                            {unit.status}
                          </span>
                          <div className="flex items-center gap-3">
                            
                              href={`/apply/${unit.id}`}
                              target="_blank"
                              className="text-xs font-medium text-forest hover:underline"
                            >
                              Copy apply link ↗
                            </a>
                            <button
                              onClick={() => setEditingUnit(unit.id)}
                              className="text-xs font-medium text-ink/70 hover:underline"
                            >
                              Edit
                            </button>
                            <button
                              onClick={() => deleteUnit(unit)}
                              className="text-xs font-medium text-clay hover:underline"
                            >
                              Delete
                            </button>
                          </div>
                        </div>
                      )
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
