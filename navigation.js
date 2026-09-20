// Navigation owns panel visibility, active tab state, and the screen title —
// the single source of truth, so app.js/settlement.js must never toggle
// panel .hidden classes themselves (this was Bug 2 in the previous design;
// keeping the same discipline here).
(() => {
  const panels = [
    ["today", "todayPanel"],
    ["calendar", "calendarPanel"],
    ["pay", "payPanel"],
    ["workers", "workersPanel"]
  ];
  const titles = { today: "Today", calendar: "Calendar", pay: "Pay", workers: "Workers" };
  const panelMap = new Map(panels);

  function selectView(view) {
    const panelId = panelMap.get(view);
    if (!panelId) return;
    document.querySelectorAll(".panel").forEach(panel => {
      panel.classList.toggle("hidden", panel.id !== panelId);
    });
    document.querySelectorAll(".tab[data-view]").forEach(tab => {
      tab.classList.toggle("active", tab.dataset.view === view);
    });
    const titleEl = document.getElementById("screenTitle");
    if (titleEl) titleEl.textContent = titles[view] || view;
    window.__onViewChanged?.(view);
  }
  window.selectView = selectView;

  document.addEventListener("click", event => {
    const tab = event.target.closest?.(".tab[data-view]");
    if (!tab) return;
    const view = tab.dataset.view;
    if (!panelMap.has(view)) return;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    selectView(view);
  }, true);

  document.addEventListener("DOMContentLoaded", () => selectView("today"));
  if (document.readyState !== "loading") selectView("today");
})();
