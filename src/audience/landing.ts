const tabs = Array.from(
  document.querySelectorAll<HTMLButtonElement>("[data-tab]"),
);
function activate(tab: HTMLButtonElement) {
  for (const item of tabs) {
    const selected = item === tab;
    item.setAttribute("aria-selected", String(selected));
    item.tabIndex = selected ? 0 : -1;
    const panel = document.getElementById(
      item.getAttribute("aria-controls") ?? "",
    );
    if (panel) panel.hidden = !selected;
  }
}
tabs.forEach((tab, index) => {
  tab.addEventListener("click", () => activate(tab));
  tab.addEventListener("keydown", (event) => {
    const next =
      event.key === "ArrowRight"
        ? (index + 1) % tabs.length
        : event.key === "ArrowLeft"
          ? (index + tabs.length - 1) % tabs.length
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? tabs.length - 1
              : undefined;
    if (next !== undefined) {
      event.preventDefault();
      activate(tabs[next]);
      tabs[next].focus();
    }
  });
});
export {};
