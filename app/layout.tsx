import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { AppShell } from "@/components/AppShell";

const inter = Inter({
  variable: "--font-geist-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
});

export const metadata: Metadata = {
  title: "TaskAura — Gamify Your Productivity ⚡",
  description:
    "Track habits, complete tasks, earn authoritative XP, and level up your life with an RPG-inspired productivity system.",
  icons: {
    icon: "/taskaura-logo.png",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${inter.variable} h-full antialiased dark`}>
      <body className="min-h-full flex flex-col bg-[#0a0a12] text-[#e8e8f0]">
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
