// Deploy with: supabase functions deploy create-lease-template
// Same secrets as send-lease-for-signature: DOCUMENSO_API_KEY, DOCUMENSO_API_URL
//
// Called from the admin settings page like:
//   supabase.functions.invoke('create-lease-template', {
//     body: { fileBase64, fileName }
//   })
//
// NOTE: as with the other Documenso functions, confirm this against
// Documenso's current "create template" API docs before relying on it —
// the template-from-PDF endpoint shape is the part most likely to have
// changed since this was written.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const DOCUMENSO_API_URL = Deno.env.get("DOCUMENSO_API_URL")!;
const DOCUMENSO_API_KEY = Deno.env.get("DOCUMENSO_API_KEY")!;

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

Deno.serve(async (req) => {
  try {
    const { fileBase64, fileName } = await req.json();
    const pdfBytes = Uint8Array.from(atob(fileBase64), (c) => c.charCodeAt(0));

    // 1. create the template shell
    const createRes = await fetch(`${DOCUMENSO_API_URL}/templates`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${DOCUMENSO_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ title: fileName || "Lease template" }),
    });
    const createData = await createRes.json();
    if (!createRes.ok) return json({ error: createData }, 500);

    // 2. upload the PDF bytes to the URL Documenso gave us
    await fetch(createData.uploadUrl, {
      method: "PUT",
      headers: { "Content-Type": "application/pdf" },
      body: pdfBytes,
    });

    // 3. save the template id + a link back to Documenso's own editor,
    // where the admin places signature/text fields once
    await supabase
      .from("settings")
      .update({
        documenso_template_id: String(createData.templateId),
        lease_template_url: fileName,
      })
      .eq("id", true);

    return json({
      success: true,
      templateId: createData.templateId,
      editorUrl:
        createData.editorUrl ??
        `${DOCUMENSO_API_URL.replace("/api/v1", "")}/templates/${createData.templateId}/edit`,
    });
  } catch (err) {
    return json({ error: String(err) }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
