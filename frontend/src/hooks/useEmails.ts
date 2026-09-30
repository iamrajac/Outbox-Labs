import { useCallback, useEffect, useState } from "react";
import { emailApi } from "../api/endpoints";
import type { EmailPage, EmailView } from "../types/api";

const POLL_MS = 5000;

/** Loads one tab of emails, re-fetching on search/page changes and polling for live status updates. */
export function useEmails(view: EmailView, q: string, page: number, refreshKey = 0) {
  const [data, setData] = useState<EmailPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await emailApi.list(view, { q, page }));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load emails");
    } finally {
      setLoading(false);
    }
  }, [view, q, page]);

  useEffect(() => {
    setLoading(true);
    void load();
    const t = setInterval(load, POLL_MS);
    return () => clearInterval(t);
  }, [load, refreshKey]);

  return { data, loading, error };
}
