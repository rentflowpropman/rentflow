"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { ApplicationField } from "@/lib/types";

// keys that map to a dedicated column on the applications table — anything
// else the admin adds goes into custom_fields
const KNOWN_KEYS = ["phone", "monthly_income", "employer", "references_text", "notes"];

export default function ApplicationForm({
  unitId,
  fields,
}: {
  unitId: string;
  fields: ApplicationField[];
}) {
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [answers, setAnswers] = useState<Record<string, string>>({});

  function update(key: string, value: string) {
    setAnswers((a) => ({ ...a, [key]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const custom_fields: Record<string, string> = {};
    const known: Record<string, string | number> = {};
    for (const field of fields) {
      const value = answers[field.key] ?? "";
      if (KNOWN_KEYS.includes(field.key)) {
        known[field.key] = field.type === "number" && value ? Number(value) : value;
      } else if (value) {
        custom_fields[field.key] = value;
      }
    }

    const supabase = createClient();
    const { error } = await supabase.from("applications").insert({
      unit_id: unitId,
      applicant_name: name,
      applicant_email: email,
      applicant_phone: known.phone || null,
      monthly_income: known.monthly_income || null,
      employer: known.employer || null,
      references_text: known.references_text || null,
      notes: known.notes || null,
      custom_fields,
    });

    setLoading(false);
    if (error) {
      setError("Something went wrong submitting your application. Please try again.");
    } else {
      setSubmitted(true);
    }
  }

  if (submitted) {
    return (
      <div className="card text-center">
        <h2 className="mb-2 text-lg font-semibold text-ink">
          Application received
        </h2>
        <p className="text-sm text-ink/70">
          Thanks, {name.split(" ")[0]}. We&apos;ll email you at {email} once
          it&apos;s been reviewed.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="card space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label className="label">Full name</label>
          <input required className="input" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div>
          <label className="label">Email</label>
          <input
            type="email"
            required
            className="input"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>

        {fields.map((field) => (
          <div key={field.key} className={field.type === "textarea" ? "sm:col-span-2" : ""}>
            <label className="label">{field.label}</label>
            {field.type === "textarea" ? (
              <textarea
                required={field.required}
                className="input"
                rows={3}
                value={answers[field.key] ?? ""}
                onChange={(e) => update(field.key, e.target.value)}
              />
            ) : (
              <input
                type={field.type === "number" ? "number" : "text"}
                required={field.required}
                className="input"
                value={answers[field.key] ?? ""}
                onChange={(e) => update(field.key, e.target.value)}
              />
            )}
          </div>
        ))}
      </div>

      {error && <p className="text-sm text-clay">{error}</p>}

      <button type="submit" disabled={loading} className="btn-primary w-full">
        {loading ? "Submitting…" : "Submit application"}
      </button>
    </form>
  );
}
