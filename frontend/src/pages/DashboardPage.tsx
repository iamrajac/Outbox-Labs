import { useState } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import { useDebounced } from "../hooks/useDebounced";
import { useEmails } from "../hooks/useEmails";
import type { EmailView } from "../types/api";
import { Header } from "../components/layout/Header";
import { EmailTable } from "../components/emails/EmailTable";
import { ComposeModal } from "../components/emails/ComposeModal";
import { SlackCard } from "../components/emails/SlackCard";
import { Button } from "../components/ui/Button";
import { Input } from "../components/ui/Field";
import { Spinner } from "../components/ui/Spinner";

const TABS: { id: EmailView; label: string }[] = [
  { id: "scheduled", label: "Scheduled Emails" },
  { id: "sent", label: "Sent Emails" },
];

export function DashboardPage() {
  const { user, loading: authLoading } = useAuth();
  const [view, setView] = useState<EmailView>("scheduled");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [composeOpen, setComposeOpen] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  const q = useDebounced(search.trim());
  const { data, loading, error } = useEmails(view, q, page, refreshKey);

  if (authLoading) return <div className="flex h-screen items-center justify-center"><Spinner /></div>;
  if (!user) return <Navigate to="/login" replace />;

  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.limit)) : 1;
  const switchTab = (v: EmailView) => {
    setView(v);
    setPage(1);
  };

  return (
    <>
      <Header />
      <main className="mx-auto max-w-6xl space-y-5 px-4 py-8 sm:px-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-2xl font-semibold">Dashboard</h1>
          <div className="flex items-center gap-2">
            <a href="/admin/queues" target="_blank" rel="noreferrer">
              <Button variant="secondary">Queue monitor</Button>
            </a>
            <Button onClick={() => setComposeOpen(true)}>+ Compose New Email</Button>
          </div>
        </div>

        <SlackCard />

        <section className="rounded-xl border border-line bg-white">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 pt-3">
            <div className="flex gap-6" role="tablist">
              {TABS.map((t) => (
                <button
                  key={t.id}
                  role="tab"
                  aria-selected={view === t.id}
                  onClick={() => switchTab(t.id)}
                  className={`-mb-px border-b-2 pb-3 text-sm font-medium transition ${
                    view === t.id ? "border-brand-500 text-brand-600" : "border-transparent text-mute hover:text-ink"
                  }`}
                >
                  {t.label}
                  {view === t.id && data && <span className="ml-2 rounded-full bg-brand-50 px-2 py-0.5 text-xs">{data.total}</span>}
                </button>
              ))}
            </div>
            <div className="w-full pb-3 sm:w-64">
              <Input
                type="search"
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(1);
                }}
                placeholder="Search email, subject, body…"
                aria-label="Search emails"
              />
            </div>
          </div>

          <EmailTable view={view} rows={data?.items ?? []} loading={loading} error={error} searching={!!q} />

          {data && data.total > data.limit && (
            <div className="flex items-center justify-between border-t border-line px-5 py-3 text-sm text-mute">
              <span>
                Page {page} of {totalPages}
              </span>
              <div className="flex gap-2">
                <Button variant="secondary" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                  Previous
                </Button>
                <Button variant="secondary" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
                  Next
                </Button>
              </div>
            </div>
          )}
        </section>
      </main>

      <ComposeModal
        open={composeOpen}
        onClose={() => setComposeOpen(false)}
        onScheduled={() => {
          setView("scheduled");
          setPage(1);
          setRefreshKey((k) => k + 1);
        }}
      />
    </>
  );
}
