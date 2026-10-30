import type { PublicInvoice } from "@/lib/invoice-share";

/**
 * Slot for "how to pay" on the public invoice page (issue #93). Issue #94 fills it with the bank
 * accounts / QRIS chosen for the invoice and the proof-of-transfer upload. Renders nothing until
 * then, so the page layout already has a stable place for it (screen and print).
 */
export function InvoicePaymentInstructions({ invoice }: { invoice: PublicInvoice }) {
  void invoice;
  return null;
}
