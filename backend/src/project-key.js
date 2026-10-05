import { createHash, randomBytes } from "node:crypto";

export const generateIngestionKey = () => `uxl_${randomBytes(32).toString("base64url")}`;

export const hashIngestionKey = (key) => createHash("sha256").update(key, "utf8").digest("hex");