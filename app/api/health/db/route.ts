// Task Aura — Database Health Verification Endpoint
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET() {
  try {
    // Verify TaskAura -> Next.js server -> PostgreSQL connection
    const result = await prisma.$queryRaw<Array<{ status: number }>>`SELECT 1 as status`;
    const isConnected = Array.isArray(result) && result.length > 0;

    if (!isConnected) {
      return NextResponse.json(
        {
          success: false,
          status: "disconnected",
          error: "Database check did not return expected response",
        },
        { status: 500 }
      );
    }

    const userCount = await prisma.user.count();

    return NextResponse.json(
      {
        success: true,
        status: "connected",
        database: "PostgreSQL",
        metrics: {
          userCount,
        },
        timestamp: new Date().toISOString(),
      },
      { status: 200 }
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Database connection failed";
    // Never expose credentials in error response
    const sanitizedMessage = message.replace(/:[^:@]+@/, ":****@");
    return NextResponse.json(
      {
        success: false,
        status: "error",
        error: sanitizedMessage,
      },
      { status: 500 }
    );
  }
}
