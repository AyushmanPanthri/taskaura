// Task Aura — Focus Repository (Prisma / PostgreSQL)
import { prisma } from "../prisma";
import { FocusSession, FocusSessionStatus } from "../logic/types";

export interface StartFocusInput {
  requiredMinutes?: number;
  targetDurationMinutes?: number;
  clientEventId: string;
  expectedHeartbeats?: number;
  /** Optional task to link. Validated server-side: must belong to user and not be completed. */
  taskId?: string | null;
}

export interface FocusPayoutData {
  amount: number;
  baseXp: number;
  difficultyMultiplier: number;
  streakBonus: number;
  rewardType: string;
}

export class FocusRepository {
  async listSessions(userId: string): Promise<FocusSession[]> {
    const rows = await prisma.focusSession.findMany({
      where: { userId },
      orderBy: { startedAt: "desc" },
    });

    return rows.map((r) => ({
      id: r.id,
      clientEventId: r.clientEventId,
      userId: r.userId,
      status: r.status as FocusSessionStatus,
      startedAt: r.startedAt,
      completedAt: r.completedAt,
      requiredMinutes: r.requiredMinutes,
      actualMinutes: r.actualMinutes,
      heartbeatCount: r.heartbeatCount,
      expectedHeartbeats: r.expectedHeartbeats,
    }));
  }

  async findActiveSession(userId: string): Promise<FocusSession | null> {
    const r = await prisma.focusSession.findFirst({
      where: { userId, status: FocusSessionStatus.RUNNING },
    });
    if (!r) return null;

    return {
      id: r.id,
      clientEventId: r.clientEventId,
      userId: r.userId,
      status: r.status as FocusSessionStatus,
      startedAt: r.startedAt,
      completedAt: r.completedAt,
      requiredMinutes: r.requiredMinutes,
      actualMinutes: r.actualMinutes,
      heartbeatCount: r.heartbeatCount,
      expectedHeartbeats: r.expectedHeartbeats,
    };
  }

  async findById(userId: string, id: string): Promise<FocusSession | null> {
    const r = await prisma.focusSession.findFirst({
      where: { id, userId },
    });
    if (!r) return null;

    return {
      id: r.id,
      clientEventId: r.clientEventId,
      userId: r.userId,
      status: r.status as FocusSessionStatus,
      startedAt: r.startedAt,
      completedAt: r.completedAt,
      requiredMinutes: r.requiredMinutes,
      actualMinutes: r.actualMinutes,
      heartbeatCount: r.heartbeatCount,
      expectedHeartbeats: r.expectedHeartbeats,
    };
  }

  /**
   * Concurrency-safe focus start: prevents multiple simultaneous running sessions
   * for the same user via atomic database transaction.
   */
  async startSession(userId: string, input: StartFocusInput): Promise<FocusSession> {
    return prisma.$transaction(async (tx) => {
      // 0. Serialize concurrent focus starts for the user using SELECT FOR UPDATE
      await tx.$queryRaw`SELECT id FROM "users" WHERE id = ${userId}::uuid FOR UPDATE;`;

      // 0b. Validate optional taskId: task must exist, belong to user, and not be completed.
      const resolvedTaskId = input.taskId ?? null;
      let linkedTaskRow: { id: string; status: string; startedAt: Date | null } | null = null;
      if (resolvedTaskId) {
        linkedTaskRow = await tx.task.findFirst({
          where: { id: resolvedTaskId, userId },
          select: { id: true, status: true, startedAt: true },
        });
        if (!linkedTaskRow) {
          throw new Error("Task not found or does not belong to this user");
        }
        if (linkedTaskRow.status === "COMPLETED" || linkedTaskRow.status === "CANCELLED" || linkedTaskRow.status === "EXPIRED") {
          throw new Error(`Cannot link a focus session to a task with status ${linkedTaskRow.status}`);
        }
      }

      // 1. Check for any currently running session for this user
      const active = await tx.focusSession.findFirst({
        where: {
          userId,
          status: FocusSessionStatus.RUNNING,
        },
      });

      if (active) {
        throw new Error("A focus session is already running");
      }

      // 2. Check if this clientEventId was already created (idempotent retry)
      const existingByEvent = await tx.focusSession.findUnique({
        where: { clientEventId: input.clientEventId },
      });

      if (existingByEvent) {
        return {
          id: existingByEvent.id,
          clientEventId: existingByEvent.clientEventId,
          userId: existingByEvent.userId,
          taskId: existingByEvent.taskId,
          status: existingByEvent.status as FocusSessionStatus,
          startedAt: existingByEvent.startedAt,
          completedAt: existingByEvent.completedAt,
          requiredMinutes: existingByEvent.requiredMinutes,
          actualMinutes: existingByEvent.actualMinutes,
          heartbeatCount: existingByEvent.heartbeatCount,
          expectedHeartbeats: existingByEvent.expectedHeartbeats,
        };
      }

      const now = new Date();
      if (linkedTaskRow && linkedTaskRow.status === "PENDING") {
        await tx.task.update({
          where: { id: linkedTaskRow.id },
          data: {
            status: "IN_PROGRESS",
            ...(linkedTaskRow.startedAt ? {} : { startedAt: now }),
          },
        });
      }

      const minutes = input.requiredMinutes ?? input.targetDurationMinutes ?? 25;
      const created = await tx.focusSession.create({
        data: {
          userId,
          clientEventId: input.clientEventId,
          taskId: resolvedTaskId,
          requiredMinutes: minutes,
          expectedHeartbeats: input.expectedHeartbeats ?? Math.floor(minutes * 2),
          status: FocusSessionStatus.RUNNING,
          startedAt: now,
          lastHeartbeatAt: now,
        },
      });

      return {
        id: created.id,
        clientEventId: created.clientEventId,
        userId: created.userId,
        taskId: created.taskId,
        status: created.status as FocusSessionStatus,
        startedAt: created.startedAt,
        completedAt: created.completedAt,
        requiredMinutes: created.requiredMinutes,
        actualMinutes: created.actualMinutes,
        heartbeatCount: created.heartbeatCount,
        expectedHeartbeats: created.expectedHeartbeats,
      };
    });
  }

  async recordHeartbeat(
    userId: string,
    sessionId: string
  ): Promise<{ heartbeatCount: number; status: FocusSessionStatus }> {
    const session = await prisma.focusSession.findFirst({
      where: { id: sessionId, userId },
    });

    if (!session) {
      throw new Error("Focus session not found");
    }

    if (session.status !== FocusSessionStatus.RUNNING) {
      throw new Error(`Cannot send heartbeat for non-running session (${session.status})`);
    }

    const now = new Date();
    const updated = await prisma.focusSession.update({
      where: { id: sessionId },
      data: {
        heartbeatCount: { increment: 1 },
        lastHeartbeatAt: now,
      },
    });

    return {
      heartbeatCount: updated.heartbeatCount,
      status: updated.status as FocusSessionStatus,
    };
  }

  /**
   * Atomic, transaction-safe focus completion with XP ledger recording.
   */
  async completeSessionTransaction(
    userId: string,
    sessionId: string,
    actualMinutes: number,
    idempotencyKey: string,
    payout: FocusPayoutData
  ): Promise<{ session: FocusSession; isDuplicate: boolean; xpAwarded: number }> {
    return prisma.$transaction(async (tx) => {
      const session = await tx.focusSession.findFirst({
        where: { id: sessionId, userId },
      });

      if (!session) {
        throw new Error("Focus session not found");
      }

      // Check for duplicate payout
      const existingTx = await tx.xPTransaction.findUnique({
        where: {
          userId_idempotencyKey: {
            userId,
            idempotencyKey,
          },
        },
      });

      if (existingTx || session.status === FocusSessionStatus.COMPLETED) {
        return {
          session: {
            id: session.id,
            clientEventId: session.clientEventId,
            userId: session.userId,
            status: FocusSessionStatus.COMPLETED,
            startedAt: session.startedAt,
            completedAt: session.completedAt ?? new Date(),
            requiredMinutes: session.requiredMinutes,
            actualMinutes: session.actualMinutes,
            heartbeatCount: session.heartbeatCount,
            expectedHeartbeats: session.expectedHeartbeats,
          },
          isDuplicate: true,
          xpAwarded: 0,
        };
      }

      if (session.status !== FocusSessionStatus.RUNNING) {
        throw new Error(`Cannot complete session in state ${session.status}`);
      }

      const now = new Date();

      // Write XP ledger
      await tx.xPTransaction.create({
        data: {
          userId,
          amount: payout.amount,
          sourceType: "FOCUS_SESSION",
          sourceId: sessionId,
          rewardType: payout.rewardType,
          idempotencyKey,
          baseXp: payout.baseXp,
          difficultyMultiplier: payout.difficultyMultiplier,
          streakBonus: payout.streakBonus,
          createdAt: now,
        },
      });

      const updated = await tx.focusSession.update({
        where: { id: sessionId },
        data: {
          status: FocusSessionStatus.COMPLETED,
          completedAt: now,
          actualMinutes,
        },
      });

      return {
        session: {
          id: updated.id,
          clientEventId: updated.clientEventId,
          userId: updated.userId,
          status: FocusSessionStatus.COMPLETED,
          startedAt: updated.startedAt,
          completedAt: updated.completedAt,
          requiredMinutes: updated.requiredMinutes,
          actualMinutes: updated.actualMinutes,
          heartbeatCount: updated.heartbeatCount,
          expectedHeartbeats: updated.expectedHeartbeats,
        },
        isDuplicate: false,
        xpAwarded: payout.amount,
      };
    });
  }

  async abandonSession(userId: string, sessionId: string): Promise<FocusSession> {
    const existing = await prisma.focusSession.findFirst({
      where: { id: sessionId, userId },
    });

    if (!existing) {
      throw new Error("Focus session not found");
    }

    const updated = await prisma.focusSession.update({
      where: { id: sessionId },
      data: {
        status: FocusSessionStatus.ABANDONED,
        completedAt: new Date(),
      },
    });

    return {
      id: updated.id,
      clientEventId: updated.clientEventId,
      userId: updated.userId,
      status: FocusSessionStatus.ABANDONED,
      startedAt: updated.startedAt,
      completedAt: updated.completedAt,
      requiredMinutes: updated.requiredMinutes,
      actualMinutes: updated.actualMinutes,
      heartbeatCount: updated.heartbeatCount,
      expectedHeartbeats: updated.expectedHeartbeats,
    };
  }
}

export const focusRepository = new FocusRepository();
