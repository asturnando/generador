(() => {
  "use strict";

  document.querySelectorAll("[data-print]").forEach((button) => {
    button.addEventListener("click", () => window.print());
  });

  const quickMenu = document.querySelector(".quick-menu");
  quickMenu?.querySelectorAll("a").forEach((link) => {
    link.addEventListener("click", () => quickMenu.removeAttribute("open"));
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") quickMenu?.removeAttribute("open");
  });
})();
