import { createClient } from "@/lib/supabase/client";

export async function sendEmail(to: string, subject: string, html: string) {
  const supabase = createClient();
  const { error } = await supabase.functions.invoke("send-email", {
    body: { to, subject, html },
  });
  if (error) {
    console.error("Email failed to send:", error);
  }
}

export const emailTemplates = {
  applicationApproved: (name: string, portalUrl: string) => ({
    subject: "Your rental application was approved",
    html: `<p>Hi ${name},</p>
      <p>Good news — your application has been approved. We'll follow up shortly with your lease to sign.</p>
      <p>Once it's signed, you'll be able to sign in and manage everything at <a href="${portalUrl}">${portalUrl}</a>.</p>`,
  }),
  applicationDenied: (name: string) => ({
    subject: "Update on your rental application",
    html: `<p>Hi ${name},</p>
      <p>Thanks for applying. Unfortunately we won't be moving forward with your application at this time.</p>`,
  }),
  leaseSigned: (name: string, unitNumber: string, portalUrl: string) => ({
    subject: "Your lease is signed — welcome!",
    html: `<p>Hi ${name},</p>
      <p>Your lease for Unit ${unitNumber} is now signed and active.</p>
      <p>Sign in any time at <a href="${portalUrl}">${portalUrl}</a> with this email address to see your rent
      schedule, make payments, and submit maintenance requests.</p>`,
  }),
  paymentReceived: (name: string, amount: number, type: string) => ({
    subject: `Payment received — $${amount}`,
    html: `<p>Hi ${name},</p>
      <p>We've recorded your ${type} payment of $${amount}. Thanks!</p>`,
  }),
  rentOverdue: (name: string, amount: number, dueDate: string) => ({
    subject: "Your rent payment is overdue",
    html: `<p>Hi ${name},</p>
      <p>Our records show $${amount} rent due ${dueDate} hasn't been received yet.
      Please take care of this as soon as you can, or reach out if there's an issue.</p>`,
  }),
};
