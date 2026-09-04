// Deploy with: supabase functions deploy send-lease-for-signature
// Secrets needed: DOCUMENSO_API_KEY, DOCUMENSO_API_URL (e.g.
//   https://app.documenso.com/api/v1 for Documenso Cloud, or your
//   self-hosted instance's URL), SUPABASE_SERVICE_ROLE_KEY, SUPABASE_URL
//
// Called from the frontend like:
//   supabase.functions.invoke('send-lease-for-signature', { body: { leaseId } })
//
// What it does: builds a simple lease PDF with the terms already on the
// lease record, uploads it to Documenso, and sends it to the tenant to
// sign. Documenso emails the tenant a signing link directly.

// NOTE: check Documenso's current API docs before relying on this — both
// the plain-document endpoints below and the template-based
// generate-document endpoint used above are the parts most likely to have
// changed since this was written.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { PDFDocument, StandardFonts, rgb } from "npm:pdf-lib@1.17.1";

const DOCUMENSO_API_URL = Deno.env.get("DOCUMENSO_API_URL")!;
const DOCUMENSO_API_KEY = Deno.env.get("DOCUMENSO_API_KEY")!;

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

Deno.serve(async (req) => {
  try {
    const { leaseId } = await req.json();

    const { data: lease, error } = await supabase
      .from("leases")
      .select("*, tenants(full_name, email), units(unit_number, properties(name, address, city))")
      .eq("id", leaseId)
      .single();

    if (error || !lease) return json({ error: "Lease not found" }, 404);

    const { data: settings } = await supabase
      .from("settings")
      .select("documenso_template_id")
      .single();

    // If the admin has uploaded their own lease template with fields already
    // placed in Documenso, use that instead of generating a plain PDF.
    if (settings?.documenso_template_id) {
      const sendRes = await fetch(
        `${DOCUMENSO_API_URL}/templates/${settings.documenso_template_id}/generate-document`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${DOCUMENSO_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            title: `Lease — Unit ${lease.units?.unit_number}`,
            recipients: [
              { name: lease.tenants.full_name, email: lease.tenants.email, role: "SIGNER" },
            ],
          }),
        }
      );
      const sendData = await sendRes.json();
      if (!sendRes.ok) return json({ error: sendData }, 500);

      await supabase
        .from("leases")
        .update({ status: "sent", documenso_document_id: String(sendData.documentId) })
        .eq("id", leaseId);

      return json({ success: true });
    }

    const property = lease.units?.properties;
    const pdfBytes = await buildLeasePdf({
      tenantName: lease.tenants.full_name,
      propertyName: property?.name ?? "",
      address: `${property?.address ?? ""}, ${property?.city ?? ""}`,
      unitNumber: lease.units?.unit_number ?? "",
      startDate: lease.start_date,
      endDate: lease.end_date,
      rentAmount: lease.rent_amount,
      depositAmount: lease.deposit_amount,
    });

    // 1. upload the document to Documenso
    const uploadRes = await fetch(`${DOCUMENSO_API_URL}/documents`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${DOCUMENSO_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        title: `Lease — Unit ${lease.units?.unit_number}`,
        recipients: [
          {
            name: lease.tenants.full_name,
            email: lease.tenants.email,
            role: "SIGNER",
          },
        ],
      }),
    });
    const uploadData = await uploadRes.json();
    if (!uploadRes.ok) return json({ error: uploadData }, 500);

    // 2. push the actual PDF bytes to the upload URL Documenso gave us
    await fetch(uploadData.uploadUrl, {
      method: "PUT",
      headers: { "Content-Type": "application/pdf" },
      body: pdfBytes,
    });

    // 3. send it for signature
    await fetch(`${DOCUMENSO_API_URL}/documents/${uploadData.documentId}/send`, {
      method: "POST",
      headers: { Authorization: `Bearer ${DOCUMENSO_API_KEY}` },
    });

    await supabase
      .from("leases")
      .update({
        status: "sent",
        documenso_document_id: String(uploadData.documentId),
      })
      .eq("id", leaseId);

    return json({ success: true });
  } catch (err) {
    return json({ error: String(err) }, 500);
  }
});

async function buildLeasePdf(terms: {
  tenantName: string;
  propertyName: string;
  address: string;
  unitNumber: string;
  startDate: string;
  endDate: string;
  rentAmount: number;
  depositAmount: number;
}) {
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  let y = 720;

  const line = (text: string, opts: { size?: number; useBold?: boolean; gap?: number } = {}) => {
    page.drawText(text, {
      x: 60,
      y,
      size: opts.size ?? 11,
      font: opts.useBold ? bold : font,
      color: rgb(0.13, 0.12, 0.11),
    });
    y -= opts.gap ?? 22;
  };

  line("Residential lease agreement", { size: 18, useBold: true, gap: 36 });
  line(`Property: ${terms.propertyName}, Unit ${terms.unitNumber}`);
  line(`Address: ${terms.address}`);
  line(`Tenant: ${terms.tenantName}`, { gap: 32 });
  line(`Lease term: ${terms.startDate} to ${terms.endDate}`);
  line(`Monthly rent: $${terms.rentAmount}`);
  line(`Security deposit: $${terms.depositAmount}`, { gap: 40 });
  line(
    "By signing below, the tenant agrees to pay rent on the 1st of each month",
    { size: 10, gap: 16 }
  );
  line("and to abide by the terms of this lease for the duration above.", {
    size: 10,
    gap: 48,
  });
  line("Tenant signature: ______________________  Date: ____________", {
    gap: 22,
  });

  return doc.save();
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
