import { createHash } from "node:crypto";

type RateLimitResult = {
  limit: number;
  remaining: number;
  resetInSeconds: number;
  success: boolean;
};

const memoryStore = new Map<string, number[]>();

function getRateLimitKey(ip: string) {
  return createHash("sha256").update(ip).digest("hex");
}

function getCurrentHourBucket() {
  const now = new Date();
  return `${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, "0")}${String(now.getUTCDate()).padStart(2, "0")}${String(now.getUTCHours()).padStart(2, "0")}`;
}

function getSecondsUntilHourReset() {
  const now = new Date();
  const nextHour = new Date(now);
  nextHour.setUTCMinutes(60, 0, 0);

  return Math.max(1, Math.ceil((nextHour.getTime() - now.getTime()) / 1000));
}

async function applyUpstashLimit(ip: string, limit: number) {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;

  if (!url || !token) {
    return null;
  }

  const bucket = getCurrentHourBucket();
  const secondsToReset = getSecondsUntilHourReset();
  const key = `audit:${bucket}:${getRateLimitKey(ip)}`;

  const incrementResponse = await fetch(`${url}/incr/${key}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (!incrementResponse.ok) {
    return null;
  }

  const incrementJson = (await incrementResponse.json()) as { result?: number };
  const currentCount = Number(incrementJson.result ?? 0);

  if (currentCount === 1) {
    await fetch(`${url}/expire/${key}/${secondsToReset}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });
  }

  return {
    limit,
    remaining: Math.max(0, limit - currentCount),
    resetInSeconds: secondsToReset,
    success: currentCount <= limit,
  } satisfies RateLimitResult;
}

function applyMemoryLimit(ip: string, limit: number) {
  const now = Date.now();
  const windowMs = 60 * 60 * 1000;
  const key = getRateLimitKey(ip);
  const existing = memoryStore.get(key) ?? [];
  const fresh = existing.filter((timestamp) => now - timestamp < windowMs);
  fresh.push(now);
  memoryStore.set(key, fresh);

  const oldest = fresh[0] ?? now;
  const resetInSeconds = Math.max(
    1,
    Math.ceil((windowMs - (now - oldest)) / 1000),
  );

  return {
    limit,
    remaining: Math.max(0, limit - fresh.length),
    resetInSeconds,
    success: fresh.length <= limit,
  } satisfies RateLimitResult;
}

export async function rateLimitAudit(ip: string, limit: number) {
  return (await applyUpstashLimit(ip, limit)) ?? applyMemoryLimit(ip, limit);
}

