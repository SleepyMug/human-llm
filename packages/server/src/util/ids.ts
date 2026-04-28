import { randomBytes } from "node:crypto";

export function generateRequestId(): string {
  return `chatcmpl-${randomBytes(12).toString("base64url")}`;
}
