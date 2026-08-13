(() => {
  "use strict";
  const builder = document.querySelector("[data-coil-jig]");
  if (!builder) return;
  let svg = builder.querySelector("[data-jig-svg]");
  const message = builder.querySelector("[data-jig-message]");
  const renderButton = builder.querySelector("[data-jig-render]");
  const downloadButton = builder.querySelector("[data-jig-download]");
  const printButtons = [...document.querySelectorAll("[data-print]")];
  const fields = {
    width: builder.querySelector("#jig-window-width"),
    height: builder.querySelector("#jig-window-height"),
    bar: builder.querySelector("#jig-core-width"),
    margin: builder.querySelector("#jig-margin"),
    clearance: builder.querySelector("#jig-clearance"),
    depth: builder.querySelector("#jig-depth")
  };
  let latestSvg = "";
  const read = (field) => {
    const parsed = Number.parseFloat(field.value);
    return Number.isFinite(parsed) ? parsed : null;
  };
  const fmt = (number) => Number.parseFloat(number.toFixed(2)).toString();

  function formValues() {
    return Object.fromEntries(Object.entries(fields).map(([name, field]) => [name, read(field)]));
  }

  function validate(v) {
    const errors = [];
    Object.entries(v).forEach(([name, number]) => {
      if (number === null || number < 0 || (name !== "clearance" && number === 0)) errors.push("Completa todas las medidas.");
    });
    if (errors.length) return [...new Set(errors)];
    if (v.width <= 2 * v.bar + 2 * v.clearance) errors.push("El ancho no deja hueco central.");
    if (v.height <= 2 * v.bar) errors.push("El alto no deja hueco central.");
    if (v.width + 2 * v.margin > 180 || v.height + 2 * v.margin > 165) errors.push("La tapa no cabe en esta hoja A4.");
    if (v.bar > 22) errors.push("Las barras no caben en el área de despiece.");
    return errors;
  }

  function buildSvg(v) {
    const plateW = v.width + 2 * v.margin;
    const plateH = v.height + 2 * v.margin;
    const shortL = v.width - 2 * v.bar - 2 * v.clearance;
    const plateX = (210 - plateW) / 2;
    const plateY = 18;
    let partY = plateY + plateH + 25;
    const rows = [
      ["BARRA LATERAL 1", v.height],
      ["BARRA LATERAL 2", v.height],
      ["BARRA CORTA 1", shortL],
      ["BARRA CORTA 2", shortL]
    ];
    const partMarkup = rows.map(([label, length]) => {
      const x = (210 - length) / 2;
      const markup = [
        '<g transform="translate(', fmt(x), ' ', fmt(partY), ')">',
        '<rect width="', fmt(length), '" height="', fmt(v.bar), '" rx="', fmt(Math.min(v.bar / 2, 4)), '" class="cut"/>',
        '<text x="', fmt(length / 2), '" y="', fmt(v.bar / 2 + 1.2), '" class="part">', label, ' · ', fmt(length), ' × ', fmt(v.bar), ' mm</text></g>'
      ].join("");
      partY += v.bar + 5;
      return markup;
    }).join("");
    const totalH = Math.max(297, partY + 35);
    const control = Math.min(50, plateW);
    return [
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 210 ', fmt(totalH), '" width="210mm" height="', fmt(totalH), 'mm" role="img" aria-labelledby="jig-title jig-desc">',
      '<title id="jig-title">Despiece a escala uno a uno del útil desmontable</title>',
      '<desc id="jig-desc">Una tapa que debe cortarse dos veces y cuatro barras independientes.</desc>',
      '<style>.cut{fill:none;stroke:#082e6b;stroke-width:.5}.guide{fill:none;stroke:#0c5ea8;stroke-width:.3;stroke-dasharray:2 1}.part{font:700 2.6px Arial,sans-serif;text-anchor:middle;fill:#082e6b}.meta{font:700 3.2px Arial,sans-serif;fill:#082e6b}.small{font:2.6px Arial,sans-serif;fill:#34465a}.ruler{stroke:#111;stroke-width:.45}.tick{stroke:#111;stroke-width:.3}</style>',
      '<rect width="100%" height="100%" fill="white"/>',
      '<text x="15" y="8" class="meta">ÚTIL DE BOBINA · CORTAR 2 TAPAS Y 4 BARRAS</text>',
      '<text x="15" y="13" class="small">Espesor apilado de cada barra: ', fmt(v.depth), ' mm.</text>',
      '<g transform="translate(', fmt(plateX), ' ', fmt(plateY), ')">',
      '<rect width="', fmt(plateW), '" height="', fmt(plateH), '" rx="3" class="cut"/>',
      '<rect x="', fmt(v.margin), '" y="', fmt(v.margin), '" width="', fmt(v.width), '" height="', fmt(v.height), '" rx="', fmt(Math.min(v.bar / 2, 6)), '" class="guide"/>',
      '<text x="', fmt(plateW / 2), '" y="', fmt(plateH / 2), '" class="meta" text-anchor="middle">TAPA · ', fmt(plateW), ' × ', fmt(plateH), ' mm · CORTAR 2</text>',
      '<text x="', fmt(plateW / 2), '" y="', fmt(plateH / 2 + 6), '" class="small" text-anchor="middle">línea discontinua = posición del núcleo, no cortar</text></g>',
      partMarkup,
      '<g transform="translate(15 ', fmt(totalH - 20), ')"><line x1="0" y1="0" x2="', fmt(control), '" y2="0" class="ruler"/><line x1="0" y1="-2" x2="0" y2="2" class="tick"/><line x1="', fmt(control), '" y1="-2" x2="', fmt(control), '" y2="2" class="tick"/>',
      '<text x="0" y="6" class="small">Regla: ', fmt(control), ' mm · imprimir al 100 %, sin ajustar</text>',
      '<text x="0" y="11" class="small">Barra corta: ', fmt(shortL), ' mm · juego total: ', fmt(2 * v.clearance), ' mm</text></g></svg>'
    ].join("");
  }

  function render() {
    const values = formValues();
    const errors = validate(values);
    if (errors.length) {
      latestSvg = "";
      downloadButton.disabled = true;
      printButtons.forEach((button) => { button.disabled = true; });
      message.className = "template-message is-error";
      message.textContent = errors.join(" ");
      svg.innerHTML = '<text x="50%" y="50%" text-anchor="middle" class="template-placeholder">Corrige las medidas</text>';
      return;
    }
    latestSvg = buildSvg(values);
    const parsed = new DOMParser().parseFromString(latestSvg, "image/svg+xml").documentElement;
    svg.replaceWith(parsed);
    svg = parsed;
    svg.dataset.jigSvg = "";
    svg.classList.add("rotor-template-svg", "coil-jig-svg");
    message.className = "template-message is-ready";
    message.textContent = "Despiece calculado. Haz primero un prototipo vacío y demuestra que las cuatro barras salen hacia el centro.";
    downloadButton.disabled = false;
    printButtons.forEach((button) => { button.disabled = false; });
  }

  function download() {
    if (!latestSvg) return;
    const blob = new Blob([latestSvg], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "despiece-util-bobina-1a1.svg";
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  renderButton.addEventListener("click", render);
  downloadButton.addEventListener("click", download);
  printButtons.forEach((button) => { button.disabled = true; });
  const query = new URLSearchParams(window.location.search);
  let hasQueryValues = false;
  Object.entries(fields).forEach(([name, field]) => {
    if (!query.has(name)) return;
    field.value = query.get(name);
    hasQueryValues = true;
  });
  if (hasQueryValues) render();
})();
