import nodemailer, { Transporter } from "nodemailer";
import { pool } from "../db/pool";
import { env } from "../config/env";
import { logger } from "../utils/logger";

export interface Sender {
  id: number;
  email: string;
  smtp_host: string;
  smtp_port: number;
  smtp_user: string;
  smtp_pass: string;
}

/** Make sure the pool has SENDER_COUNT sender identities (Ethereal accounts, created on demand). */
export async function ensureSenders(): Promise<Sender[]> {
  const { rows } = await pool.query<Sender>("SELECT * FROM senders ORDER BY id");
  const missing = env.senderCount - rows.length;
  for (let i = 0; i < missing; i++) {
    const acct =
      env.mailTransport === "ethereal"
        ? await nodemailer.createTestAccount()
        : { user: `local${rows.length + i + 1}@local.test`, pass: "local", smtp: { host: "localhost", port: 0 } };
    const ins = await pool.query<Sender>(
      `INSERT INTO senders (email, smtp_host, smtp_port, smtp_user, smtp_pass)
       VALUES ($1,$2,$3,$4,$5) ON CONFLICT (email) DO NOTHING RETURNING *`,
      [acct.user, acct.smtp.host, acct.smtp.port, acct.user, acct.pass],
    );
    if (ins.rows[0]) rows.push(ins.rows[0]);
    logger.info({ sender: acct.user }, "created sender");
  }
  return rows;
}

const transports = new Map<number, Transporter>();

export function transportFor(sender: Sender): Transporter {
  let t = transports.get(sender.id);
  if (!t) {
    t =
      env.mailTransport === "ethereal"
        ? nodemailer.createTransport({
            host: sender.smtp_host,
            port: sender.smtp_port,
            secure: false,
            auth: { user: sender.smtp_user, pass: sender.smtp_pass },
          })
        : nodemailer.createTransport({ streamTransport: true, buffer: true });
    transports.set(sender.id, t);
  }
  return t;
}

export async function getSender(id: number): Promise<Sender> {
  const { rows } = await pool.query<Sender>("SELECT * FROM senders WHERE id=$1", [id]);
  if (!rows[0]) throw new Error(`Sender ${id} not found`);
  return rows[0];
}
