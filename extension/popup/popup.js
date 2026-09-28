// popup.js — Extension popup logic
// Reads state from background worker (cached from last poll) and
// provides blocklist management by calling the server API directly.

(function () {
  let appUrl = "http://localhost:3000";
  let currentBlocklist = [];
  let isAuthenticated = false;

  const statusDot = document.getElementById("status-dot");
  const sessionActive = document.getElementById("session-active");
  const sessionIdle = document.getElementById("session-idle");
  const sessionRemaining = document.getElementById("session-remaining");
  const authWarning = document.getElementById("auth-warning");
  const domainList = document.getElementById("domain-list");
  const emptyState = document.getElementById("empty-state");
  const domainCount = document.getElementById("domain-count");
  const domainInput = document.getElementById("domain-input");
  const addBtn = document.getElementById("add-btn");
  const addError = document.getElementById("add-error");

  // Load state from background
  function loadState() {
    chrome.runtime.sendMessage({ type: "GET_STATE" }, (response) => {
      if (!response || !response.success) return;
      const { sessionState, blocklist, blocking, lastError, appUrl: url } = response.data;

      if (url) appUrl = url;

      // Auth / session display
      if (!sessionState && !blocklist.length && lastError) {
        // Could be unauthenticated
        authWarning.classList.remove("hidden");
        statusDot.className = "status-dot error";
      } else {
        authWarning.classList.add("hidden");
      }

      if (sessionState && sessionState.isRunning) {
        sessionActive.classList.remove("hidden");
        sessionIdle.classList.add("hidden");
        sessionRemaining.textContent = `${sessionState.remainingMinutes} min remaining`;
        statusDot.className = blocking ? "status-dot blocking" : "status-dot active";
      } else {
        sessionActive.classList.add("hidden");
        sessionIdle.classList.remove("hidden");
        statusDot.className = "status-dot active";
      }

      currentBlocklist = blocklist || [];
      renderDomainList();
    });
  }

  // Render domain list
  function renderDomainList() {
    domainCount.textContent = `${currentBlocklist.length} / 50`;
    domainList.innerHTML = "";

    if (currentBlocklist.length === 0) {
      domainList.appendChild(emptyState);
      emptyState.classList.remove("hidden");
      return;
    }
    emptyState.classList.add("hidden");

    for (const domain of currentBlocklist) {
      const item = document.createElement("div");
      item.className = "domain-item";
      item.innerHTML = `
        <span class="domain-name">${escapeHtml(domain)}</span>
        <button class="remove-btn" data-domain="${escapeHtml(domain)}" title="Remove">×</button>
      `;
      item.querySelector(".remove-btn").addEventListener("click", () => removeDomain(domain));
      domainList.appendChild(item);
    }
  }

  function escapeHtml(s) {
    return s.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
  }

  // Add domain
  async function addDomain() {
    const raw = domainInput.value.trim();
    if (!raw) return;

    addError.classList.add("hidden");
    addBtn.disabled = true;

    try {
      const res = await fetch(`${appUrl}/api/v1/extension/blocklist`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ domain: raw }),
      });

      const data = await res.json();

      if (!data.success) {
        addError.textContent = data.error?.message || "Failed to add domain.";
        addError.classList.remove("hidden");
      } else {
        domainInput.value = "";
        // Force a poll to refresh blocklist in background, then reload popup
        chrome.runtime.sendMessage({ type: "FORCE_POLL" }, () => {
          setTimeout(loadState, 500);
        });
      }
    } catch (err) {
      addError.textContent = "Network error — is TaskAura open?";
      addError.classList.remove("hidden");
    } finally {
      addBtn.disabled = false;
    }
  }

  // Remove domain
  async function removeDomain(domain) {
    try {
      const res = await fetch(
        `${appUrl}/api/v1/extension/blocklist/${encodeURIComponent(domain)}`,
        { method: "DELETE", credentials: "include" }
      );
      const data = await res.json();
      if (data.success) {
        chrome.runtime.sendMessage({ type: "FORCE_POLL" }, () => {
          setTimeout(loadState, 500);
        });
      }
    } catch (err) {
      console.error("[Popup] Remove domain error:", err);
    }
  }

  // Bind controls
  addBtn.addEventListener("click", addDomain);
  domainInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") addDomain();
  });

  document.getElementById("open-options").addEventListener("click", () => {
    chrome.runtime.openOptionsPage();
  });

  document.getElementById("force-poll").addEventListener("click", () => {
    chrome.runtime.sendMessage({ type: "FORCE_POLL" }, () => {
      setTimeout(loadState, 600);
    });
  });

  // Initial load
  loadState();
})();
