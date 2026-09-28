// blocked.js — Runs on the blocked.html page
// Reads URL params to show blocked domain and session info.
// Polls the extension background for live remaining-time updates.

(function () {
  const params = new URLSearchParams(window.location.search);
  const domain = params.get("domain") || "this site";
  const sessionId = params.get("session") || "";

  document.getElementById("blocked-domain").textContent = domain;

  // Get state from background service worker
  let startedAt = null;
  let requiredMinutes = 0;

  function updateTimer(elapsedMs, reqMin) {
    const remaining = Math.max(0, reqMin * 60 * 1000 - elapsedMs);
    const elapsed = elapsedMs;

    const fmt = (ms) => {
      const totalSec = Math.floor(ms / 1000);
      const m = Math.floor(totalSec / 60);
      const s = totalSec % 60;
      return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
    };

    document.getElementById("live-timer").textContent = fmt(remaining);
    document.getElementById("remaining-time").textContent =
      remaining > 0 ? `${(remaining / 60000).toFixed(1)} min left` : "Session ending…";
    document.getElementById("elapsed-time").textContent = fmt(elapsed);
  }

  // Request state from background
  chrome.runtime.sendMessage({ type: "GET_STATE" }, (response) => {
    if (!response || !response.success) return;
    const { sessionState } = response.data;
    if (!sessionState) return;

    startedAt = new Date(sessionState.startedAt);
    requiredMinutes = sessionState.requiredMinutes;

    // Kick off live countdown
    const tick = () => {
      if (!startedAt) return;
      const now = Date.now();
      updateTimer(now - startedAt.getTime(), requiredMinutes);
    };
    tick();
    setInterval(tick, 1000);
  });

  // Go back button
  document.getElementById("go-back-btn").addEventListener("click", () => {
    history.back();
  });
})();
