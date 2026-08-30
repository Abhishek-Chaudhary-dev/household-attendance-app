// V3 navigation owns panel visibility, active tab state, the screen title,
// and the More bottom sheet — all in one place. app.js/settlement.js/history.js
// must never toggle panel .hidden classes themselves (see V3-DESIGN-NOTES.md).
(() => {
  const panels = [
    ["today", "todayPanel"],
    ["month", "monthPanel"],
    ["reports", "reportsPanel"],
    ["settlement", "settlementPanel"],
    ["history", "historyPanel"],
    ["workers", "workersPanel"],
    ["household", "householdPanel"]
  ];

  const titles = {
    today: "Home", workers: "Workers", reports: "Reports", settlement: "Payments",
    month: "This month", history: "History", household: "Household"
  };

  function closeSheet() {
    document.getElementById("moreSheet")?.classList.remove("open");
    document.getElementById("sheetBackdrop")?.classList.remove("open");
    document.getElementById("moreBtn")?.setAttribute("aria-expanded", "false");
  }

  function openSheet() {
    document.getElementById("moreSheet")?.classList.add("open");
    document.getElementById("sheetBackdrop")?.classList.add("open");
    document.getElementById("moreBtn")?.setAttribute("aria-expanded", "true");
  }

  function selectView(view) {
    const panelId = new Map(panels).get(view);
    if (!panelId) return;

    document.querySelectorAll(".panel").forEach(panel => {
      panel.classList.toggle("hidden", panel.id !== panelId);
    });

    document.querySelectorAll(".tab[data-view]").forEach(tab => {
      tab.classList.toggle("active", tab.dataset.view === view);
    });

    const titleEl = document.getElementById("screenTitle");
    if (titleEl) titleEl.textContent = titles[view] || view;

    closeSheet();
  }

  document.addEventListener("click", event => {
    const tab = event.target.closest?.(".tab[data-view]");
    if (tab) {
      const view = tab.dataset.view;
      if (!new Map(panels).has(view)) return;
      // Prevent app.js/settlement.js/history.js legacy handlers from fighting
      // this central navigation state.
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      selectView(view);
      return;
    }
    if (event.target.closest?.("#moreBtn")) {
      event.stopPropagation();
      const sheet = document.getElementById("moreSheet");
      sheet?.classList.contains("open") ? closeSheet() : openSheet();
      return;
    }
    if (event.target.closest?.("#sheetBackdrop")) {
      closeSheet();
      return;
    }
  }, true);

  document.addEventListener("keydown", e => { if (e.key === "Escape") closeSheet(); });

  document.addEventListener("DOMContentLoaded", () => selectView("today"));
  if (document.readyState !== "loading") selectView("today");
})();
