// V3 navigation owns panel visibility in one place.
// Capture clicks before legacy module listeners can override the selected panel.
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

  function selectView(view) {
    const panelId = new Map(panels).get(view);
    if (!panelId) return;

    document.querySelectorAll(".panel").forEach(panel => {
      panel.classList.toggle("hidden", panel.id !== panelId);
    });

    document.querySelectorAll(".tab[data-view]").forEach(tab => {
      tab.classList.toggle("active", tab.dataset.view === view);
    });

    const more = document.querySelector(".more-nav");
    if (more && ["month", "history", "household"].includes(view)) more.open = false;
  }

  document.addEventListener("click", event => {
    const tab = event.target.closest?.(".tab[data-view]");
    if (!tab) return;

    const view = tab.dataset.view;
    if (!new Map(panels).has(view)) return;

    // Prevent app.js/settlement.js/history.js legacy handlers from fighting
    // this central navigation state.
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    selectView(view);
  }, true);

  document.addEventListener("DOMContentLoaded", () => selectView("today"));
  if (document.readyState !== "loading") selectView("today");
})();
