import { useMemo, useState, type ChangeEvent, type FormEvent } from "react";
import { emailApi } from "../../api/endpoints";
import { extractEmails } from "../../lib/leads";
import { toLocalInput } from "../../lib/format";
import { Button } from "../ui/Button";
import { Field, Input, Textarea } from "../ui/Field";
import { Modal } from "../ui/Modal";
import { useToast } from "../ui/Toast";

interface Props {
  open: boolean;
  onClose: () => void;
  onScheduled: () => void;
}

const defaultStart = () => toLocalInput(new Date(Date.now() + 60_000));

export function ComposeModal({ open, onClose, onScheduled }: Props) {
  const toast = useToast();
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [recipients, setRecipients] = useState<string[]>([]);
  const [start, setStart] = useState(defaultStart);
  const [delay, setDelay] = useState(5);
  const [hourly, setHourly] = useState(50);
  const [submitting, setSubmitting] = useState(false);

  const eta = useMemo(() => {
    if (!recipients.length) return null;
    const last = new Date(new Date(start).getTime() + (recipients.length - 1) * delay * 1000);
    return Number.isNaN(last.getTime()) ? null : last.toLocaleString();
  }, [recipients, start, delay]);

  const onFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    const found = extractEmails(await file.text());
    setRecipients(found);
    if (!found.length) toast("error", "No email addresses found in that file");
  };

  const reset = () => {
    setSubject("");
    setBody("");
    setFileName(null);
    setRecipients([]);
    setStart(defaultStart());
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!recipients.length) return toast("error", "Upload a CSV/text file with at least one email address");
    setSubmitting(true);
    try {
      const res = await emailApi.schedule({
        subject,
        body,
        recipients,
        startTime: new Date(start).toISOString(),
        delaySeconds: delay,
        hourlyLimit: hourly,
      });
      toast("success", `Scheduled ${res.scheduled} email${res.scheduled === 1 ? "" : "s"}`);
      reset();
      onScheduled();
      onClose();
    } catch (err) {
      toast("error", err instanceof Error ? err.message : "Could not schedule emails");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal open={open} title="Compose New Email" onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <Field label="Subject">
          <Input value={subject} onChange={(e) => setSubject(e.target.value)} required maxLength={300} placeholder="Quick question about…" />
        </Field>
        <Field label="Body">
          <Textarea value={body} onChange={(e) => setBody(e.target.value)} required rows={5} placeholder="Write your message…" />
        </Field>
        <Field
          label="Leads (CSV or text file)"
          hint={
            recipients.length ? (
              <span className="font-medium text-emerald-700">
                {recipients.length} email address{recipients.length === 1 ? "" : "es"} detected in {fileName}
              </span>
            ) : (
              "Any file containing email addresses — they are detected automatically."
            )
          }
        >
          <input
            type="file"
            accept=".csv,.txt,text/csv,text/plain"
            onChange={(e) => void onFile(e)}
            className="block w-full text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-brand-50 file:px-3 file:py-2 file:text-sm file:font-medium file:text-brand-700 hover:file:bg-brand-100"
          />
        </Field>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Start time">
            <Input type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} required />
          </Field>
          <Field label="Delay (seconds)" hint="Between emails">
            <Input type="number" min={0} step={1} value={delay} onChange={(e) => setDelay(Number(e.target.value))} required />
          </Field>
          <Field label="Hourly limit" hint="Per sender">
            <Input type="number" min={1} step={1} value={hourly} onChange={(e) => setHourly(Number(e.target.value))} required />
          </Field>
        </div>
        {eta && <p className="text-xs text-mute">Planned to finish around {eta} (later if the hourly limit kicks in).</p>}
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={submitting}>
            Schedule
          </Button>
        </div>
      </form>
    </Modal>
  );
}
