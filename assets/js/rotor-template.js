(() => {
  "use strict";

  const builder = document.querySelector("[data-rotor-template]");
  if (!builder) return;

  let svg = builder.querySelector("[data-template-svg]");
  const message = builder.querySelector("[data-template-message]");
  const renderButton = builder.querySelector("[data-template-render]");
  const downloadButton = builder.querySelector("[data-template-download]");
  const printButtons = document.body.classList.contains("template-tool-page")
    ? [...document.querySelectorAll("[data-print]")]
    : [];
  const fields = {
    count: builder.querySelector("#c3-template-count"),
    rotor: builder.querySelector("#c3-template-rotor"),
    center: builder.querySelector("#c3-template-center"),
    magnet: builder.querySelector("#c3-template-magnet"),
    radius: builder.querySelector("#c3-template-radius"),
    polarity: builder.querySelector("#c3-template-polarity")
  };

  let latestSvg = "";

  function numberValue(field) {
    const value = Number.parseFloat(field.value);
    return Number.isFinite(value) ? value : null;
  }

  function format(value) {
    return Number.parseFloat(value.toFixed(2)).toString();
  }

  function validate(values) {
    const errors = [];
    if (![4, 6, 8].includes(values.count)) errors.push("Selecciona 4, 6 u 8 posiciones.");
    if (values.rotor === null || values.rotor <= 0) errors.push("Introduce el diámetro real del rotor.");
    if (values.rotor !== null && values.rotor > 150) errors.push("Esta versión para una sola hoja A4 admite un rotor de hasta 150 mm.");
    if (values.center === null || values.center <= 0) errors.push("Introduce el diámetro real del centro.");
    if (values.magnet === null || values.magnet <= 0) errors.push("Introduce el diámetro medido del imán.");
    if (values.radius === null || values.radius <= 0) errors.push("Introduce el radio hasta el centro de los imanes.");

    if (errors.length) return errors;

    const outerMargin = values.rotor / 2 - values.radius - values.magnet / 2;
    const centerClearance = values.radius - values.magnet / 2 - values.center / 2;
    const adjacentGap = 2 * values.radius * Math.sin(Math.PI / values.count) - values.magnet;

    if (outerMargin <= 0) errors.push("Los imanes invaden el borde exterior.");
    if (centerClearance <= 0) errors.push("Los imanes invaden el centro o el cubo.");
    if (adjacentGap <= 0) errors.push("Las huellas de imán se solapan entre sí.");
    return errors;
  }

  function markerLabel(index, polarity) {
    if (polarity === "same-a") return "A";
    if (polarity === "alternate") return index % 2 === 0 ? "A" : "B";
    return String(index + 1);
  }

  function buildSvg(values) {
    const padding = 18;
    const size = values.rotor + padding * 2;
    const center = size / 2;
    const outerMargin = values.rotor / 2 - values.radius - values.magnet / 2;
    const centerClearance = values.radius - values.magnet / 2 - values.center / 2;
    const adjacentGap = 2 * values.radius * Math.sin(Math.PI / values.count) - values.magnet;
    const controls = Math.min(50, values.rotor * 0.45);
    const title = `Plantilla ${values.count} posiciones · rotor Ø${format(values.rotor)} mm`;
    const markers = [];

    for (let index = 0; index < values.count; index += 1) {
      const angle = -Math.PI / 2 + (index * 2 * Math.PI) / values.count;
      const x = center + values.radius * Math.cos(angle);
      const y = center + values.radius * Math.sin(angle);
      const label = markerLabel(index, values.polarity);
      markers.push(`
        <line x1="${format(center)}" y1="${format(center)}" x2="${format(x)}" y2="${format(y)}" class="construction-line" />
        <circle cx="${format(x)}" cy="${format(y)}" r="${format(values.magnet / 2)}" class="magnet-cut" />
        <line x1="${format(x - 2)}" y1="${format(y)}" x2="${format(x + 2)}" y2="${format(y)}" class="center-mark" />
        <line x1="${format(x)}" y1="${format(y - 2)}" x2="${format(x)}" y2="${format(y + 2)}" class="center-mark" />
        <text x="${format(x)}" y="${format(y + 1.6)}" class="marker-text">${label}</text>`);
    }

    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${format(size)} ${format(size + 32)}" width="${format(size)}mm" height="${format(size + 32)}mm" role="img" aria-labelledby="rotor-template-title rotor-template-desc">
      <title id="rotor-template-title">${title}</title>
      <desc id="rotor-template-desc">Plantilla a escala uno a uno calculada con las medidas introducidas. Debe verificarse la regla de control después de imprimir.</desc>
      <style>
        .outline{fill:none;stroke:#082e6b;stroke-width:.55}.pitch{fill:none;stroke:#0c5ea8;stroke-width:.3;stroke-dasharray:2 1}.construction-line{stroke:#9ab1c5;stroke-width:.18}.magnet-cut{fill:none;stroke:#b92027;stroke-width:.45}.center-mark{stroke:#b92027;stroke-width:.28}.marker-text{font:700 3.2px Arial,sans-serif;text-anchor:middle;fill:#082e6b}.meta{font:700 3.2px Arial,sans-serif;fill:#082e6b}.small{font:2.6px Arial,sans-serif;fill:#34465a}.ruler{stroke:#111;stroke-width:.45}.tick{stroke:#111;stroke-width:.3}
      </style>
      <rect width="100%" height="100%" fill="white" />
      <text x="${padding}" y="7" class="meta">${title}</text>
      <text x="${padding}" y="12" class="small">Líneas rojas: huella medida del imán · círculo azul discontinuo: radio de centros</text>
      <g transform="translate(0 14)">
        <circle cx="${format(center)}" cy="${format(center)}" r="${format(values.rotor / 2)}" class="outline" />
        <circle cx="${format(center)}" cy="${format(center)}" r="${format(values.radius)}" class="pitch" />
        <circle cx="${format(center)}" cy="${format(center)}" r="${format(values.center / 2)}" class="outline" />
        <line x1="${format(center - values.rotor / 2)}" y1="${format(center)}" x2="${format(center + values.rotor / 2)}" y2="${format(center)}" class="construction-line" />
        <line x1="${format(center)}" y1="${format(center - values.rotor / 2)}" x2="${format(center)}" y2="${format(center + values.rotor / 2)}" class="construction-line" />
        ${markers.join("")}
      </g>
      <g transform="translate(${padding} ${format(size + 18)})">
        <line x1="0" y1="0" x2="${format(controls)}" y2="0" class="ruler" />
        <line x1="0" y1="-2" x2="0" y2="2" class="tick" />
        <line x1="${format(controls)}" y1="-2" x2="${format(controls)}" y2="2" class="tick" />
        <text x="0" y="6" class="small">Regla de control: ${format(controls)} mm · imprimir al 100 %, sin «ajustar a página»</text>
        <text x="0" y="11" class="small">Margen exterior geométrico ${format(outerMargin)} mm · despeje al centro ${format(centerClearance)} mm · separación entre huellas ${format(adjacentGap)} mm</text>
      </g>
    </svg>`;
  }

  function valuesFromForm() {
    return {
      count: Number.parseInt(fields.count.value, 10),
      rotor: numberValue(fields.rotor),
      center: numberValue(fields.center),
      magnet: numberValue(fields.magnet),
      radius: numberValue(fields.radius),
      polarity: fields.polarity.value
    };
  }

  function render() {
    const values = valuesFromForm();
    const errors = validate(values);
    if (errors.length) {
      latestSvg = "";
      downloadButton.disabled = true;
      printButtons.forEach((button) => { button.disabled = true; });
      message.className = "template-message is-error";
      message.textContent = errors.join(" ");
      svg.innerHTML = '<text x="50%" y="50%" text-anchor="middle" class="template-placeholder">Introduce medidas verificadas para dibujar</text>';
      svg.removeAttribute("style");
      return;
    }

    latestSvg = buildSvg(values);
    const parsed = new DOMParser().parseFromString(latestSvg, "image/svg+xml").documentElement;
    svg.replaceWith(parsed);
    svg = parsed;
    parsed.dataset.templateSvg = "";
    parsed.classList.add("rotor-template-svg");
    parsed.style.setProperty("--template-width", `${values.rotor + 36}mm`);

    const outerMargin = values.rotor / 2 - values.radius - values.magnet / 2;
    const centerClearance = values.radius - values.magnet / 2 - values.center / 2;
    const adjacentGap = 2 * values.radius * Math.sin(Math.PI / values.count) - values.magnet;
    message.className = "template-message is-ready";
    message.textContent = `Dibujo geométricamente válido. Margen exterior: ${format(outerMargin)} mm; despeje al centro: ${format(centerClearance)} mm; separación entre huellas: ${format(adjacentGap)} mm. Estos valores todavía necesitan aprobación estructural.`;
    downloadButton.disabled = false;
    printButtons.forEach((button) => { button.disabled = false; });
  }

  function download() {
    if (!latestSvg) return;
    const count = fields.count.value;
    const blob = new Blob([latestSvg], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `plantilla-rotor-${count}-imanes.svg`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  renderButton.addEventListener("click", render);
  downloadButton.addEventListener("click", download);
  printButtons.forEach((button) => { button.disabled = true; });

  const query = new URLSearchParams(window.location.search);
  const queryNames = ["count", "rotor", "center", "magnet", "radius"];
  if (queryNames.every((name) => query.has(name))) {
    fields.count.value = query.get("count");
    fields.rotor.value = query.get("rotor");
    fields.center.value = query.get("center");
    fields.magnet.value = query.get("magnet");
    fields.radius.value = query.get("radius");
    if (query.has("polarity")) fields.polarity.value = query.get("polarity");
    render();
  }
})();
