# RentFlow

A simple property management app: applications → leases → tenant portal → rent
collection. No server to run yourself — Next.js talks directly to Supabase
(Postgres + Auth) from the browser, secured with Row Level Security.

## 1. Create a Supabase project

1. Go to [supabase.com](https://supabase.com) → New Project (free tier is fine).
2. Once it's ready, open **SQL Editor → New query**, paste in the entire
   contents of `supabase/schema.sql`, and run it. This creates every table
   and security policy.
3. Go to **Project Settings → API** and copy the **Project URL** and
   **anon public key**.

## 2. Configure the app

```bash
cp .env.local.example .env.local
```

Paste your Project URL and anon key into `.env.local`.

## 3. Install and run

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## 4. Make yourself the owner

1. Go to `/login`, enter your email, and click the magic link Supabase emails
   you. This creates your account (everyone starts as a `tenant` by default).
2. Back in Supabase's **SQL Editor**, run:
   ```sql
   update profiles set role = 'owner' where id =
     (select id from auth.users where email = 'you@example.com');
   ```
3. Refresh the app — you'll now land in `/admin` with full access.

## 4b. Add staff

From **Settings → Team**, invite a teammate by email and choose **Staff** or
**Owner**. When they sign in at `/login` for the first time with that email,
they're automatically given that role — no manual SQL needed after the
first owner.

**Staff** can handle properties, applications, tenant approval, and leases —
day-to-day operations — and can see who's paid on the Tenants/Leases pages.
They cannot see **Finances** (rent totals, expenses) or **Settings**
(application form config, lease templates, team management) — those nav
items don't even appear for them, and the pages redirect if visited
directly.

**Owner** is full access to everything, including inviting more owners or
staff.

## 5. Set up Stripe (rent collection + autopay)

1. Create a [Stripe account](https://dashboard.stripe.com/register) (test mode is fine to start).
2. Install the [Supabase CLI](https://supabase.com/docs/guides/cli) and log in, then link this project:
   ```bash
   supabase login
   supabase link --project-ref YOUR_PROJECT_REF
   ```
3. Set the secrets the Edge Functions need:
   ```bash
   supabase secrets set STRIPE_SECRET_KEY=sk_test_...
   supabase secrets set RESEND_API_KEY=re_...
   ```
4. Deploy the three functions:
   ```bash
   supabase functions deploy create-checkout-session
   supabase functions deploy charge-rent
   supabase functions deploy stripe-webhook --no-verify-jwt
   ```
5. In the Stripe Dashboard → **Developers → Webhooks**, add an endpoint:
   `https://YOUR_PROJECT_REF.supabase.co/functions/v1/stripe-webhook`
   listening for `checkout.session.completed`, `payment_intent.succeeded`,
   and `payment_intent.payment_failed`. Copy the signing secret it gives you
   and set it:
   ```bash
   supabase secrets set STRIPE_WEBHOOK_SECRET=whsec_...
   ```
6. To turn on daily autopay charging, uncomment the `pg_cron` block at the
   bottom of `supabase/schema.sql`, fill in your project ref and service
   role key, and run it in the SQL Editor.

**How it works day to day:** a tenant clicks "Pay now" for a one-off payment,
or "Enable autopay" once to save a card/bank account for future rent — after
that, `charge-rent` runs daily and automatically withdraws rent from
autopay-enrolled tenants on their due date. Either way, only the Stripe
webhook ever marks a payment `paid` — never the browser — so a closed tab or
a declined card can't falsely show as paid.

## 6. Set up rent reminders

Deploy and secret-set are already covered if you did step 5 (same
`RESEND_API_KEY`). Just deploy the function and add its cron entry:

```bash
supabase functions deploy send-rent-reminders
```

Uncomment the `send-rent-reminders-daily` block at the bottom of
`supabase/schema.sql` (below the `charge-rent-daily` one), fill in your
project ref and service role key, and run it in the SQL Editor.

Tenants get a reminder 3 days before rent is due (skipped if they're on
autopay — nothing for them to do), and a late notice once a payment is
overdue and unpaid.

## 7. Set up e-signatures (Documenso)

1. Create a [Documenso](https://documenso.com) account (cloud or self-hosted)
   and generate an API key from Settings → API.
2. Set secrets:
   ```bash
   supabase secrets set DOCUMENSO_API_KEY=...
   supabase secrets set DOCUMENSO_API_URL=https://app.documenso.com/api/v1
   supabase secrets set DOCUMENSO_WEBHOOK_SECRET=your-own-random-string
   ```
3. Deploy the two functions:
   ```bash
   supabase functions deploy send-lease-for-signature
   supabase functions deploy documenso-webhook --no-verify-jwt
   supabase functions deploy create-lease-template
   ```
4. In Documenso → Settings → Webhooks, add an endpoint pointing at
   `https://YOUR_PROJECT_REF.supabase.co/functions/v1/documenso-webhook`,
   set the same secret you used above, and subscribe to the document-completed
   event.

**Important:** Documenso's exact API request/response shape and webhook
payload can change — the code follows their most commonly documented
contract, but check it against Documenso's current API docs before relying
on it in production, and adjust field names in
`send-lease-for-signature/index.ts` and `documenso-webhook/index.ts` if
they've changed.

**How it works:** on a draft lease, click **Send for signature** — this
generates a simple lease PDF from the lease terms already on file and sends
it through Documenso, which emails the tenant a signing link. Once they
sign, Documenso's webhook fires, which is what actually marks the lease
signed, generates the payment schedule, marks the unit occupied, and emails
the tenant — the same sequence "Mark signed manually" (still there as a
fallback) does by hand.

## 9. Customize your application form and use your own lease

Both are configured on the **Settings** page of the admin dashboard, no code
changes needed:

- **Application fields**: add or remove any field beyond name/email (income,
  pets, move-in date, whatever you want), and mark any of them required. The
  public application form updates immediately.
- **Your own lease PDF**: upload it once. It's sent to Documenso as a
  reusable template — click the link Settings gives you back to open
  Documenso's own editor and drag the signature/date/text fields onto your
  actual document (a one-time setup per template). Every lease you send
  after that reuses those exact field placements, filled in with each
  tenant's info automatically. Until you upload one, leases fall back to a
  simple generated PDF.

## 10. Core loop

1. **Admin**: add a property, then add a unit. Click "Copy apply link" next
   to a unit — that's the public application URL
   (`/apply/[unit-id]`) you send to prospective tenants.
2. **Applicant**: fills out the form at that link. No login required.
3. **Admin**: the application shows up on the dashboard. Click **Approve** —
   this creates the tenant record, a draft lease, and emails the applicant.
4. **Admin**: go to **Leases**, click **Send for signature** — Documenso
   emails the tenant a lease to sign. Once signed, this automatically
   generates 12 months of rent payments plus the deposit, marks the unit
   occupied, and emails the tenant. (Or click **Mark signed manually** to
   skip e-signature entirely.)
5. **Tenant**: signs in at `/login` with the *same email* they applied with —
   their account automatically links to their tenant record and lease.
   They land on `/portal`, see their balance, pay via Stripe Checkout (card
   or bank account), optionally turn on autopay, and see payment history.

## What's still a placeholder

Both e-signatures and rent reminders are now wired up (see steps 6-7 above).
The one thing left unaddressed: Documenso's API contract isn't something
this build has been tested against live, so double-check the request/response
shapes in `send-lease-for-signature` and `documenso-webhook` against
Documenso's current docs before relying on it for a real lease.

## Project structure

```
app/
  admin/          — landlord dashboard (properties, tenants, leases, finances)
  apply/[unitId]/ — public application form, no login required
  portal/         — tenant-facing portal
  login/          — passwordless magic-link sign-in
lib/supabase/     — browser + server Supabase clients
supabase/schema.sql — full database schema + RLS policies
```
