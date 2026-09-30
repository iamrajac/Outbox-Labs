import { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { env } from "../config/env";

export interface SessionUser {
  id: number;
}

declare module "express-serve-static-core" {
  interface Request {
    user?: SessionUser;
  }
}

export const SESSION_COOKIE = "outbox_session";

export const signSession = (id: number): string => jwt.sign({ id }, env.jwtSecret, { expiresIn: "7d" });

export function readSession(req: Request): SessionUser | null {
  const token = req.cookies?.[SESSION_COOKIE];
  if (!token) return null;
  try {
    const p = jwt.verify(token, env.jwtSecret) as { id: number };
    return { id: p.id };
  } catch {
    return null;
  }
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const user = readSession(req);
  if (!user) return res.status(401).json({ error: "Not authenticated" });
  req.user = user;
  next();
}
