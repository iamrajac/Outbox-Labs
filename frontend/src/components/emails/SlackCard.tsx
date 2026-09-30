import { useCallback, useEffect, useState } from "react";
import { slackApi } from "../../api/endpoints";
import type { SlackStatus } from "../../types/api";
import { Button } from "../ui/Button";
import { useToast } from "../ui/Toast";

/** Connect / disconnect Slack (OAuth) so rate-limit alerts reach the user's workspace. */
export function SlackCard() {
  const toast = useToast();
  const [status, setStatus] = useState<SlackStatus | null>(null);

  const refresh = useCallback(() => slackApi.status().then(setStatus).catch(() => setStatus(null)), []);

  useEffect(() => {
    void refresh();
    const flag = new URLSearchParams(window.location.search).get("slack");
    if (flag === "connected") toast("success", "Slack connected");
    if (flag === "error") toast("error", "Slack connection failed");
    if (flag) window.history.replaceState({}, "", window.location.pathname);
  }, [refresh, toast]);

  if (!status) return null;

  const disconnect = async () => {
    await slackApi.disconnect();
    toast("success", "Slack disconnected");
    void refresh();
  };
  const test = async () => {
    try {
      await slackApi.test();
      toast("success", "Test message sent to Slack");
    } catch {
      toast("error", "Could not reach Slack — try reconnecting");
      void refresh();
    }
  };

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-white px-5 py-3">
      <div className="text-sm">
        <p className="font-medium">Slack alerts</p>
        <p className="text-mute">
          {status.connected
            ? `Connected${status.teamName ? ` to ${status.teamName}` : ""}${status.channel ? ` (${status.channel})` : ""} — you’ll be pinged when a sender hits its hourly limit.`
            : "Connect Slack to get notified the moment a sender hits its hourly limit."}
        </p>
      </div>
      {status.connected ? (
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => void test()}>
            Send test
          </Button>
          <Button variant="ghost" onClick={() => void disconnect()}>
            Disconnect
          </Button>
        </div>
      ) : (
        <a href="/api/slack/connect">
          <Button>Connect Slack</Button>
        </a>
      )}
    </div>
  );
}
