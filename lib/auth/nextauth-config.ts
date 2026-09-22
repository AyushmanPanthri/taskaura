// ============================================================
// TaskAura — NextAuth / Auth.js Configuration (v4.24.15)
// Google OAuth Provider integration with TaskAura persistence.
// ============================================================

import type { NextAuthOptions } from "next-auth";
import GoogleProvider from "next-auth/providers/google";
import { googleAuthService } from "./google-auth-service";

const googleClientId = process.env.GOOGLE_CLIENT_ID || "";
const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET || "";

export const authOptions: NextAuthOptions = {
  secret: process.env.AUTH_SECRET || "taskaura-production-super-secret-key-32-chars-long",
  providers: [
    ...(googleClientId && googleClientSecret
      ? [
          GoogleProvider({
            clientId: googleClientId,
            clientSecret: googleClientSecret,
          }),
        ]
      : []),
  ],
  session: {
    strategy: "jwt",
  },
  callbacks: {
    async signIn({ user, account, profile }) {
      if (account?.provider === "google" && profile) {
        const gProfile = profile as {
          email_verified?: boolean;
          email?: string;
          name?: string;
          picture?: string;
          sub?: string;
        };

        const result = await googleAuthService.handleGoogleCallback({
          provider: "google",
          providerAccountId: account.providerAccountId,
          email: user.email || gProfile.email || "",
          name: user.name || gProfile.name,
          email_verified: gProfile.email_verified ?? true,
          avatarUrl: gProfile.picture,
          tokens: {
            access_token: account.access_token,
            refresh_token: account.refresh_token,
            id_token: account.id_token,
            expires_at: account.expires_at,
            token_type: account.token_type,
            scope: account.scope,
            session_state: typeof account.session_state === "string" ? account.session_state : null,
          },
        });

        // Store resolved TaskAura userId
        user.id = result.user.id;
      }
      return true;
    },
    async jwt({ token, user }) {
      if (user) {
        token.userId = user.id;
      }
      return token;
    },
    async session({ session, token }) {
      if (token?.userId && session.user) {
        (session.user as unknown as { id: string }).id = token.userId as string;
      }
      return session;
    },
  },
  pages: {
    signIn: "/login",
    error: "/login",
  },
};
