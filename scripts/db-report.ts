import { prisma } from "../lib/prisma";

async function main() {
  const users = await prisma.user.findMany({
    select: {
      id: true, displayName: true, email: true,
      role: true, isGuest: true,
      xpTransactions: { select: { amount: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  const testEmailPat = [/@taskaura\.test$/i, /@taskaura\.dev$/i, /^ext-.*@test\.dev$/i];
  const testNamePat  = [
    /^User-/i, /^Farmer/i, /^Legit/i, /^Rival/i, /^Hero/i, /^Title/i,
    /^SCLimit/i, /^Reconciliation/i, /^Hardening/i, /^Sirius/i,
    /^Solana/i, /^Orion/i, /^River/i, /^Admin/i, /^Adventurer$/i,
  ];

  const real: typeof users = [], test: typeof users = [];
  for (const u of users) {
    const isTest = u.isGuest
      || (u.email != null && testEmailPat.some(p => p.test(u.email!)))
      || (u.displayName != null && testNamePat.some(p => p.test(u.displayName!)));
    (isTest ? test : real).push(u);
  }

  function fmt(u: typeof users[0]) {
    const xp = u.xpTransactions.reduce((s, t) => s + t.amount, 0);
    return `  id=${u.id}  name="${u.displayName}"  email=${u.email}  role=${u.role}  guest=${u.isGuest}  totalXp=${xp}`;
  }

  console.log("=== REAL USERS ===");
  if (real.length === 0) console.log("  (none)");
  real.forEach(u => console.log(fmt(u)));

  console.log("\n=== TEST DATA USERS ===");
  if (test.length === 0) console.log("  (none)");
  test.forEach(u => console.log(fmt(u)));

  console.log(`\nTotal: ${users.length} | Real: ${real.length} | Test: ${test.length}`);

  await prisma.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
