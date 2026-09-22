// ============================================================
// TaskAura — Preset Avatar Constants
// Shared safely across Client and Server components
// ============================================================

export const ALLOWED_AVATARS = [
  "🧑‍💻", // Technomancer / Developer
  "⚔️",  // Warrior / Shadowblade
  "🧙‍♂️", // Arcane Mage
  "🏹",  // Ranger / Scout
  "🥷",  // Cyber Shinobi
  "⚡",  // Storm Champion
  "🦊",  // Kitsune Spirit
  "👑",  // Grand Sovereign
] as const;

export type AllowedAvatar = typeof ALLOWED_AVATARS[number];
