// ============================================================
// TaskAura — Google OAuth Authentication Service (§6 & §19)
//
// Handles verified Google identities:
//   1. Resolve existing (provider, providerAccountId) mapping
//   2. If not found, safely link to verified matching email
//   3. Otherwise create genuinely clean new User (Level 1, 0 XP)
//   4. Never trust arbitrary client-supplied userId
// ============================================================

import { userRepository } from "../repositories/user-repository";
import { prisma } from "../prisma";

export interface GoogleAuthProfile {
  provider: "google";
  providerAccountId: string;
  email: string;
  name?: string;
  email_verified?: boolean;
  avatarUrl?: string;
  tokens?: {
    access_token?: string | null;
    refresh_token?: string | null;
    id_token?: string | null;
    expires_at?: number | null;
    token_type?: string | null;
    scope?: string | null;
    session_state?: string | null;
  };
}

export interface GoogleAuthResult {
  user: {
    id: string;
    email: string | null;
    displayName: string;
    timezone?: string;
  };
  isNewUser: boolean;
  linked: boolean;
}

export class GoogleAuthService {
  /**
   * Resolves a verified Google profile into a TaskAura User.
   */
  async handleGoogleCallback(profile: GoogleAuthProfile): Promise<GoogleAuthResult> {
    // 1. Validate incoming provider identity
    if (!profile || typeof profile !== "object") {
      throw new Error("INVALID_PROVIDER_DATA: Profile data is missing");
    }

    const { provider, providerAccountId, email, name, email_verified } = profile;

    if (!provider || provider !== "google") {
      throw new Error("INVALID_PROVIDER: Provider must be 'google'");
    }

    if (!providerAccountId || typeof providerAccountId !== "string" || !providerAccountId.trim()) {
      throw new Error("INVALID_PROVIDER_ACCOUNT_ID: Provider account ID is required");
    }

    if (!email || typeof email !== "string" || !email.includes("@")) {
      throw new Error("INVALID_EMAIL: Valid email is required for OAuth login");
    }

    const normalizedEmail = email.trim().toLowerCase();
    const cleanAccountId = providerAccountId.trim();
    const displayName = (name && typeof name === "string" && name.trim()) ? name.trim() : normalizedEmail.split("@")[0];

    // 2. Step 1: Look for existing provider/account mapping
    const existingMappedUser = await userRepository.findByProviderAccount("google", cleanAccountId);
    if (existingMappedUser) {
      return {
        user: {
          id: existingMappedUser.id,
          email: existingMappedUser.email,
          displayName: existingMappedUser.displayName || displayName,
          timezone: "UTC",
        },
        isNewUser: false,
        linked: false,
      };
    }

    // 3. Step 2: Check for existing TaskAura user with identical email
    const existingEmailUser = await userRepository.findByEmail(normalizedEmail);

    if (existingEmailUser) {
      // Security Invariant: Only link if Google verified the email
      if (email_verified !== true) {
        throw new Error("UNVERIFIED_EMAIL: Google email must be verified before linking to an existing account");
      }

      // Check if an Account record with this provider already exists for this user
      const existingAccount = await prisma.account.findFirst({
        where: {
          userId: existingEmailUser.id,
          provider: "google",
        },
      });

      if (!existingAccount) {
        try {
          await userRepository.linkProviderAccount(existingEmailUser.id, {
            provider: "google",
            providerAccountId: cleanAccountId,
            refresh_token: profile.tokens?.refresh_token ?? null,
            access_token: profile.tokens?.access_token ?? null,
            expires_at: profile.tokens?.expires_at ?? null,
            token_type: profile.tokens?.token_type ?? null,
            scope: profile.tokens?.scope ?? null,
            id_token: profile.tokens?.id_token ?? null,
            session_state: profile.tokens?.session_state ?? null,
          });
        } catch (err: unknown) {
          // If another concurrent request already linked this account (P2002), continue safely
          const pError = err as { code?: string };
          if (pError.code !== "P2002") {
            throw err;
          }
        }
      }

      return {
        user: {
          id: existingEmailUser.id,
          email: existingEmailUser.email,
          displayName: existingEmailUser.displayName || displayName,
          timezone: "UTC",
        },
        isNewUser: false,
        linked: true,
      };
    }

    // 4. Step 3: Create genuinely clean new TaskAura User
    // Starts with: Level 1, 0 XP, streak 0, no achievements, no demo data
    try {
      const newUser = await userRepository.createOAuthUser({
        email: normalizedEmail,
        displayName,
        account: {
          provider: "google",
          providerAccountId: cleanAccountId,
          refresh_token: profile.tokens?.refresh_token ?? null,
          access_token: profile.tokens?.access_token ?? null,
          expires_at: profile.tokens?.expires_at ?? null,
          token_type: profile.tokens?.token_type ?? null,
          scope: profile.tokens?.scope ?? null,
          id_token: profile.tokens?.id_token ?? null,
          session_state: profile.tokens?.session_state ?? null,
        },
      });

      return {
        user: {
          id: newUser.id,
          email: newUser.email,
          displayName: newUser.displayName || displayName,
          timezone: "UTC",
        },
        isNewUser: true,
        linked: false,
      };
    } catch (err: unknown) {
      // In case of race condition creating same account simultaneously (P2002)
      const pError = err as { code?: string };
      if (pError.code === "P2002") {
        const resolved = await userRepository.findByProviderAccount("google", cleanAccountId);
        if (resolved) {
          return {
            user: {
              id: resolved.id,
              email: resolved.email,
              displayName: resolved.displayName || displayName,
              timezone: "UTC",
            },
            isNewUser: false,
            linked: false,
          };
        }
      }
      throw err;
    }
  }
}

export const googleAuthService = new GoogleAuthService();
