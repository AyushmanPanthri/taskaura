// ============================================================
// LifeXP — Sync Service
// Maps to Logic System File v2 §2, §19, §20
// Ingestion gateway: validation + dedup before business logic
// ============================================================

import { store } from "./store";
import type { UsageSession, SyncLogEntry } from "../logic/types";
import { SyncStatus } from "../logic/types";

/**
 * §20 v2 — Ingest a batch of usage events.
 *
 * POST /usage/sync/batch — accepts an array of client_event_id-tagged
 * events in one call, replacing per-event sync to cut request volume.
 *
 * Ingestion Gateway (v2): single validation/dedup choke point.
 * Every downstream service can assume clean, idempotent input.
 */
export function ingestBatch(
  userId: string,
  events: Array<{
    clientEventId: string;
    packageName: string;
    appName: string;
    startTime: Date;
    endTime: Date;
    date: string;
    category?: string;
    source: string;
  }>
): {
  accepted: number;
  duplicates: number;
  rejected: number;
  errors: string[];
} {
  let accepted = 0;
  let duplicates = 0;
  let rejected = 0;
  const errors: string[] = [];

  for (const event of events) {
    // Validate
    const validation = validateEvent(event);
    if (!validation.valid) {
      rejected++;
      errors.push(`${event.clientEventId}: ${validation.reason}`);
      logSync(userId, event.clientEventId, SyncStatus.FAILED);
      continue;
    }

    // Calculate duration
    const durationSeconds = Math.round(
      (event.endTime.getTime() - event.startTime.getTime()) / 1000
    );

    const session: UsageSession = {
      id: crypto.randomUUID(),
      clientEventId: event.clientEventId,
      userId,
      packageName: event.packageName,
      appName: event.appName,
      startTime: event.startTime,
      endTime: event.endTime,
      durationSeconds,
      date: event.date,
      category: event.category ?? null,
      source: event.source,
      syncStatus: SyncStatus.SYNCED,
    };

    // Dedup via clientEventId (unique constraint)
    const added = store.addUsageSession(session);
    if (added) {
      accepted++;
      logSync(userId, event.clientEventId, SyncStatus.SYNCED);
    } else {
      duplicates++;
      // Not an error — idempotent retry
    }
  }

  return { accepted, duplicates, rejected, errors };
}

/**
 * Validate a single usage event.
 */
function validateEvent(event: {
  clientEventId: string;
  packageName: string;
  appName: string;
  startTime: Date;
  endTime: Date;
  date: string;
}): { valid: boolean; reason: string } {
  if (!event.clientEventId) {
    return { valid: false, reason: "Missing clientEventId" };
  }

  if (!event.packageName) {
    return { valid: false, reason: "Missing packageName" };
  }

  if (!event.appName) {
    return { valid: false, reason: "Missing appName" };
  }

  if (!(event.startTime instanceof Date) || isNaN(event.startTime.getTime())) {
    return { valid: false, reason: "Invalid startTime" };
  }

  if (!(event.endTime instanceof Date) || isNaN(event.endTime.getTime())) {
    return { valid: false, reason: "Invalid endTime" };
  }

  if (event.endTime.getTime() <= event.startTime.getTime()) {
    return { valid: false, reason: "endTime must be after startTime" };
  }

  // Sanity check: session shouldn't be longer than 24 hours
  const durationMs = event.endTime.getTime() - event.startTime.getTime();
  if (durationMs > 24 * 60 * 60 * 1000) {
    return { valid: false, reason: "Session exceeds 24 hours" };
  }

  if (!event.date || !/^\d{4}-\d{2}-\d{2}$/.test(event.date)) {
    return { valid: false, reason: "Invalid date format (expected YYYY-MM-DD)" };
  }

  return { valid: true, reason: "" };
}

/**
 * §19 v2 — Log sync event for audit trail.
 *
 * sync_log stores only client_event_id + status, never the raw usage content,
 * so debugging sync issues doesn't require exposing app-level usage data.
 */
function logSync(
  userId: string,
  clientEventId: string,
  status: SyncStatus
): void {
  const entry: SyncLogEntry = {
    id: crypto.randomUUID(),
    userId,
    clientEventId,
    receivedAt: new Date(),
    status,
  };
  store.syncLogs.push(entry);
}

/**
 * Get sync log for a user (debugging).
 */
export function getSyncLog(userId: string): SyncLogEntry[] {
  return store.syncLogs
    .filter((l) => l.userId === userId)
    .sort((a, b) => b.receivedAt.getTime() - a.receivedAt.getTime());
}
