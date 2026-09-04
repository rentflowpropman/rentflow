import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import SignOutButton from "@/components/SignOutButton";

const NAV = [
  { href: "/admin", label: "Properties" },
  { href: "/admin/tenants", label: "Tenants" },
  { href: "/admin/leases", label: "Leases" },
  { href: "/admin/maintenance", label: "Maintenance" },
  { href: "/admin/finances", label: "Finances", ownerOnly: true },
  { href: "/admin/import", label: "Import", ownerOnly: true },
  { href: "/admin/settings", label: "Settings", ownerOnly: true },
];

export default async function AdminLayout({
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

  if (profile?.role !== "owner" && profile?.role !== "staff") redirect("/portal");

  const isOwner = profile.role === "owner";
  const nav = NAV.filter((item) => !item.ownerOnly || isOwner);

  return (
    <div className="min-h-screen">
      <header className="border-b border-line bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-4">
          <span className="text-lg font-semibold text-ink">RentalEasier</span>
          <nav className="flex items-center gap-1">
            {nav.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="rounded px-3 py-1.5 text-sm font-medium text-ink/70 hover:bg-sand hover:text-ink"
              >
                {item.label}
              </Link>
            ))}
            <SignOutButton />
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-8">{children}</main>
    </div>
  );
}
