import type { EmailItem, EmailView } from "../../types/api";
import { formatDateTime } from "../../lib/format";
import { DataTable, type Column } from "../ui/DataTable";
import { StatusBadge } from "../ui/StatusBadge";

interface Props {
  view: EmailView;
  rows: EmailItem[];
  loading: boolean;
  error: string | null;
  searching: boolean;
}

const base: Column<EmailItem>[] = [
  { header: "Email", cell: (r) => <span className="font-medium">{r.email}</span> },
  { header: "Subject", cell: (r) => <span className="line-clamp-1 max-w-xs">{r.subject}</span> },
];

const scheduledCols: Column<EmailItem>[] = [
  ...base,
  { header: "Scheduled time", cell: (r) => formatDateTime(r.scheduledAt) },
  {
    header: "Status",
    cell: (r) => (
      <span className="flex items-center gap-2">
        <StatusBadge status={r.status} />
        {r.deferrals > 0 && <span className="text-xs text-mute" title="Delayed by the hourly rate limit">rate-limited</span>}
      </span>
    ),
  },
];

const sentCols: Column<EmailItem>[] = [
  ...base,
  { header: "Sent time", cell: (r) => formatDateTime(r.sentAt) },
  {
    header: "Status",
    cell: (r) => (
      <span className="flex items-center gap-2">
        <StatusBadge status={r.status} />
        {r.previewUrl && (
          <a href={r.previewUrl} target="_blank" rel="noreferrer" className="text-xs text-brand-600 hover:underline">
            preview
          </a>
        )}
        {r.error && <span className="max-w-[14rem] truncate text-xs text-red-600" title={r.error}>{r.error}</span>}
      </span>
    ),
  },
];

/** One table for both tabs — only the column set and empty-state copy differ. */
export function EmailTable({ view, rows, loading, error, searching }: Props) {
  const empty = searching
    ? { title: "No matching emails", hint: "Try a different search term." }
    : view === "scheduled"
      ? { title: "No scheduled emails", hint: "Click “Compose New Email” to schedule a campaign." }
      : { title: "Nothing sent yet", hint: "Emails appear here once they have been delivered." };

  return (
    <DataTable
      columns={view === "scheduled" ? scheduledCols : sentCols}
      rows={rows}
      rowKey={(r) => r.id}
      loading={loading}
      error={error}
      empty={empty}
    />
  );
}
