import { describe, it, expect, afterAll } from "vitest";
import { prisma } from "../lib/prisma";

describe("Live PostgreSQL Connection Test", () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("successfully connects to PostgreSQL 18 and queries user table", async () => {
    const userCount = await prisma.user.count();
    expect(typeof userCount).toBe("number");
  });
});
