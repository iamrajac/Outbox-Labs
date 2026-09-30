export const formatDateTime = (iso: string | null): string =>
  iso
    ? new Date(iso).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", second: "2-digit" })
    : "—";

/** ISO string -> value accepted by <input type="datetime-local"> (local time). */
export const toLocalInput = (d: Date): string => {
  const off = d.getTimezoneOffset() * 60_000;
  return new Date(d.getTime() - off).toISOString().slice(0, 16);
};
