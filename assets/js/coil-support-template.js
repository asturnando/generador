(() => {
  "use strict";
  const builder = document.querySelector("[data-coil-support]");
  if (!builder) return;
  let svg = builder.querySelector("[data-support-svg]");
  const message = builder.querySelector("[data-support-message]");
  const renderButton = builder.querySelector("[data-support-render]");
  const downloadButton = builder.querySelector("[data-support-download]");
  const printButtons = [...document.querySelectorAll("[data-print]")];
  const fields = {
    coilWidth: builder.querySelector("#support-coil-width"),
    coilHeight: builder.querySelector("#support-coil-height"),
    baseDepth: builder.querySelector("#support-base-depth"),
    gussetBase: builder.querySelector("#support-gusset-base"),
    gussetHeight: builder.querySelector("#support-gusset-height"),
    thickness: builder.querySelector("#support-thickness")
  };
  const MARGIN = 30;
  let latestSvg = "";
  const read = (field) => {
    const parsed = Number.parseFloat(field.value);
    return Number.isFinite(parsed) ? parsed : null;
  };
  const fmt = (number) => Number.parseFloat(number.toFixed(2)).toString();
  const values = () => Object.fromEntries(Object.entries(fields).map(([name, field]) => [name, read(field)]));

  function validate(v) {
    const errors = [];
    if (Object.values(v).some((number) => number === null || number <= 0)) errors.push("Completa las seis medidas con números mayores que cero.");
    if (errors.length) return errors;
    const carrierHeight = v.coilHeight + 2 * MARGIN;
    if (v.coilWidth + 2 * MARGIN > 180) errors.push("La placa supera 180 mm de ancho y no cabe en una hoja A4 con márgenes. Divide el plano con un programa de impresión por mosaico o usa papel mayor.");
    if (v.gussetHeight > carrierHeight - 10) errors.push("La pata vertical no cabe en la placa dejando 10 mm libres arriba.");
    if (v.gussetBase + v.thickness + 10 > v.baseDepth) errors.push("La base no deja sitio para placa, cartabón y 10 mm libres delante.");
    if (v.thickness >= Math.min(v.coilWidth, v.coilHeight)) errors.push("Revisa el espesor: parece mayor que la bobina.");
    return errors;
  }

  function buildSvg(v) {
    const carrierW = v.coilWidth + 2 * MARGIN;
    const carrierH = v.coilHeight + 2 * MARGIN;
    const gap = 20;
    const pad = 15;
    const totalW = Math.max(carrierW, v.gussetBase) + 2 * pad;
    const totalH = carrierH + v.baseDepth + 2 * v.gussetHeight + 3 * gap + 58;
    const carrierX = pad;
    const carrierY = 28;
    const baseX = pad;
    const baseY = carrierY + carrierH + gap;
    const gussetY = baseY + v.baseDepth + gap;
    const ruler = Math.min(100, carrierW);
    return [
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ', fmt(totalW), ' ', fmt(totalH), '" width="', fmt(totalW), 'mm" height="', fmt(totalH), 'mm" role="img" aria-labelledby="support-svg-title support-svg-desc">',
      '<title id="support-svg-title">Plano uno a uno del soporte ajustable de bobina</title><desc id="support-svg-desc">Placa vertical, base y dos cartabones calculados a partir de medidas reales.</desc>',
      '<style>.cut{fill:none;stroke:#082e6b;stroke-width:.55}.guide{fill:none;stroke:#0c5ea8;stroke-width:.35;stroke-dasharray:3 1.5}.seat{fill:#eef7ff;stroke:#0c5ea8;stroke-width:.4}.part{font:700 3px Arial,sans-serif;fill:#082e6b}.meta{font:700 3.4px Arial,sans-serif;fill:#082e6b}.small{font:2.7px Arial,sans-serif;fill:#34465a}.warn{font:700 2.8px Arial,sans-serif;fill:#9b2c2c}.ruler{stroke:#111;stroke-width:.5}.tick{stroke:#111;stroke-width:.35}</style><rect width="100%" height="100%" fill="white"/>',
      '<text x="', fmt(pad), '" y="9" class="meta">SOPORTE AJUSTABLE DE BOBINA · PLANO 1:1</text><text x="', fmt(pad), '" y="15" class="small">Tablero: ', fmt(v.thickness), ' mm · margen: 30 mm por lado.</text><text x="', fmt(pad), '" y="20" class="warn">MOTOR DESENCHUFADO · USO MANUAL · GALGA NO MAGNÉTICA DE 10 mm</text>',
      '<g transform="translate(', fmt(carrierX), ' ', fmt(carrierY), ')"><rect width="', fmt(carrierW), '" height="', fmt(carrierH), '" class="cut"/><rect x="30" y="30" width="', fmt(v.coilWidth), '" height="', fmt(v.coilHeight), '" rx="4" class="guide"/><line x1="', fmt(carrierW / 2), '" y1="0" x2="', fmt(carrierW / 2), '" y2="', fmt(carrierH), '" class="guide"/><line x1="0" y1="', fmt(carrierH / 2), '" x2="', fmt(carrierW), '" y2="', fmt(carrierH / 2), '" class="guide"/><text x="4" y="-4" class="part">PLACA VERTICAL · ', fmt(carrierW), ' × ', fmt(carrierH), ' mm</text><text x="', fmt(carrierW / 2), '" y="', fmt(carrierH / 2 - 3), '" text-anchor="middle" class="small">envolvente de la bobina medida</text><text x="', fmt(carrierW / 2), '" y="', fmt(carrierH / 2 + 3), '" text-anchor="middle" class="small">presentar antes de taladrar</text></g>',
      '<g transform="translate(', fmt(baseX), ' ', fmt(baseY), ')"><rect width="', fmt(carrierW), '" height="', fmt(v.baseDepth), '" class="cut"/><rect x="0" y="', fmt(v.baseDepth - v.gussetBase - v.thickness), '" width="', fmt(carrierW), '" height="', fmt(v.thickness), '" class="seat"/><text x="4" y="-4" class="part">BASE · ', fmt(carrierW), ' × ', fmt(v.baseDepth), ' mm</text><text x="', fmt(carrierW / 2), '" y="12" text-anchor="middle" class="small">reservar los extremos laterales para dos sargentos</text><text x="', fmt(carrierW / 2), '" y="', fmt(v.baseDepth - v.gussetBase - v.thickness - 3), '" text-anchor="middle" class="small">línea de asiento de la placa vertical</text></g>',
      '<g transform="translate(', fmt(baseX), ' ', fmt(gussetY), ')"><path d="M0 ', fmt(v.gussetHeight), ' L0 0 L', fmt(v.gussetBase), ' ', fmt(v.gussetHeight), ' Z" class="cut"/><text x="4" y="', fmt(v.gussetHeight - 4), '" class="part">CARTABÓN 1 · ', fmt(v.gussetBase), ' × ', fmt(v.gussetHeight), ' mm</text></g>',
      '<g transform="translate(', fmt(baseX), ' ', fmt(gussetY + v.gussetHeight + gap), ')"><path d="M0 ', fmt(v.gussetHeight), ' L0 0 L', fmt(v.gussetBase), ' ', fmt(v.gussetHeight), ' Z" class="cut"/><text x="4" y="', fmt(v.gussetHeight - 4), '" class="part">CARTABÓN 2 · IDÉNTICO</text></g>',
      '<g transform="translate(', fmt(pad), ' ', fmt(totalH - 18), ')"><line x1="0" y1="0" x2="', fmt(ruler), '" y2="0" class="ruler"/><line x1="0" y1="-2" x2="0" y2="2" class="tick"/><line x1="', fmt(ruler), '" y1="-2" x2="', fmt(ruler), '" y2="2" class="tick"/><text x="0" y="6" class="small">Regla: ', fmt(ruler), ' mm · imprimir al 100 %, sin ajustar.</text><text x="0" y="11" class="small">Línea discontinua = guía; no cortar ni taladrar.</text></g></svg>'
    ].join("");
  }

  function render() {
    const v = values();
    const errors = validate(v);
    if (errors.length) {
      latestSvg = "";
      downloadButton.disabled = true;
      printButtons.forEach((button) => { button.disabled = true; });
      message.className = "template-message is-error";
      message.textContent = errors.join(" ");
      svg.innerHTML = '<text x="50%" y="50%" text-anchor="middle" class="template-placeholder">Revisa las medidas</text>';
      return;
    }
    latestSvg = buildSvg(v);
    const parsed = new DOMParser().parseFromString(latestSvg, "image/svg+xml").documentElement;
    svg.replaceWith(parsed);
    svg = parsed;
    svg.dataset.supportSvg = "";
    svg.classList.add("rotor-template-svg", "coil-jig-svg");
    message.className = "template-message is-ready";
    message.textContent = "Plano calculado. Corta las piezas, presenta la bobina real y transfiere sus orificios antes de taladrar.";
    downloadButton.disabled = false;
    printButtons.forEach((button) => { button.disabled = false; });
  }

  function download() {
    if (!latestSvg) return;
    const blob = new Blob([latestSvg], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "plano-soporte-bobina-1a1.svg";
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
