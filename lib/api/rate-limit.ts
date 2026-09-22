// Task Aura — In-Memory Sliding Window Rate Limiter
// Prevents endpoint abuse on sensitive routes.

interface RateLimitRecord {
  timestamps: number[];
}

const rateLimitBuckets = new Map<string, RateLimitRecord>();

// Clean up stale entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, record] of rateLimitBuckets.entries()) {
    record.timestamps = record.timestamps.filter((t) => now - t < 60_000);
    if (record.timestamps.length === 0) {
      rateLimitBuckets.delete(key);
    }
  }
}, 5 * 60_000).unref();

export interface RateLimitOptions {
  limit: number;
  windowMs: number;
}

export function checkRateLimit(
  identifier: string,
  options: RateLimitOptions = { limit: 30, windowMs: 60_000 }
): { allowed: boolean; remaining: number; resetMs: number } {
  // Disable during automated testing if flagged
  if (process.env.DISABLE_RATE_LIMIT === "true") {
    return { allowed: true, remaining: options.limit, resetMs: 0 };
  }

  const now = Date.now();
  let record = rateLimitBuckets.get(identifier);
  if (!record) {
    record = { timestamps: [] };
    rateLimitBuckets.set(identifier, record);
  }

  // Filter out timestamps outside window
  record.timestamps = record.timestamps.filter(
    (t) => now - t < options.windowMs
  );

  if (record.timestamps.length >= options.limit) {
    const oldest = record.timestamps[0];
    const resetMs = Math.max(0, options.windowMs - (now - oldest));
    return {
      allowed: false,
      remaining: 0,
      resetMs,
    };
  }

  record.timestamps.push(now);
  return {
    allowed: true,
    remaining: options.limit - record.timestamps.length,
    resetMs: options.windowMs,
  };
}
