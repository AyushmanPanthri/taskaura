// Task Aura — Offline Mutation Queue (§12)
// Provides resilient, idempotent client-side mutation synchronization
// Guarantees zero duplicate XP on reconnect and server-side acknowledgement.

export type MutationType = "TASK_COMPLETE" | "HABIT_LOG" | "FOCUS_COMPLETE" | "FOCUS_START";

export interface OfflineMutation {
  id: string;
  clientEventId: string;
  type: MutationType;
  endpoint: string;
  payload: Record<string, unknown>;
  enqueuedAt: number;
  retries: number;
  status: "PENDING" | "SYNCING" | "ACKNOWLEDGED" | "FAILED";
  lastError?: string;
}

export interface SyncResponse {
  success: boolean;
  isDuplicate?: boolean;
  data?: unknown;
  error?: { code: string; message: string };
}

export class OfflineMutationQueue {
  private queue: OfflineMutation[] = [];
  private isProcessing = false;

  constructor(private storageKey: string = "taskaura_offline_mutations") {
    this.loadFromStorage();
  }

  private loadFromStorage(): void {
    if (typeof window === "undefined" || !window.localStorage) return;
    try {
      const stored = localStorage.getItem(this.storageKey);
      if (stored) {
        this.queue = JSON.parse(stored);
      }
    } catch {
      this.queue = [];
    }
  }

  private persist(): void {
    if (typeof window === "undefined" || !window.localStorage) return;
    try {
      localStorage.setItem(this.storageKey, JSON.stringify(this.queue));
    } catch {
      // quota or storage unavailable
    }
  }

  /**
   * Enqueues an offline mutation with an idempotent UUID clientEventId.
   */
  enqueue(
    type: MutationType,
    endpoint: string,
    payload: Record<string, unknown>
  ): OfflineMutation {
    const clientEventId =
      typeof payload.clientEventId === "string" && payload.clientEventId
        ? payload.clientEventId
        : `evt_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

    const mutation: OfflineMutation = {
      id: crypto.randomUUID ? crypto.randomUUID() : `mut_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
      clientEventId,
      type,
      endpoint,
      payload: {
        ...payload,
        clientEventId,
      },
      enqueuedAt: Date.now(),
      retries: 0,
      status: "PENDING",
    };

    this.queue.push(mutation);
    this.persist();
    return mutation;
  }

  getPending(): OfflineMutation[] {
    return this.queue.filter((m) => m.status === "PENDING" || m.status === "FAILED");
  }

  /**
   * Replays pending mutations to server using provided fetch dispatcher.
   * Handles deduplication acknowledgement and removes acknowledged items.
   */
  async processQueue(
    dispatcher: (mutation: OfflineMutation) => Promise<SyncResponse>
  ): Promise<{ processed: number; acknowledged: number; failed: number }> {
    if (this.isProcessing) return { processed: 0, acknowledged: 0, failed: 0 };
    this.isProcessing = true;

    let processed = 0;
    let acknowledged = 0;
    let failed = 0;

    const pending = this.getPending();

    for (const mutation of pending) {
      processed++;
      mutation.status = "SYNCING";

      try {
        const res = await dispatcher(mutation);
        if (res.success || res.isDuplicate) {
          // Server accepted or successfully deduplicated this mutation
          mutation.status = "ACKNOWLEDGED";
          acknowledged++;
        } else {
          mutation.status = "FAILED";
          mutation.retries++;
          mutation.lastError = res.error?.message ?? "Sync rejected";
          failed++;
        }
      } catch (err) {
        mutation.status = "FAILED";
        mutation.retries++;
        mutation.lastError = err instanceof Error ? err.message : "Network error";
        failed++;
      }
    }

    // Retain only unacknowledged mutations
    this.queue = this.queue.filter((m) => m.status !== "ACKNOWLEDGED");
    this.persist();
    this.isProcessing = false;

    return { processed, acknowledged, failed };
  }

  clear(): void {
    this.queue = [];
    this.persist();
  }
}

export const offlineMutationQueue = new OfflineMutationQueue();
