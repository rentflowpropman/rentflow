import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import SignOutButton from "@/components/SignOutButton";

export default async function PortalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  // an owner/staff landing on /portal (stale bookmark, role just changed,
  // etc.) belongs in /admin instead
  if (profile?.role === "owner" || profile?.role === "staff") redirect("/admin");

  // claim any tenant row that matches this email but isn't linked yet
  await supabase
    .from("tenants")
    .update({ user_id: user.id })
    .eq("email", user.email)
    .is("user_id", null);

  return (
    <div className="min-h-screen">
      <header className="border-b border-line bg-white">
        <div className="mx-auto flex max-w-2xl items-center justify-between px-4 py-4">
          <span className="text-lg font-semibold text-ink">RentFlow</span>
          <SignOutButton />
        </div>
      </header>
      <main className="mx-auto max-w-2xl px-4 py-8">{children}</main>
    </div>
  );
}
