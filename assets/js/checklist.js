(() => {
  "use strict";

  const namespace = "generador:capitulo-0:v2:";
  const migrationKey = `${namespace}legacy-migrated`;
  const checkboxes = [...document.querySelectorAll("input[data-checklist]")];
  const notes = [...document.querySelectorAll("[data-note]")];
  const progressText = document.querySelector("[data-progress-text]");
  const progressBar = document.querySelector("[data-progress-bar]");
  const resetButton = document.querySelector("[data-reset-checklist]");

  const legacyKeys = [
    "regla-paso-a-paso",
    "tablero-esperar",
    "tablero-presentar",
    "tablero-cables",
    "tablero-rotor",
    "tablero-marcar",
    "paquete-comparar",
    "paquete-contar",
    "paquete-danos",
    "paquete-foto",
    "falta-tablero",
    "falta-tornilleria",
    "falta-separadores",
    "falta-bridas",
    "falta-epoxi",
    "falta-rotor",
    "falta-pantalla",
    "falta-multimetro",
    "falta-pelacables",
    "falta-crimpadora",
    "falta-soldador",
    "falta-destornilladores",
    "falta-taladro",
    "falta-regla",
    "final-reconocer",
    "final-envios",
    "final-imanes-esp32",
    "final-faltantes",
    "final-tablero",
    "final-multimetro",
    "final-soldador",
    "final-herramientas",
    "final-fijacion",
    "final-fuente",
    "final-bornes",
    "final-selector",
    "final-cableado-red",
    "final-revision-adulto"
  ];

  function storageKey(type, key) {
    return `${namespace}${type}:${key}`;
  }

  function getItem(key) {
    try {
      return window.localStorage.getItem(key);
    } catch (error) {
      return null;
    }
  }

  function setItem(key, value) {
    try {
      window.localStorage.setItem(key, value);
      return true;
    } catch (error) {
      return false;
    }
  }

  function removeItem(key) {
    try {
      window.localStorage.removeItem(key);
    } catch (error) {
      // La interfaz sigue siendo utilizable aunque el navegador bloquee el almacenamiento.
    }
  }

  function migrateLegacyState() {
    if (getItem(migrationKey) === "1") return;

    let legacyArray = [];
    try {
      legacyArray = JSON.parse(getItem("generador-cap0") || "[]");
    } catch (error) {
      legacyArray = [];
    }

    legacyKeys.forEach((key, index) => {
      const oldIndividual = getItem(`gen-c0-${index}`);
      const oldArrayValue = legacyArray[index];
      const checked = oldIndividual === "1" || (oldIndividual === null && oldArrayValue === true);

      if (checked && getItem(storageKey("check", key)) === null) {
        setItem(storageKey("check", key), "1");
      }
    });

    setItem(migrationKey, "1");
  }

  function updateProgress() {
    const completed = checkboxes.filter((checkbox) => checkbox.checked).length;
    const total = checkboxes.length;
    const percent = total ? Math.round((completed / total) * 100) : 0;

    if (progressText) {
      progressText.textContent = `${completed} de ${total} comprobaciones realizadas`;
    }

    if (progressBar) {
      progressBar.style.width = `${percent}%`;
      progressBar.parentElement?.setAttribute("aria-valuenow", String(completed));
      progressBar.parentElement?.setAttribute("aria-valuemax", String(total));
    }
  }

  function restoreState() {
    migrateLegacyState();

    checkboxes.forEach((checkbox) => {
      const key = checkbox.dataset.key || checkbox.id;
      checkbox.checked = getItem(storageKey("check", key)) === "1";
      checkbox.addEventListener("change", () => {
        setItem(storageKey("check", key), checkbox.checked ? "1" : "0");
        updateProgress();
      });
    });

    notes.forEach((note) => {
      const key = note.dataset.key || note.id;
      note.value = getItem(storageKey("note", key)) || "";
      note.addEventListener("input", () => setItem(storageKey("note", key), note.value));
    });

    updateProgress();
  }

  function resetState() {
    const confirmed = window.confirm(
      "¿Borrar todas las casillas y observaciones guardadas del Capítulo 0? Esta acción no se puede deshacer."
    );
    if (!confirmed) return;

    checkboxes.forEach((checkbox) => {
      const key = checkbox.dataset.key || checkbox.id;
      checkbox.checked = false;
      removeItem(storageKey("check", key));
    });

    notes.forEach((note) => {
      const key = note.dataset.key || note.id;
      note.value = "";
      removeItem(storageKey("note", key));
    });

    for (let index = 0; index < 100; index += 1) {
      removeItem(`gen-c0-${index}`);
    }
    removeItem("generador-cap0");
    setItem(migrationKey, "1");
    updateProgress();
  }

  resetButton?.addEventListener("click", resetState);
  restoreState();
})();
