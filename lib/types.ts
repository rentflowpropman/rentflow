export type Property = {
  id: string;
  name: string;
  address: string;
  city: string | null;
  province: string | null;
  postal_code: string | null;
};

export type Unit = {
  id: string;
  property_id: string;
  unit_number: string;
  bedrooms: number | null;
  bathrooms: number | null;
  rent_amount: number;
  status: "vacant" | "occupied" | "maintenance";
};

export type Application = {
  id: string;
  unit_id: string;
  applicant_name: string;
  applicant_email: string;
  applicant_phone: string | null;
  monthly_income: number | null;
  employer: string | null;
  references_text: string | null;
  notes: string | null;
  custom_fields: Record<string, string>;
  documents: Record<string, string[]>;
  status: "pending" | "approved" | "denied";
  created_at: string;
};

export type ApplicationField = {
  key: string;
  label: string;
  type: "text" | "number" | "textarea" | "file" | "date";
  required: boolean;
};

export type Settings = {
  application_form_fields: ApplicationField[];
  documenso_template_id: string | null;
  lease_template_url: string | null;
};

export type Tenant = {
  id: string;
  user_id: string | null;
  full_name: string;
  email: string;
  phone: string | null;
  stripe_customer_id: string | null;
  stripe_payment_method_id: string | null;
  autopay_enabled: boolean;
};

export type Lease = {
  id: string;
  unit_id: string;
  tenant_id: string;
  start_date: string;
  end_date: string;
  rent_amount: number;
  deposit_amount: number;
  status: "draft" | "sent" | "signed" | "ended";
  document_url: string | null;
  documenso_document_id: string | null;
  signed_at: string | null;
};

export type Payment = {
  id: string;
  lease_id: string;
  amount: number;
  type: "rent" | "deposit" | "late_fee" | "other";
  due_date: string;
  paid_at: string | null;
  status: "due" | "paid" | "late";
};
