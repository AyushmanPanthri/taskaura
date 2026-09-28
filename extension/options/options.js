// options.js — Settings page logic

(function () {
  const appUrlInput = document.getElementById("app-url-input");
  const saveUrlBtn = document.getElementById("save-url-btn");
  const urlSaveStatus = document.getElementById("url-save-status");
  const forcePollBtn = document.getElementById("force-poll-btn");

  // Load current settings
  chrome.storage.local.get(
    ["appUrl", "sessionState", "blocking", "blocklist", "lastPollAt", "lastError"],
    (result) => {
      if (result.appUrl) appUrlInput.value = result.appUrl;

      document.getElementById("last-poll").textContent = result.lastPollAt
        ? new Date(result.lastPollAt).toLocaleTimeString()
        : "Never";

      document.getElementById("active-session").textContent = result.sessionState?.isRunning
        ? `Yes — ${result.sessionState.remainingMinutes ?? "?"} min remaining`
        : "No";

      document.getElementById("blocking-active").textContent = result.blocking ? "✓ Yes" : "No";
      document.getElementById("domains-count").textContent =
        `${result.blocklist?.length ?? 0} domains`;

      if (result.lastError) {
        document.getElementById("error-row").style.display = "";
        document.getElementById("last-error").textContent = result.lastError;
      }
    }
  );

  // Save app URL
  saveUrlBtn.addEventListener("click", () => {
    const url = appUrlInput.value.trim().replace(/\/$/, "");
    if (!url) return;

    chrome.runtime.sendMessage({ type: "SET_APP_URL", url }, () => {
      urlSaveStatus.classList.remove("hidden");
      setTimeout(() => urlSaveStatus.classList.add("hidden"), 2500);
    });
  });

  // Force poll
  forcePollBtn.addEventListener("click", () => {
    forcePollBtn.disabled = true;
    forcePollBtn.textContent = "Refreshing…";
    chrome.runtime.sendMessage({ type: "FORCE_POLL" }, () => {
      setTimeout(() => {
        forcePollBtn.disabled = false;
        forcePollBtn.textContent = "Force refresh now";
        location.reload();
      }, 1200);
    });
  });
})();
