import { parseSerialLine, commandText, hex } from './monitor-protocol.js?v=5';
// =============================================================================
// consola.js · Lógica de la Consola USB (consola.html)
// =============================================================================
//
// Qué hace:
//   - Abre el puerto serie USB de la ESP32 desde el navegador (Web Serial,
//     solo Chrome/Edge de ordenador), a 115200 baudios.
//   - Lee las líneas que escribe el firmware 1.1.1: "DIAG ..." (estado de los
//     sensores) y "LECTURA ..." (RPM, voltios, modo), y las muestra en grande.
//   - Envía por el mismo cable las órdenes de siempre ("PPR:2", "SRC:IR"...),
//     que la placa contesta con "OK ..." o "ERR ...".
//
// Sirve para comprobar el montaje desde un ordenador (también por AnyDesk)
// sin depender del móvil. El Bluetooth sigue funcionando a la vez.
//
// La línea "import" de arriba debe seguir siendo la primera: las pruebas
// automáticas la quitan para ejecutar este archivo en Node.
// =============================================================================

// ---- Estado y utilidades ----
const $ = id => document.getElementById(id);
const text = (id, value) => { $(id).textContent = value; };
const message = value => text('message', value);
const format = (v, decimals) => v === null || v === undefined ? '—' : v.toLocaleString('es-CO', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
const MODES = ['DEMO', 'REAL', 'MIXED'];
const MODE_NAMES = { DEMO: 'Demostración', REAL: 'Real', MIXED: 'Mixto' };
const STATUS_NAMES = ['lectura correcta', 'configuración incompleta', 'error del INA219', 'sin pulsos', 'fuera de rango'];

//   port     → el puerto serie abierto (o null).
//   reader   → lector del texto que llega; readDone, la tubería que lo alimenta.
//   buffer   → trozo de línea que aún no ha terminado (sin Enter).
//   lastLineAt / lastDiagAt → cuándo llegó la última línea y el último DIAG.
//   oldFirmware → true si llegan lecturas con el formato de firmware anterior.
//   counts   → últimos contadores vistos, para iluminar la tarjeta al subir.
let port = null, reader = null, readDone = null, buffer = '';
let lastLineAt = 0, lastDiagAt = 0, oldFirmware = false;
const counts = { ir: null, hall: null };
const logLines = [];

// Activa o desactiva los botones según haya o no un puerto abierto.
function setControls() {
  const open = !!port;
  $('connect').disabled = open || !('serial' in navigator);
  for (const id of ['disconnect', 'reset', 'zero', 'sensor', 'ppr', 'save-ppr', 'mode', 'scan', 'command', 'send']) $(id).disabled = !open;
}

// Añade una línea al registro de mensajes (se guardan las 150 últimas).
function addLog(line) {
  logLines.push(line); if (logLines.length > 150) logLines.shift();
  const log = $('log'); log.textContent = logLines.join('\n');
  log.scrollTop = log.scrollHeight;  // Siempre se ve la más reciente.
}

// ---- Conexión ----

// Pide al navegador que elija un puerto, lo abre y empieza a leer.
async function connect() {
  try {
    const selected = await navigator.serial.requestPort();
    await selected.open({ baudRate: 115200 });
    // En estas placas, las líneas DTR y RTS del USB controlan los botones RST
    // y BOOT. Se dejan las dos en reposo para que la placa siga funcionando.
    await selected.setSignals({ dataTerminalReady: false, requestToSend: false });
    port = selected; buffer = ''; lastLineAt = performance.now(); lastDiagAt = 0; oldFirmware = false;
    text('connection', 'Conectado por USB'); $('dot').className = 'dot live';
    message('Conectado. Esperando datos de la placa...');
    setControls();
    readLoop(selected);
  } catch (error) {
    message(error.name === 'NotFoundError' ? 'No se eligió ningún puerto.'
      : `No se pudo abrir el puerto: ${error.message}. Cierra el instalador u otros programas que lo estén usando.`);
  }
}

// Lee el texto que llega por el puerto hasta que se cierre o se desenchufe.
async function readLoop(selected) {
  // TextDecoderStream convierte los bytes en texto (UTF-8) a medida que llegan.
  const decoder = new TextDecoderStream();
  readDone = selected.readable.pipeTo(decoder.writable).catch(() => {});
  reader = decoder.readable.getReader();
  try {
    for (;;) { const { value, done } = await reader.read(); if (done) break; receive(value); }
  } catch (error) {
    message(`Se perdió la conexión USB: ${error.message}`);
  } finally {
    reader.releaseLock(); reader = null;
  }
  // Si el puerto se cerró solo (cable desenchufado), se deja todo limpio.
  if (port === selected) await disconnect();
}

// Cierra el puerto con orden: primero el lector, luego la tubería y el puerto.
async function disconnect() {
  const closing = port; port = null;
  try { await reader?.cancel(); } catch { /* ya estaba cerrado */ }
  try { await readDone; } catch { /* ya estaba cerrado */ }
  try { await closing?.close(); } catch { /* ya estaba cerrado */ }
  text('connection', 'Sin conectar'); $('dot').className = 'dot';
  setControls();
}

// Reinicia la placa como el botón RST: RTS activo un momento (pone RST a 0)
// y después las dos líneas en reposo. Al arrancar, los contadores vuelven a 0.
async function resetBoard() {
  if (!port) return;
  try {
    await port.setSignals({ dataTerminalReady: false, requestToSend: true });
    await new Promise(resolve => setTimeout(resolve, 120));
    await port.setSignals({ dataTerminalReady: false, requestToSend: false });
    message('Reiniciando la placa...');
  } catch (error) { message(`No se pudo reiniciar: ${error.message}`); }
}

// ---- Texto recibido ----

// Junta los trozos que llegan y procesa cada línea completa (terminada en Enter).
function receive(chunk) {
  buffer += chunk;
  const lines = buffer.split(/\r?\n/);
  buffer = lines.pop();                       // El último trozo puede estar a medias.
  if (buffer.length > 2000) buffer = '';      // Protección ante basura sin Enter.
  for (const line of lines) handleLine(line);
}

// Procesa una línea: diagnóstico, lectura, respuesta a una orden u otro mensaje.
function handleLine(line) {
  if (!line.trim()) return;
  lastLineAt = performance.now();
  const data = parseSerialLine(line);
  if (data?.type === 'DIAG') { lastDiagAt = lastLineAt; renderDiag(data); }
  else if (data?.type === 'LECTURA') renderReading(data);
  else if (/^OK /.test(line)) message(`La placa confirmó la orden ${line.slice(3)}.`);
  else if (/^ERR /.test(line)) message(`La placa rechazó la orden: ${line}`);
  else if (/^mode=/.test(line) && !oldFirmware) {
    // Formato de las versiones 1.0.x y 1.1.0: no envían el diagnóstico por USB.
    oldFirmware = true;
    message('Esta placa tiene un firmware anterior a 1.1.1 y no envía los sensores por USB. Instala la última versión con el instalador.');
  }
  // Las líneas periódicas se pueden ocultar para que el registro se lea mejor.
  if (!(data && $('quiet').checked)) addLog(line);
}

// Ilumina un momento la tarjeta de un sensor cuando su contador sube.
function flash(id) {
  const card = $(id); card.className = 'sensor flash';
  setTimeout(() => { card.className = 'sensor'; }, 300);
}

// Muestra un diagnóstico (línea "DIAG ...").
function renderDiag(d) {
  // ---- Sensores de RPM: contador y nivel actual ----
  for (const [key, what, card] of [['ir', 'marca', 'ir-card'], ['hall', 'imán', 'hall-card']]) {
    const count = d[key];
    if (typeof count !== 'number') continue;
    if (counts[key] !== null && count > counts[key]) flash(card);
    counts[key] = count;
    text(`${key}-count`, count.toLocaleString('es-CO'));
    const low = d[`${key}_bajo`] === 1;
    text(`${key}-level`, low ? `Salida a 0 V: detectando ${what} (su LED suele encenderse).` : 'Salida a 3,3 V: en reposo.');
    $(`${key}-dot`).className = 'dot' + (low ? ' live' : '');
  }
  // ---- INA219: la causa más probable según lo que comprobó la placa ----
  let inaText, inaDot;
  if (d.ina) { inaText = `Encontrado en ${hex(d.ina)} y calibrado (16 V / 400 mA).`; inaDot = 'live'; }
  else if (d.bloqueo) { inaText = 'No encontrado: SDA o SCL están a 0 V. Revisa que ninguno vaya a GND.'; inaDot = 'bad'; }
  else if (!d.sda || !d.scl) {
    const missing = !d.sda && !d.scl ? 'Ni SDA (GPIO 8) ni SCL (GPIO 9) llegan' : !d.sda ? 'SDA (GPIO 8) no llega' : 'SCL (GPIO 9) no llega';
    inaText = `No encontrado: ${missing} al módulo. Revisa ese cable y que VCC vaya a 3V3 y GND a GND.`; inaDot = 'bad';
  } else { inaText = 'No encontrado, aunque SDA y SCL llegan al módulo. Comprueba que no estén intercambiados.'; inaDot = 'warn'; }
  text('ina-status', inaText); $('ina-dot').className = `dot ${inaDot}`;
  text('i2c-detail', d.i2c ? `${d.i2c} dispositivo(s) responden en I2C.` : 'Ningún dispositivo responde en SDA = GPIO 8 · SCL = GPIO 9.');
  // ---- Ajustes actuales (salvo mientras se están editando) ----
  if (document.activeElement !== $('sensor') && (d.sensor === 'IR' || d.sensor === 'HALL')) $('sensor').value = d.sensor;
  if (document.activeElement !== $('ppr') && typeof d.ppr === 'number') $('ppr').value = String(d.ppr);
}

// Muestra una lectura periódica (línea "LECTURA ...").
function renderReading(l) {
  const mode = MODES[l.mode] ?? '?';
  text('rpm-now', format(l.rpm, 0));
  const electric = l.V === null ? 'sin tensión medida' : `${format(l.V, 3)} V · ${format(l.mA, 2)} mA`;
  const origin = mode === 'DEMO' ? 'RPM simuladas' : `RPM del sensor ${l.src === 'IR' ? 'infrarrojo' : 'Hall'}${l.ppr ? `, ${l.ppr} pulso(s) por vuelta` : ' (sin PPR configurado)'}`;
  text('reading-detail', `${MODE_NAMES[mode] ?? mode} · ${origin} · ${electric} · ${STATUS_NAMES[l.status] ?? 'estado desconocido'}.`);
  $('reading-dot').className = 'dot' + (l.status === 0 ? ' live' : ' warn');
  if (document.activeElement !== $('mode') && MODES.includes(mode)) $('mode').value = mode;
}

// ---- Órdenes ----

// Envía una orden por el USB, terminada en Enter.
async function send(command) {
  if (!port?.writable) { message('Conecta antes la placa por USB.'); return; }
  const writer = port.writable.getWriter();
  try { await writer.write(new TextEncoder().encode(command + '\n')); message(`Enviada la orden ${command}. Esperando respuesta...`); }
  catch (error) { message(`No se pudo enviar: ${error.message}`); }
  finally { writer.releaseLock(); }
}

// Comprueba la orden con las mismas reglas que el monitor antes de enviarla.
function sendChecked(kind, value, help) {
  let command;
  try { command = commandText(kind, value); } catch { message(help || 'Orden no válida.'); return; }
  send(command);
}

// ---- Botones ----
$('connect').addEventListener('click', connect);
$('disconnect').addEventListener('click', () => { disconnect(); message('Puerto cerrado.'); });
$('reset').addEventListener('click', resetBoard);
$('zero').addEventListener('click', () => sendChecked('RESET', 'PULSES'));
$('sensor').addEventListener('change', () => sendChecked('SRC', $('sensor').value));
$('save-ppr').addEventListener('click', () => sendChecked('PPR', $('ppr').value, 'Pulsos por vuelta: escribe un número entero de 0 a 64.'));
$('mode').addEventListener('change', () => sendChecked('MODE', $('mode').value));
$('scan').addEventListener('click', () => sendChecked('SCAN'));
// Orden manual: en mayúsculas, sin espacios a los lados, hasta 20 caracteres.
$('send').addEventListener('click', () => {
  const command = $('command').value.trim().toUpperCase();
  if (!/^[\x20-\x7e]{1,20}$/.test(command)) { message('Escribe una orden de 1 a 20 caracteres, por ejemplo SPEED:300.'); return; }
  send(command); $('command').value = '';
});

// ---- Comprobación periódica ----
// Si hay puerto abierto pero no llega nada en 4 s, se avisa. Si llegan
// lecturas pero ningún diagnóstico, es un firmware antiguo.
setInterval(() => {
  if (!port) return;
  const now = performance.now();
  if (now - lastLineAt > 4000) message('No llegan datos de la placa. Pulsa «Reiniciar placa» o desenchufa y vuelve a enchufar el USB.');
  else if (!lastDiagAt && oldFirmware) message('Esta placa tiene un firmware anterior a 1.1.1 y no envía los sensores por USB. Instala la última versión con el instalador.');
}, 1000);

// Al abrir la página: Web Serial solo existe en Chrome/Edge de ordenador.
if (!('serial' in navigator)) message('Este navegador no puede usar el USB. Abre esta página en Chrome o Edge en un ordenador (no en el móvil).');
setControls();
