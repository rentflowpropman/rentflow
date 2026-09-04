"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { ApplicationField, Settings } from "@/lib/types";

export default function SettingsPage() {
  const supabase = createClient();
  const router = useRouter();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [newField, setNewField] = useState({ label: "", type: "text" as ApplicationField["type"] });
  const [uploading, setUploading] = useState(false);
  const [templateEditorUrl, setTemplateEditorUrl] = useState<string | null>(null);
  const [team, setTeam] = useState<{ id: string; email: string; role: string }[]>([]);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"staff" | "owner">("staff");

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

  async function loadTeam() {
    const { data } = await supabase
      .from("profiles")
      .select("id, email, role")
      .in("role", ["owner", "staff"]);
    setTeam(data ?? []);
  }

  async function invite() {
    if (!inviteEmail.trim()) return;
    await supabase.from("staff_invites").insert({ email: inviteEmail.trim(), role: inviteRole });
    setInviteEmail("");
    alert(`Invited. When ${inviteEmail} signs in at /login for the first time, they'll get ${inviteRole} access.`);
  }

  async function load() {
    const { data } = await supabase.from("settings").select("*").single();
    setSettings(data);
  }

  useEffect(() => {
    checkAccess();
    load();
    loadTeam();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function saveFields(fields: ApplicationField[]) {
    await supabase.from("settings").update({ application_form_fields: fields }).eq("id", true);
    setSettings((s) => (s ? { ...s, application_form_fields: fields } : s));
  }

  function addField() {
    if (!newField.label.trim() || !settings) return;
    const key = newField.label.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_");
    const field: ApplicationField = {
      key,
      label: newField.label.trim(),
      type: newField.type,
      required: false,
    };
    saveFields([...settings.application_form_fields, field]);
    setNewField({ label: "", type: "text" });
  }

  function removeField(key: string) {
    if (!settings) return;
    saveFields(settings.application_form_fields.filter((f) => f.key !== key));
  }

  function toggleRequired(key: string) {
    if (!settings) return;
    saveFields(
      settings.application_form_fields.map((f) =>
        f.key === key ? { ...f, required: !f.required } : f
      )
    );
  }

  async function uploadLeaseTemplate(file: File) {
    setUploading(true);
    const reader = new FileReader();
    reader.onload = async () => {
      const base64 = (reader.result as string).split(",")[1];
      const { data, error } = await supabase.functions.invoke("create-lease-template", {
        body: { fileBase64: base64, fileName: file.name },
      });
      setUploading(false);
      if (error || !data?.editorUrl) {
        alert("Couldn't upload the lease template. Please try again.");
        return;
      }
      setTemplateEditorUrl(data.editorUrl);
      load();
    };
    reader.readAsDataURL(file);
  }

  if (!settings) return null;

  return (
    <div className="space-y-8">
      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-ink/50">
          Team
        </h2>
        <p className="mb-3 text-sm text-ink/60">
          Staff can handle applications, tenants, and leases, but can't see
          Finances or Settings. Owners see everything.
        </p>
        <div className="card divide-y divide-line p-0">
          {team.map((member) => (
            <div key={member.id} className="flex items-center justify-between p-3">
              <span className="text-sm text-ink">{member.email}</span>
              <span className="rounded bg-sand px-2 py-0.5 text-xs capitalize text-ink/70">
                {member.role}
              </span>
            </div>
          ))}
          {team.length === 0 && (
            <p className="p-3 text-sm text-ink/40">No team members yet.</p>
          )}
        </div>
        <div className="card mt-3 flex items-end gap-3">
          <div className="flex-1">
            <label className="label">Invite by email</label>
            <input
              type="email"
              className="input"
              placeholder="teammate@example.com"
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
            />
          </div>
          <select
            className="input w-28"
            value={inviteRole}
            onChange={(e) => setInviteRole(e.target.value as "staff" | "owner")}
          >
            <option value="staff">Staff</option>
            <option value="owner">Owner</option>
          </select>
          <button onClick={invite} className="btn-primary">
            Invite
          </button>
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-ink/50">
          Application form
        </h2>
        <p className="mb-3 text-sm text-ink/60">
          Name and email are always collected. Add, remove, or require any
          other fields below — changes apply to the public application form
          immediately.
        </p>
        <div className="card divide-y divide-line p-0">
          {settings.application_form_fields.map((field) => (
            <div key={field.key} className="flex items-center justify-between p-3">
              <div>
                <p className="text-sm font-medium text-ink">{field.label}</p>
                <p className="text-xs text-ink/50">{field.type}</p>
              </div>
              <div className="flex items-center gap-3">
                <label className="flex items-center gap-1.5 text-xs text-ink/70">
                  <input
                    type="checkbox"
                    checked={field.required}
                    onChange={() => toggleRequired(field.key)}
                  />
                  Required
                </label>
                <button
                  onClick={() => removeField(field.key)}
                  className="text-xs font-medium text-clay hover:underline"
                >
                  Remove
                </button>
              </div>
            </div>
          ))}
        </div>

        <div className="card mt-3 flex items-end gap-3">
          <div className="flex-1">
            <label className="label">New field label</label>
            <input
              className="input"
              placeholder="e.g. Pets, Move-in date"
              value={newField.label}
              onChange={(e) => setNewField((f) => ({ ...f, label: e.target.value }))}
            />
          </div>
          <select
            className="input w-32"
            value={newField.type}
            onChange={(e) =>
              setNewField((f) => ({ ...f, type: e.target.value as ApplicationField["type"] }))
            }
          >
            <option value="text">Text</option>
            <option value="number">Number</option>
            <option value="textarea">Long text</option>
            <option value="date">Date</option>
            <option value="file">File upload</option>
          </select>
          <button onClick={addField} className="btn-primary">
            Add field
          </button>
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-ink/50">
          Lease template
        </h2>
        <p className="mb-3 text-sm text-ink/60">
          Upload your own lease PDF once. It's sent to Documenso as a
          reusable template — you'll get a link to place the signature and
          text fields on it there, and every lease you send after that reuses
          those same placements automatically.
        </p>
        <div className="card">
          {settings.documenso_template_id ? (
            <p className="mb-3 text-sm text-forest">
              Template uploaded and ready ({settings.lease_template_url}).
            </p>
          ) : (
            <p className="mb-3 text-sm text-ink/50">
              No lease template uploaded yet — leases will use a simple
              generated PDF until you add one.
            </p>
          )}
          <input
            type="file"
            accept="application/pdf"
            disabled={uploading}
            onChange={(e) => e.target.files?.[0] && uploadLeaseTemplate(e.target.files[0])}
            className="text-sm"
          />
          {uploading && <p className="mt-2 text-xs text-ink/50">Uploading…</p>}
          {templateEditorUrl && (
            <a
              href={templateEditorUrl}
              target="_blank"
              className="mt-3 inline-block text-sm font-medium text-forest hover:underline"
            >
              Open Documenso to place signature fields ↗
            </a>
          )}
        </div>
      </section>
    </div>
  );
}
