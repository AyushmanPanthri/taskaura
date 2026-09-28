// ============================================================
// Task Aura — Progress Service
// Canonical re-export pointing to PostgreSQL-authoritative progress service.
// Replaces the legacy in-memory store implementation.
// ============================================================

export {
  getPgProgressSummary as getUserProgressSummary,
  getPgProgressSummary,
} from "./pg-progress-service";

export type {
  PgProgressSummary as ProgressSummary,
  PgProgressSummary,
} from "./pg-progress-service";
