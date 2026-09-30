import type { EmailStatus } from "../../types/api";

const styles: Record<EmailStatus, string> = {
  scheduled: "bg-amber-50 text-amber-700 ring-amber-200",
  sending: "bg-brand-50 text-brand-700 ring-brand-100",
  sent: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  failed: "bg-red-50 text-red-700 ring-red-200",
};

export function StatusBadge({ status }: { status: EmailStatus }) {
  return (
    <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ring-1 ring-inset ${styles[status]}`}>
      {status}
    </span>
  );
}
