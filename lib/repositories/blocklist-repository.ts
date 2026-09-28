// ============================================================
// TaskAura — Blocklist Repository (Prisma / PostgreSQL)
// Manages user-configured domain blocklists for the browser extension.
// Used by /api/v1/extension/blocklist routes (GET, POST, DELETE).
//
// Security model:
//   - All operations are scoped to the authenticated userId.
//   - Domain values are normalized to bare lowercase hostnames
//     (e.g. "reddit.com") before storage — the extension expands
//     these to wildcard URL patterns at rule-application time.
//   - Max BLOCKLIST_DOMAIN_CAP domains per user enforced server-side.
// ============================================================

import { prisma } from "../prisma";

/** Maximum number of blocked domains per user. */
export const BLOCKLIST_DOMAIN_CAP = 50;

/**
 * Normalizes a raw domain string to a canonical bare hostname.
 * Strips scheme, www prefix, trailing slashes, and paths.
 * Returns null if the result is not a plausible domain.
 *
 * Examples:
 *   "https://www.reddit.com/r/all" → "reddit.com"
 *   "twitter.com"                  → "twitter.com"
 *   "WWW.YOUTUBE.COM"              → "youtube.com"
 */
export function normalizeDomain(raw: string): string | null {
  let s = raw.trim().toLowerCase();

  // Strip scheme if present
  s = s.replace(/^https?:\/\//, "");

  // Strip www. prefix
  s = s.replace(/^www\./, "");

  // Take only the host part (no path, no query, no port)
  s = s.split("/")[0].split("?")[0].split("#")[0].split(":")[0];

  // Basic validity check: must have at least one dot and no spaces
  if (!s.includes(".") || s.includes(" ") || s.length > 253 || s.length < 3) {
    return null;
  }

  // Must not start or end with a dot
  if (s.startsWith(".") || s.endsWith(".")) {
    return null;
  }

  return s;
}

export interface BlocklistedDomainEntry {
  id: string;
  domain: string;
  createdAt: Date;
}

export class BlocklistRepository {
  /**
   * Returns all blocked domains for a user, ordered by creation date.
   */
  async listDomains(userId: string): Promise<BlocklistedDomainEntry[]> {
    const rows = await prisma.blocklistedDomain.findMany({
      where: { userId },
      orderBy: { createdAt: "asc" },
      select: { id: true, domain: true, createdAt: true },
    });
    return rows;
  }

  /**
   * Adds a domain to the user's blocklist.
   * Returns { added: true, domain } on success.
   * Returns { added: false, reason } on failure (cap exceeded, invalid, duplicate).
   */
  async addDomain(
    userId: string,
    rawDomain: string
  ): Promise<
    | { added: true; domain: string }
    | { added: false; reason: string }
  > {
    const domain = normalizeDomain(rawDomain);
    if (!domain) {
      return { added: false, reason: "INVALID_DOMAIN" };
    }

    // Enforce per-user cap
    const count = await prisma.blocklistedDomain.count({ where: { userId } });
    if (count >= BLOCKLIST_DOMAIN_CAP) {
      return {
        added: false,
        reason: `DOMAIN_CAP_EXCEEDED: maximum ${BLOCKLIST_DOMAIN_CAP} domains per user`,
      };
    }

    try {
      await prisma.blocklistedDomain.create({
        data: { userId, domain },
      });
      return { added: true, domain };
    } catch (err: unknown) {
      const e = err as { code?: string };
      if (e?.code === "P2002") {
        // Unique constraint — domain already in blocklist
        return { added: false, reason: "ALREADY_EXISTS" };
      }
      throw err;
    }
  }

  /**
   * Removes a domain from the user's blocklist.
   * Returns { removed: true } on success, { removed: false } if not found.
   */
  async removeDomain(
    userId: string,
    rawDomain: string
  ): Promise<{ removed: boolean }> {
    const domain = normalizeDomain(rawDomain);
    if (!domain) return { removed: false };

    const result = await prisma.blocklistedDomain.deleteMany({
      where: { userId, domain },
    });
    return { removed: result.count > 0 };
  }

  /**
   * Returns just the domain strings for a user (lightweight, used by extension status polling).
   */
  async listDomainStrings(userId: string): Promise<string[]> {
    const rows = await prisma.blocklistedDomain.findMany({
      where: { userId },
      select: { domain: true },
      orderBy: { createdAt: "asc" },
    });
    return rows.map((r) => r.domain);
  }
}

export const blocklistRepository = new BlocklistRepository();
