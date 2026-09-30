export interface User {
  id: number;
  email: string;
  name: string;
  avatarUrl: string | null;
}

export type EmailStatus = "scheduled" | "sending" | "sent" | "failed";
export type EmailView = "scheduled" | "sent";

export interface EmailItem {
  id: string;
  email: string;
  subject: string;
  status: EmailStatus;
  scheduledAt: string;
  sentAt: string | null;
  previewUrl: string | null;
  error: string | null;
  deferrals: number;
}

export interface EmailPage {
  items: EmailItem[];
  total: number;
  page: number;
  limit: number;
  searchEngine: "elasticsearch" | "sql" | null;
}

export interface ScheduleRequest {
  subject: string;
  body: string;
  recipients: string[];
  startTime: string;
  delaySeconds: number;
  hourlyLimit?: number;
}

export interface ScheduleResponse {
  batchId: string;
  scheduled: number;
  skippedInvalidOrDuplicate: number;
  firstSendAt: string;
  lastSendAt: string;
}

export interface SlackStatus {
  connected: boolean;
  teamName: string | null;
  channel: string | null;
}
