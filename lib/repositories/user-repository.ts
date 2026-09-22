// Task Aura — User Repository (Prisma / PostgreSQL)
import { prisma } from "../prisma";

export class UserRepository {
  async findById(id: string) {
    return prisma.user.findUnique({
      where: { id },
      include: {
        settings: true,
        streakRecord: true,
      },
    });
  }

  async findByEmail(email: string) {
    return prisma.user.findUnique({
      where: { email: email.trim().toLowerCase() },
      include: {
        settings: true,
        streakRecord: true,
      },
    });
  }

  async findByProviderAccount(provider: string, providerAccountId: string) {
    const account = await prisma.account.findUnique({
      where: {
        provider_providerAccountId: {
          provider,
          providerAccountId,
        },
      },
      include: {
        user: {
          include: {
            settings: true,
            streakRecord: true,
          },
        },
      },
    });
    return account?.user ?? null;
  }

  async createUser(data: {
    email: string;
    passwordHash?: string | null;
    displayName: string;
    timezone?: string;
  }) {
    return prisma.user.create({
      data: {
        email: data.email.trim().toLowerCase(),
        passwordHash: data.passwordHash ?? null,
        displayName: data.displayName,
        settings: {
          create: {
            dailyGoalXp: 500,
          },
        },
        streakRecord: {
          create: {
            currentStreak: 0,
            bestStreak: 0,
          },
        },
      },
    });
  }

  async createOAuthUser(data: {
    email: string;
    displayName: string;
    timezone?: string;
    account: {
      provider: string;
      providerAccountId: string;
      type?: string;
      refresh_token?: string | null;
      access_token?: string | null;
      expires_at?: number | null;
      token_type?: string | null;
      scope?: string | null;
      id_token?: string | null;
      session_state?: string | null;
    };
  }) {
    return prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          email: data.email.trim().toLowerCase(),
          passwordHash: null,
          displayName: data.displayName,
          settings: {
            create: {
              dailyGoalXp: 500,
            },
          },
          streakRecord: {
            create: {
              currentStreak: 0,
              bestStreak: 0,
            },
          },
        },
        include: {
          settings: true,
          streakRecord: true,
        },
      });

      await tx.account.create({
        data: {
          userId: user.id,
          provider: data.account.provider,
          providerAccountId: data.account.providerAccountId,
          type: data.account.type ?? "oauth",
          refresh_token: data.account.refresh_token,
          access_token: data.account.access_token,
          expires_at: data.account.expires_at,
          token_type: data.account.token_type,
          scope: data.account.scope,
          id_token: data.account.id_token,
          session_state: data.account.session_state,
        },
      });

      return user;
    });
  }

  async linkProviderAccount(
    userId: string,
    accountData: {
      provider: string;
      providerAccountId: string;
      type?: string;
      refresh_token?: string | null;
      access_token?: string | null;
      expires_at?: number | null;
      token_type?: string | null;
      scope?: string | null;
      id_token?: string | null;
      session_state?: string | null;
    }
  ) {
    return prisma.account.create({
      data: {
        userId,
        provider: accountData.provider,
        providerAccountId: accountData.providerAccountId,
        type: accountData.type ?? "oauth",
        refresh_token: accountData.refresh_token,
        access_token: accountData.access_token,
        expires_at: accountData.expires_at,
        token_type: accountData.token_type,
        scope: accountData.scope,
        id_token: accountData.id_token,
        session_state: accountData.session_state,
      },
    });
  }

  async getStreakRecord(userId: string) {
    return prisma.streakRecord.findUnique({
      where: { userId },
    });
  }

  async updateStreakRecord(
    userId: string,
    data: {
      currentStreak?: number;
      bestStreak?: number;
      lastEligibleDate?: string | null;
      graceUsedThisWeek?: boolean;
    }
  ) {
    return prisma.streakRecord.upsert({
      where: { userId },
      create: {
        userId,
        currentStreak: data.currentStreak ?? 0,
        bestStreak: data.bestStreak ?? 0,
        lastEligibleDate: data.lastEligibleDate ?? null,
        graceUsedThisWeek: data.graceUsedThisWeek ?? false,
      },
      update: {
        ...(data.currentStreak !== undefined ? { currentStreak: data.currentStreak } : {}),
        ...(data.bestStreak !== undefined ? { bestStreak: data.bestStreak } : {}),
        ...(data.lastEligibleDate !== undefined ? { lastEligibleDate: data.lastEligibleDate } : {}),
        ...(data.graceUsedThisWeek !== undefined ? { graceUsedThisWeek: data.graceUsedThisWeek } : {}),
      },
    });
  }
}

export const userRepository = new UserRepository();
