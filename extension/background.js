// ============================================================
// TaskAura Focus Guard — Background Service Worker
// Manifest V3 — Chrome / Edge
//
// Responsibilities:
//   1. Poll /api/v1/extension/status every 30 seconds via chrome.alarms.
//   2. When a focus session is RUNNING: apply declarativeNetRequest redirect
//      rules for each domain in the user's blocklist.
//   3. When no session (or session ended): clear all dynamic rules.
//   4. Persist last-known state in chrome.storage.local for popup access.
//
// Auth mechanism:
//   Credentials-inclusive fetch → browser automatically attaches the
//   existing taskaura_session httpOnly cookie. Extension never reads
//   cookie values directly (MV3 cannot; browser engine handles it).
//
// IMPORTANT — Bypass limitations (honest disclosure):
//   - A user can disable or uninstall this extension at any time.
//   - Blocking is per-browser; other browsers/devices are unaffected.
//   - XP eligibility is governed entirely by the server-side session
//     record (startedAt, heartbeat count). This extension does NOT
//     gatekeep XP — it is a friction/commitment tool only.
// ============================================================

// --- Configuration ---
// In production, replace with your actual domain.
// The extension reads this from storage so it can be updated without rebuild.
const DEFAULT_APP_URL = "http://localhost:3000";
const POLL_ALARM_NAME = "taskaura-focus-poll";
const POLL_INTERVAL_MINUTES = 0.5; // 30 seconds (chrome.alarms minimum is ~1s; 0.5 min = 30s)
const RULE_ID_BASE = 10000; // Start rule IDs above 10000 to avoid conflicts
const MAX_RULES = 100; // 2 rules per domain (apex + wildcard), max 50 domains

// --- Initialization ---

chrome.runtime.onInstalled.addListener(async () => {
  console.log("[TaskAura Focus Guard] Extension installed.");
  await chrome.storage.local.set({
    appUrl: DEFAULT_APP_URL,
    sessionState: null,
    blocklist: [],
    lastPollAt: null,
    blocking: false,
  });
  await startPolling();
});

chrome.runtime.onStartup.addListener(async () => {
  await startPolling();
});

// Re-register alarm if it was cleared (service workers can be terminated)
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === POLL_ALARM_NAME) {
    await poll();
  }
});

async function startPolling() {
  // Clear any existing alarm and create a fresh one
  await chrome.alarms.clear(POLL_ALARM_NAME);
  chrome.alarms.create(POLL_ALARM_NAME, {
    delayInMinutes: 0,          // fire immediately on install/startup
    periodInMinutes: POLL_INTERVAL_MINUTES,
  });
  console.log("[TaskAura Focus Guard] Polling started (every 30s).");
}

// --- Core Poll Logic ---

async function poll() {
  const { appUrl } = await chrome.storage.local.get("appUrl");
  const baseUrl = appUrl || DEFAULT_APP_URL;

  try {
    const response = await fetch(`${baseUrl}/api/v1/extension/status`, {
      credentials: "include",
      cache: "no-store",
    });

    if (!response.ok) {
      // Server error or auth failure — clear blocking to be safe
      await clearBlocking();
      await chrome.storage.local.set({
        sessionState: null,
        blocklist: [],
        blocking: false,
        lastPollAt: new Date().toISOString(),
        lastError: `HTTP ${response.status}`,
      });
      return;
    }

    const data = await response.json();

    if (!data.success || !data.data.authenticated) {
      // Not logged in — ensure no blocking
      await clearBlocking();
      await chrome.storage.local.set({
        sessionState: null,
        blocklist: [],
        blocking: false,
        lastPollAt: new Date().toISOString(),
        lastError: null,
      });
      return;
    }

    const { activeSession, blocklist } = data.data;

    await chrome.storage.local.set({
      sessionState: activeSession,
      blocklist: blocklist || [],
      lastPollAt: new Date().toISOString(),
      lastError: null,
    });

    if (activeSession && activeSession.isRunning && blocklist && blocklist.length > 0) {
      await applyBlockingRules(blocklist, activeSession);
      await chrome.storage.local.set({ blocking: true });
    } else {
      await clearBlocking();
      await chrome.storage.local.set({ blocking: false });
    }
  } catch (err) {
    console.error("[TaskAura Focus Guard] Poll error:", err);
    await chrome.storage.local.set({
      lastError: String(err),
      lastPollAt: new Date().toISOString(),
    });
    // On network error: maintain current blocking state (don't clear on transient errors)
  }
}

// --- declarativeNetRequest Rule Management ---

/**
 * Builds URL filter patterns for a bare domain.
 * "reddit.com" → ["*://reddit.com/*", "*://*.reddit.com/*"]
 */
function domainToUrlFilters(domain) {
  return [
    `*://${domain}/*`,       // apex domain
    `*://*.${domain}/*`,     // all subdomains
  ];
}

/**
 * Applies redirect rules for all blocklisted domains.
 * Each domain generates 2 rules (apex + wildcard subdomain).
 * Rules redirect to the extension's blocked.html page.
 */
async function applyBlockingRules(blocklist, session) {
  // Remove all existing dynamic rules first
  const existingRules = await chrome.declarativeNetRequest.getDynamicRules();
  const existingIds = existingRules.map((r) => r.id);

  const addRules = [];
  let ruleId = RULE_ID_BASE;

  const remainingMinutes = session?.remainingMinutes ?? 0;
  const sessionId = session?.id ?? "";
  const blockedPageBase = chrome.runtime.getURL("blocked.html");

  for (const domain of blocklist.slice(0, Math.floor(MAX_RULES / 2))) {
    const filters = domainToUrlFilters(domain);
    for (const urlFilter of filters) {
      const blockedUrl = `${blockedPageBase}?domain=${encodeURIComponent(domain)}&remaining=${remainingMinutes}&session=${encodeURIComponent(sessionId)}`;
      addRules.push({
        id: ruleId++,
        priority: 1,
        action: {
          type: "redirect",
          redirect: { url: blockedUrl },
        },
        condition: {
          urlFilter,
          resourceTypes: ["main_frame"],
        },
      });
    }
  }

  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: existingIds,
    addRules,
  });

  console.log(`[TaskAura Focus Guard] Applied ${addRules.length} blocking rules for ${blocklist.length} domains.`);
}

/**
 * Removes all dynamic blocking rules (called when session ends).
 */
async function clearBlocking() {
  const existingRules = await chrome.declarativeNetRequest.getDynamicRules();
  const existingIds = existingRules.map((r) => r.id);
  if (existingIds.length > 0) {
    await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: existingIds,
      addRules: [],
    });
    console.log(`[TaskAura Focus Guard] Cleared ${existingIds.length} blocking rules.`);
  }
}

// --- Message Handling (from popup / blocked page) ---

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === "GET_STATE") {
    chrome.storage.local.get(
      ["sessionState", "blocklist", "blocking", "lastPollAt", "lastError", "appUrl"],
      (result) => sendResponse({ success: true, data: result })
    );
    return true; // async response
  }

  if (message.type === "FORCE_POLL") {
    poll().then(() => sendResponse({ success: true }));
    return true;
  }

  if (message.type === "SET_APP_URL") {
    const { url } = message;
    chrome.storage.local.set({ appUrl: url }, () =>
      sendResponse({ success: true, url })
    );
    return true;
  }
});
