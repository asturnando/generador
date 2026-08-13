(() => {
  "use strict";

  const calculator = document.querySelector("[data-rpm-calculator]");
  if (!calculator) return;

  const pulsesInput = calculator.querySelector("[data-rpm-pulses]");
  const secondsInput = calculator.querySelector("[data-rpm-seconds]");
  const pprInput = calculator.querySelector("[data-rpm-ppr]");
  const output = calculator.querySelector("[data-rpm-output]");

  function update() {
    const pulses = Number(pulsesInput.value);
    const seconds = Number(secondsInput.value);
    const ppr = Number(pprInput.value);
    const valid = Number.isFinite(pulses) && pulses >= 0 && Number.isFinite(seconds) && seconds > 0 && Number.isInteger(ppr) && ppr > 0;

    if (!valid) {
      output.textContent = "Introduce tres valores válidos.";
      return;
    }

    const rpm = (pulses * 60) / (seconds * ppr);
    output.textContent = `${rpm.toFixed(1)} RPM`;
  }

  calculator.addEventListener("input", update);
})();
