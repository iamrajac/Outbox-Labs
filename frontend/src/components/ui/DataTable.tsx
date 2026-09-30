import type { ReactNode } from "react";
import { Spinner } from "./Spinner";

export interface Column<T> {
  header: string;
  cell: (row: T) => ReactNode;
  className?: string;
}

interface Props<T> {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  loading: boolean;
  error?: string | null;
  empty: { title: string; hint: string };
}

/** Generic table with built-in loading, error and empty states. */
export function DataTable<T>({ columns, rows, rowKey, loading, error, empty }: Props<T>) {
  if (loading && !rows.length) {
    return (
      <div className="flex items-center justify-center gap-3 py-20 text-mute">
        <Spinner /> Loading…
      </div>
    );
  }
  if (error) return <div className="py-16 text-center text-sm text-red-600">{error}</div>;
  if (!rows.length) {
    return (
      <div className="py-20 text-center">
        <p className="font-medium">{empty.title}</p>
        <p className="mt-1 text-sm text-mute">{empty.hint}</p>
      </div>
    );
  }
  return (
    <div className={`overflow-x-auto transition-opacity ${loading ? "opacity-60" : ""}`}>
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-line text-xs uppercase tracking-wide text-mute">
            {columns.map((c) => (
              <th key={c.header} className={`px-5 py-3 font-medium ${c.className ?? ""}`}>
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={rowKey(r)} className="border-b border-line/70 last:border-0 hover:bg-canvas/60">
              {columns.map((c) => (
                <td key={c.header} className={`px-5 py-3.5 ${c.className ?? ""}`}>
                  {c.cell(r)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
