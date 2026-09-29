import { UUID, decodePacket, commandText, csvRows } from './monitor-protocol.js';
const $ = id => document.getElementById(id);
let device, telemetry, control, pending, lastPacket = null, lastAt = 0, lastSequence = null;
let connected = false, connecting = false, generation = 0, session = 0, metadata = {};
let rows = [], history = [], dropped = 0;
const text = (id, value) => { $(id).textContent = value; };
const message = value => text('message', value);
const format = (v, decimals) => v === null ? '—' : v.toLocaleString('es-CO', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });

function setControls() {
  const ready = connected && lastAt && performance.now() - lastAt < 3000;
  const busy = !!pending;
  $('connect').disabled = connected || connecting || !navigator.bluetooth || !window.isSecureContext;
  $('disconnect').disabled = !connected;
  for (const id of ['mode', 'turns']) $(id).disabled = !ready || busy;
  const demo = ready && lastPacket?.mode === 'DEMO';
  for (const id of ['speed', 'apply-speed', 'stop']) $(id).disabled = !demo || busy;
  $('demo-controls').hidden = !!lastPacket && lastPacket.mode !== 'DEMO';
  $('export').disabled = !rows.length; $('clear').disabled = !rows.length;
  $('mode').querySelector('[value="REAL"]').disabled = !(metadata.rpmReady && metadata.inaReady);
  $('mode').querySelector('[value="MIXED"]').disabled = !metadata.rpmReady;
}
function blank(reason) {
  for (const id of ['rpm', 'volts', 'current', 'power']) text(id, '—');
  for (const id of ['rpm-source', 'electric-source', 'current-source', 'power-source']) text(id, 'Sin lectura actual');
  text('mode-label', reason); text('mode-description', 'El historial conserva los datos anteriores; no son lecturas actuales.');
  $('origin').className = 'origin disconnected'; $('dot').className = 'dot';
  text('sensor-status', 'Sin lectura reciente: no se puede afirmar el estado de los sensores.');
}
function disconnected() {
  connected = false; connecting = false; generation++;
  if (pending) { pending.reject(new Error('Bluetooth desconectado')); clearTimeout(pending.timer); pending = null; }
  telemetry?.removeEventListener('characteristicvaluechanged', packetEvent);
  control?.removeEventListener('characteristicvaluechanged', ackEvent);
  telemetry = null; control = null; lastAt = 0; lastSequence = null;
  blank('DESCONECTADO'); text('connection', 'Sin conectar'); setControls(); draw();
}
function packetEvent(event) { receive(event.target.value); }
function receive(value) {
  try {
    const p = decodePacket(value);
    if (p.sequence === lastSequence) return; // lectura inicial y notify pueden coincidir.
    lastSequence = p.sequence; lastPacket = p; lastAt = performance.now();
    text('connection', 'Recibiendo datos'); $('dot').className = 'dot live';
    text('rpm', format(p.rpm, 0)); text('volts', format(p.volts, 3));
    text('current', format(p.current, 2)); text('power', format(p.power, 2));
    text('rpm-source', p.rpmSource === 'MEDIDO' ? 'Medido por pulsos' : p.rpmSource === 'SIMULADO' ? 'Simulado · no mide giro' : 'Sin dato');
    for (const id of ['electric-source', 'current-source', 'power-source']) text(id, p.electricSource === 'MEDIDO' ? 'Medición INA219' : p.electricSource === 'SIMULADO' ? 'Simulado · no experimental' : 'Sin dato');
    const labels = { DEMO: ['DEMOSTRACIÓN · DATOS SIMULADOS', 'Prueba del software. No son resultados experimentales.'], REAL: ['MODO REAL · SENSORES', 'Las lecturas ausentes se muestran como —, nunca se rellenan con simulación.'], MIXED: ['MODO MIXTO', 'RPM medidas por el sensor; tensión, corriente y potencia SIMULADAS.'] };
    text('mode-label', labels[p.mode][0]); text('mode-description', labels[p.mode][1]);
    $('origin').className = 'origin' + (p.mode === 'REAL' ? ' real' : '');
    if (!pending) { $('mode').value = p.mode; $('turns').value = String(p.turns); }
    const states = { OK: 'Lectura recibida.', CONFIG_ERROR: 'Configuración incompleta.', INA_ERROR: 'Error de lectura INA219: revisar conexión.', NO_PULSES: 'Sin pulsos: puede estar parado o existir un fallo del sensor.', RANGE_ERROR: 'INA219 fuera del rango configurado; detener la prueba y revisar.' };
    text('sensor-status', `${states[p.status]} RPM: ${p.rpmReady ? 'configurado, no equivale a validación física' : 'no configurado'}. INA219: ${p.inaReady ? 'inicializado al arrancar' : 'no inicializado'}.`);
    const row = { ...p, time: new Date().toISOString(), session, received: Date.now() };
    rows.push(row); if (rows.length > 7200) { rows.shift(); dropped++; }
    history.push(row); history = history.filter(r => row.received - r.received <= 60000);
    text('sample-count', `${rows.length} muestras`);
    text('log-info', dropped ? `Registro lleno: se descartaron ${dropped} muestras antiguas. Descarga el CSV para conservar las actuales.` : 'Se guardan hasta 7.200 muestras en esta pestaña. Descarga antes de cerrarla.');
    setControls(); draw();
  } catch (error) { message(error.message); }
}

function ackEvent(event) {
  const response = new TextDecoder().decode(event.target.value).replace(/\0+$/, '');
  if (!pending) return;
  if (response === `OK ${pending.command}` || response.startsWith('ERR ')) {
    const task = pending; pending = null; clearTimeout(task.timer);
    response.startsWith('OK ') ? task.resolve() : task.reject(new Error(`La ESP32 rechazó la orden: ${response}`));
    setControls();
  }
}
async function send(kind, value) {
  if (!connected || !control || pending || performance.now() - lastAt >= 3000) throw new Error('Espera a recibir datos de la ESP32.');
  const command = commandText(kind, value);
  let resolve, reject;
  const ack = new Promise((yes, no) => { resolve = yes; reject = no; });
  // Adjuntar manejador desde el inicio: el write puede fallar antes del await del ACK.
  ack.catch(() => {});
  const task = { command, resolve, reject, timer: setTimeout(() => {
    if (pending === task) {
      pending = null; reject(new Error('La ESP32 no confirmó la orden. Reconecta para comprobar su estado.'));
      device?.gatt?.disconnect(); disconnected();
    }
  }, 3000) };
  pending = task; setControls();
  try { await control.writeValueWithResponse(new TextEncoder().encode(command)); await ack; }
  finally { if (pending === task) { clearTimeout(task.timer); pending = null; } setControls(); }
}

async function connect() {
  if (connecting || connected) return;
  connecting = true; const token = ++generation; setControls(); message('Elige «Generador Sara» en el selector Bluetooth.');
  try {
    const selected = await navigator.bluetooth.requestDevice({ filters: [{ services: [UUID.service] }] });
    if (token !== generation) return;
    device?.removeEventListener('gattserverdisconnected', disconnected);
    device = selected; device.addEventListener('gattserverdisconnected', disconnected);
    const server = await device.gatt.connect();
    if (token !== generation) { server.disconnect(); return; }
    const service = await server.getPrimaryService(UUID.service);
    // Firmware antiguo enviaba el búfer entero con '\0' de relleno: se descartan.
    const info = JSON.parse(new TextDecoder().decode(await (await service.getCharacteristic(UUID.info)).readValue()).replace(/\0+$/, ''));
    if (info.protocol !== 1 || info.finalTurns !== 655) throw new Error('Firmware incompatible con este monitor.');
    const nextTelemetry = await service.getCharacteristic(UUID.telemetry);
    const nextControl = await service.getCharacteristic(UUID.control);
    if (token !== generation) return;
    metadata = info; telemetry = nextTelemetry; control = nextControl;
    control.addEventListener('characteristicvaluechanged', ackEvent);
    telemetry.addEventListener('characteristicvaluechanged', packetEvent);
    await control.startNotifications();
    if (token !== generation) return;
    // Activar conexión antes de notify: algunos dispositivos notifican inmediatamente.
    connected = true; connecting = false; session++; lastSequence = null;
    await telemetry.startNotifications();
    if (token !== generation) throw new Error('Conexión cancelada.');
    const initialValue = await telemetry.readValue();
    if (token !== generation) return;
    receive(initialValue);
    text('device', `${device.name || 'Generador Sara'} · firmware ${metadata.firmware}`);
    message('Conectado. En demostración, elige una velocidad y pulsa Aplicar. El motor no se controla desde aquí.');
    setControls();
  } catch (error) {
    if (token !== generation) return;
    device?.gatt?.disconnect(); disconnected();
    message(error.name === 'NotFoundError' ? 'No se seleccionó ninguna placa. Comprueba USB, Bluetooth y que el firmware esté cargado.' : `No se pudo conectar: ${error.message}`);
  }
}

$('connect').addEventListener('click', connect);
$('disconnect').addEventListener('click', () => { device?.gatt?.disconnect(); disconnected(); message('Conexión cerrada. El registro sigue disponible para descargar.'); });
$('speed').addEventListener('input', () => text('speed-value', `${$('speed').value} RPM`));
async function runCommand(kind, value) {
  try { await send(kind, value); message('Orden confirmada por la ESP32. Esperando la próxima lectura.'); }
  catch (error) { message(error.message); }
  finally { if (lastPacket) { $('mode').value = lastPacket.mode; $('turns').value = String(lastPacket.turns); } }
}
$('apply-speed').addEventListener('click', () => runCommand('SPEED', $('speed').value));
$('stop').addEventListener('click', () => { $('speed').value = '0'; text('speed-value', '0 RPM'); runCommand('SPEED', 0); });
$('mode').addEventListener('change', () => runCommand('MODE', $('mode').value));
$('turns').addEventListener('change', () => runCommand('TURNS', $('turns').value));
$('export').addEventListener('click', () => {
  const url = URL.createObjectURL(new Blob(['\ufeff', csvRows(rows)], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a'); a.href = url; a.download = `sara-${new Date().toISOString().replace(/[:.]/g, '-')}.csv`;
  a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
});
$('clear').addEventListener('click', () => {
  if (!confirm('¿Borrar las muestras de esta pestaña? Descarga primero el CSV si quieres conservarlas.')) return;
  rows = []; history = []; dropped = 0; text('sample-count', '0 muestras'); text('log-info', 'Registro vacío.'); setControls(); draw();
});

function draw() {
  const canvas = $('chart'), box = canvas.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(box.width * dpr); canvas.height = Math.round(box.height * dpr);
  const ctx = canvas.getContext('2d'); ctx.scale(dpr, dpr);
  const w = box.width, h = box.height, now = Date.now();
  const plots = [{ key: 'rpm', label: 'RPM', color: '#69dfce' }, { key: 'volts', label: 'VOLTIOS', color: '#ffc66c' }];
  ctx.font = '11px system-ui';
  plots.forEach((p, index) => {
    const top = index * h / 2 + 22, bottom = (index + 1) * h / 2 - 20, left = 44, right = w - 10;
    const visible = history.filter(r => now - r.received <= 60000);
    const max = Math.max(1, ...visible.map(r => Math.abs(r[p.key] ?? 0))) * 1.1;
    ctx.fillStyle = p.color; ctx.fillText(`${p.label} · escala ±${max.toFixed(1)}`, left, top - 9);
    ctx.strokeStyle = '#2b425b'; ctx.beginPath(); ctx.moveTo(left, bottom); ctx.lineTo(right, bottom); ctx.stroke();
    ctx.fillStyle = '#b1c3d7'; ctx.fillText('0', 20, (top + bottom) / 2 + 4);
    ctx.strokeStyle = '#344e65'; ctx.beginPath(); ctx.moveTo(left, (top + bottom) / 2); ctx.lineTo(right, (top + bottom) / 2); ctx.stroke();
    ctx.strokeStyle = p.color; ctx.lineWidth = 2; ctx.beginPath(); let previous = null;
    for (const r of visible) {
      if (r[p.key] === null) { previous = null; continue; }
      const x = left + (1 - (now - r.received) / 60000) * (right - left);
      const y = (top + bottom) / 2 - r[p.key] / max * (bottom - top) / 2;
      if (!previous || r.received - previous.received > 2000 || r.session !== previous.session || r.mode !== previous.mode || r.turns !== previous.turns) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      previous = r;
    }
    ctx.stroke(); ctx.fillStyle = '#b1c3d7'; ctx.fillText('−60 s', left, bottom + 15); ctx.fillText('ahora', Math.max(left, right - 34), bottom + 15);
  });
}
window.addEventListener('resize', draw);
setInterval(() => {
  if (connected && lastAt && performance.now() - lastAt >= 3000) { blank('SIN DATOS RECIENTES'); text('connection', 'Conectado, sin datos'); }
  setControls(); draw();
}, 1000);
if (!window.isSecureContext) message('Bluetooth requiere HTTPS. Desde Android usa la URL publicada; http://IP-del-PC no sirve. En el propio PC puedes usar localhost.');
else if (!navigator.bluetooth) message('Este navegador no ofrece Web Bluetooth. Usa Chrome en Android o Chrome/Edge compatible en el ordenador.');
setControls(); draw();
