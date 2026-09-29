import { UUID, decodePacket, commandText, csvRows } from './monitor-protocol.js';
// =============================================================================
// monitor.js · Lógica de la página del monitor (monitor.html)
// =============================================================================
//
// Qué hace:
//   - Conecta el navegador con la ESP32 por Bluetooth (Web Bluetooth).
//   - Muestra cada lectura que llega (RPM, tensión, corriente, potencia) y de
//     dónde sale: medida o simulada.
//   - Envía las órdenes del usuario (modo, vueltas, velocidad simulada) y
//     espera a que la placa las confirme.
//   - Dibuja la gráfica de los últimos 60 segundos y guarda un registro que
//     se puede descargar como CSV.
//
// Principio de seguridad de toda la página: nunca mostrar como actual un dato
// que no lo es. Si se pierde la conexión o dejan de llegar lecturas durante
// 3 segundos, las cifras se sustituyen por "—".
//
// Organización:
//   1. Estado y utilidades.
//   2. Pantalla: botones, lecturas y desconexión.
//   3. Órdenes a la placa.
//   4. Conexión Bluetooth.
//   5. Botones de la página.
//   6. Gráfica.
//   7. Comprobaciones periódicas y de arranque.
//
// La línea "import" de arriba trae las funciones de monitor-protocol.js.
// (Debe seguir siendo la primera línea: las pruebas automáticas la quitan
// para poder ejecutar este archivo en Node.)
// =============================================================================

// =============================================================================
// 1. Estado y utilidades
// =============================================================================

// Atajo: $('rpm') equivale a document.getElementById('rpm'), es decir, el
// elemento de monitor.html con id="rpm".
const $ = id => document.getElementById(id);

// Estado de la conexión:
//   device       → la placa elegida en el selector Bluetooth.
//   telemetry    → característica de lecturas de la placa.
//   control      → característica de órdenes de la placa.
//   pending      → orden enviada que todavía espera confirmación (o nada).
//   lastPacket   → última lectura recibida, ya traducida.
//   lastAt       → momento en que llegó (en ms, según performance.now()).
//   lastSequence → número de secuencia de esa lectura, para no repetirla.
let device, telemetry, control, pending, lastPacket = null, lastAt = 0, lastSequence = null;
//   connected / connecting → si ya hay conexión o se está intentando.
//   generation   → contador que sube en cada conexión o desconexión. Conectar
//                  lleva varios pasos con esperas; si mientras tanto el
//                  usuario se desconecta, el número ya no coincide y el
//                  intento antiguo se abandona en vez de pisar el estado nuevo.
//   session      → cuántas conexiones van en esta pestaña; se guarda en el
//                  CSV para distinguir ensayos.
//   metadata     → el JSON de información que envía la placa al conectar.
let connected = false, connecting = false, generation = 0, session = 0, metadata = {};
//   rows    → registro completo para el CSV (máximo 7200 lecturas ≈ 1 hora).
//   history → solo las lecturas de los últimos 60 s, para la gráfica.
//   dropped → lecturas antiguas descartadas por llenarse el registro.
let rows = [], history = [], dropped = 0;

// Escribe un texto en un elemento de la página.
const text = (id, value) => { $(id).textContent = value; };
// Escribe en la línea de mensajes, debajo de los botones de conexión.
const message = value => text('message', value);
// Convierte los bytes recibidos por Bluetooth en texto.
// El firmware 1.0.0 enviaba el búfer C entero: texto, '\0' y basura de memoria. Se corta en el primer '\0'.
const bleText = value => new TextDecoder().decode(value).split('\0')[0];
// Da formato a un número con los decimales indicados, al estilo de Colombia
// ('es-CO': coma decimal y punto de miles). null (sin dato) se muestra "—".
const format = (v, decimals) => v === null ? '—' : v.toLocaleString('es-CO', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });

// =============================================================================
// 2. Pantalla
// =============================================================================

// Activa o desactiva cada botón y desplegable según el estado actual. Se
// llama tras cualquier cambio (y además una vez por segundo).
function setControls() {
  // "ready": hay conexión y ha llegado una lectura hace menos de 3 s.
  const ready = connected && lastAt && performance.now() - lastAt < 3000;
  // "busy": hay una orden esperando confirmación; no se admite otra.
  const busy = !!pending;
  // Conectar: solo si no hay conexión, no se está conectando y el navegador
  // tiene Bluetooth y la página va por HTTPS.
  $('connect').disabled = connected || connecting || !navigator.bluetooth || !window.isSecureContext;
  $('disconnect').disabled = !connected;
  // Modo y vueltas: solo con datos recientes y sin órdenes pendientes.
  for (const id of ['mode', 'turns']) $(id).disabled = !ready || busy;
  // Controles de velocidad simulada: solo en modo DEMO.
  const demo = ready && lastPacket?.mode === 'DEMO';
  for (const id of ['speed', 'apply-speed', 'stop']) $(id).disabled = !demo || busy;
  // Fuera de DEMO, el bloque de velocidad simulada se oculta del todo.
  $('demo-controls').hidden = !!lastPacket && lastPacket.mode !== 'DEMO';
  // Descargar y borrar el registro: solo si hay algo guardado.
  $('export').disabled = !rows.length; $('clear').disabled = !rows.length;
  // Las opciones REAL y MIXTO del desplegable solo se habilitan si la placa
  // dijo al conectar que tiene los sensores necesarios.
  $('mode').querySelector('[value="REAL"]').disabled = !(metadata.rpmReady && metadata.inaReady);
  $('mode').querySelector('[value="MIXED"]').disabled = !metadata.rpmReady;
}

// Borra las lecturas de la pantalla (las sustituye por "—") y muestra el
// motivo ("DESCONECTADO", "SIN DATOS RECIENTES"). El registro no se toca.
function blank(reason) {
  for (const id of ['rpm', 'volts', 'current', 'power']) text(id, '—');
  for (const id of ['rpm-source', 'electric-source', 'current-source', 'power-source']) text(id, 'Sin lectura actual');
  text('mode-label', reason); text('mode-description', 'El historial conserva los datos anteriores; no son lecturas actuales.');
  $('origin').className = 'origin disconnected'; $('dot').className = 'dot';
  text('sensor-status', 'Sin lectura reciente: no se puede afirmar el estado de los sensores.');
}

// Se ejecuta al perder la conexión (por el botón, por error o porque la placa
// se apaga). Deja todo como al principio, salvo el registro.
function disconnected() {
  // Sube "generation" para anular cualquier intento de conexión a medias.
  connected = false; connecting = false; generation++;
  // Si una orden esperaba confirmación, se da por fallida.
  if (pending) { pending.reject(new Error('Bluetooth desconectado')); clearTimeout(pending.timer); pending = null; }
  // Deja de escuchar los avisos de las características antiguas.
  telemetry?.removeEventListener('characteristicvaluechanged', packetEvent);
  control?.removeEventListener('characteristicvaluechanged', ackEvent);
  telemetry = null; control = null; lastAt = 0; lastSequence = null;
  blank('DESCONECTADO'); text('connection', 'Sin conectar'); setControls(); draw();
}

// El navegador llama a esta función cada vez que llega una lectura nueva.
function packetEvent(event) { receive(event.target.value); }

// Procesa una lectura: la traduce, la muestra, la guarda y actualiza la gráfica.
function receive(value) {
  try {
    const p = decodePacket(value);  // Lanza un error si el paquete no es válido.
    if (p.sequence === lastSequence) return; // lectura inicial y notify pueden coincidir.
    lastSequence = p.sequence; lastPacket = p; lastAt = performance.now();
    text('connection', 'Recibiendo datos'); $('dot').className = 'dot live';
    // Cifras principales, con 0, 3, 2 y 2 decimales.
    text('rpm', format(p.rpm, 0)); text('volts', format(p.volts, 3));
    text('current', format(p.current, 2)); text('power', format(p.power, 2));
    // Debajo de cada cifra, de dónde sale.
    text('rpm-source', p.rpmSource === 'MEDIDO' ? 'Medido por pulsos' : p.rpmSource === 'SIMULADO' ? 'Simulado · no mide giro' : 'Sin dato');
    for (const id of ['electric-source', 'current-source', 'power-source']) text(id, p.electricSource === 'MEDIDO' ? 'Medición INA219' : p.electricSource === 'SIMULADO' ? 'Simulado · no experimental' : 'Sin dato');
    // Rótulo del modo: título y explicación para cada uno.
    const labels = { DEMO: ['DEMOSTRACIÓN · DATOS SIMULADOS', 'Prueba del software. No son resultados experimentales.'], REAL: ['MODO REAL · SENSORES', 'Las lecturas ausentes se muestran como —, nunca se rellenan con simulación.'], MIXED: ['MODO MIXTO', 'RPM medidas por el sensor; tensión, corriente y potencia SIMULADAS.'] };
    text('mode-label', labels[p.mode][0]); text('mode-description', labels[p.mode][1]);
    // El recuadro cambia de color en modo REAL (clase CSS "real").
    $('origin').className = 'origin' + (p.mode === 'REAL' ? ' real' : '');
    // Los desplegables muestran lo que dice la placa, no lo que se eligió en
    // pantalla (salvo mientras se espera la confirmación de un cambio).
    if (!pending) { $('mode').value = p.mode; $('turns').value = String(p.turns); }
    // Texto del estado de los sensores.
    const states = { OK: 'Lectura recibida.', CONFIG_ERROR: 'Configuración incompleta.', INA_ERROR: 'Error de lectura INA219: revisar conexión.', NO_PULSES: 'Sin pulsos: puede estar parado o existir un fallo del sensor.', RANGE_ERROR: 'INA219 fuera del rango configurado; detener la prueba y revisar.' };
    text('sensor-status', `${states[p.status]} RPM: ${p.rpmReady ? 'configurado, no equivale a validación física' : 'no configurado'}. INA219: ${p.inaReady ? 'inicializado al arrancar' : 'no inicializado'}.`);
    // Guarda la lectura con la hora (UTC, formato ISO) y el número de sesión.
    // "received" es la hora en ms, para calcular edades en la gráfica.
    const row = { ...p, time: new Date().toISOString(), session, received: Date.now() };
    // Registro para el CSV: si pasa de 7200, se descarta la más antigua.
    rows.push(row); if (rows.length > 7200) { rows.shift(); dropped++; }
    // Historial de la gráfica: solo las lecturas de los últimos 60 s.
    history.push(row); history = history.filter(r => row.received - r.received <= 60000);
    text('sample-count', `${rows.length} muestras`);
    text('log-info', dropped ? `Registro lleno: se descartaron ${dropped} muestras antiguas. Descarga el CSV para conservar las actuales.` : 'Se guardan hasta 7.200 muestras en esta pestaña. Descarga antes de cerrarla.');
    setControls(); draw();
  } catch (error) { message(error.message); }  // Paquete no válido: se avisa y se ignora.
}

// =============================================================================
// 3. Órdenes a la placa
// =============================================================================

// El navegador llama a esta función cuando la placa responde a una orden
// ("OK MODE:DEMO", "ERR NOT_DEMO"...).
function ackEvent(event) {
  const response = bleText(event.target.value);
  if (!pending) return;  // Nadie esperaba respuesta: se ignora.
  // Solo cuenta si es la confirmación de ESTA orden, o un error.
  if (response === `OK ${pending.command}` || response.startsWith('ERR ')) {
    const task = pending; pending = null; clearTimeout(task.timer);
    // "OK": la orden se cumplió. "ERR": se rechazó, y se explica el motivo.
    response.startsWith('OK ') ? task.resolve() : task.reject(new Error(`La ESP32 rechazó la orden: ${response}`));
    setControls();
  }
}

// Envía una orden a la placa y espera su confirmación.
// "async" permite usar "await": esperar a que termine algo lento (como una
// comunicación Bluetooth) sin congelar la página.
// Termina bien si la placa responde "OK"; lanza un error si la rechaza, si
// falla el envío o si no responde en 3 segundos.
async function send(kind, value) {
  // Solo con conexión, sin otra orden pendiente y con datos recientes.
  if (!connected || !control || pending || performance.now() - lastAt >= 3000) throw new Error('Espera a recibir datos de la ESP32.');
  const command = commandText(kind, value);  // Ej.: 'SPEED:300'. Lanza error si no es válida.
  // Una "promesa" representa un resultado que llegará más tarde. Se guardan
  // sus funciones resolve (éxito) y reject (fallo) para que ackEvent() pueda
  // completarla cuando llegue la respuesta.
  let resolve, reject;
  const ack = new Promise((yes, no) => { resolve = yes; reject = no; });
  // Adjuntar manejador desde el inicio: el write puede fallar antes del await del ACK.
  // (Si la promesa fallara sin nadie escuchándola, el navegador daría un
  // aviso de "error no gestionado". Este manejador vacío lo evita.)
  ack.catch(() => {});
  const task = { command, resolve, reject, timer: setTimeout(() => {
    // Si a los 3 s la placa no ha contestado, no se sabe si aplicó la orden.
    // Para no mostrar un estado dudoso, se corta la conexión y se pide
    // reconectar.
    if (pending === task) {
      pending = null; reject(new Error('La ESP32 no confirmó la orden. Reconecta para comprobar su estado.'));
      device?.gatt?.disconnect(); disconnected();
    }
  }, 3000) };
  pending = task; setControls();  // Bloquea los controles mientras espera.
  // Envía el texto como bytes y espera la confirmación. "finally" se ejecuta
  // siempre, haya ido bien o mal, y deja todo listo para la siguiente orden.
  try { await control.writeValueWithResponse(new TextEncoder().encode(command)); await ack; }
  finally { if (pending === task) { clearTimeout(task.timer); pending = null; } setControls(); }
}

// =============================================================================
// 4. Conexión Bluetooth
// =============================================================================
// Pasos: elegir placa → conectar → leer información → comprobar que sea
// compatible → suscribirse a respuestas y lecturas → leer la primera lectura.
// Tras cada espera ("await") se comprueba "token !== generation": si mientras
// tanto hubo una desconexión, este intento se abandona.
async function connect() {
  if (connecting || connected) return;
  connecting = true; const token = ++generation; setControls(); message('Elige «Generador Sara» en el selector Bluetooth.');
  try {
    // Abre el selector del navegador, que solo muestra placas que anuncian
    // nuestro servicio.
    const selected = await navigator.bluetooth.requestDevice({ filters: [{ services: [UUID.service] }] });
    if (token !== generation) return;
    // Si ya había una placa de antes, deja de vigilarla; vigila la nueva por
    // si se desconecta.
    device?.removeEventListener('gattserverdisconnected', disconnected);
    device = selected; device.addEventListener('gattserverdisconnected', disconnected);
    const server = await device.gatt.connect();  // Conexión Bluetooth propiamente dicha.
    if (token !== generation) { server.disconnect(); return; }
    const service = await server.getPrimaryService(UUID.service);
    // Lee el JSON de información y comprueba que sea el protocolo 1 y la
    // bobina de 655 vueltas. Si no, la placa lleva otro firmware.
    const info = JSON.parse(bleText(await (await service.getCharacteristic(UUID.info)).readValue()));
    if (info.protocol !== 1 || info.finalTurns !== 655) throw new Error('Firmware incompatible con este monitor.');
    const nextTelemetry = await service.getCharacteristic(UUID.telemetry);
    const nextControl = await service.getCharacteristic(UUID.control);
    if (token !== generation) return;
    metadata = info; telemetry = nextTelemetry; control = nextControl;
    // Indica qué función se ejecuta cuando cambia cada característica.
    control.addEventListener('characteristicvaluechanged', ackEvent);
    telemetry.addEventListener('characteristicvaluechanged', packetEvent);
    // Pide a la placa que avise de sus respuestas a órdenes.
    await control.startNotifications();
    if (token !== generation) return;
    // Activar conexión antes de notify: algunos dispositivos notifican inmediatamente.
    connected = true; connecting = false; session++; lastSequence = null;
    // Pide a la placa que avise de cada lectura nueva.
    await telemetry.startNotifications();
    if (token !== generation) throw new Error('Conexión cancelada.');
    // Lee la lectura actual para no esperar al siguiente aviso.
    const initialValue = await telemetry.readValue();
    if (token !== generation) return;
    receive(initialValue);
    text('device', `${device.name || 'Generador Sara'} · firmware ${metadata.firmware}`);
    message('Conectado. En demostración, elige una velocidad y pulsa Aplicar. El motor no se controla desde aquí.');
    setControls();
  } catch (error) {
    // Cualquier fallo: si el intento sigue vigente, se desconecta y se explica.
    // "NotFoundError" = el usuario cerró el selector sin elegir placa.
    if (token !== generation) return;
    device?.gatt?.disconnect(); disconnected();
    message(error.name === 'NotFoundError' ? 'No se seleccionó ninguna placa. Comprueba USB, Bluetooth y que el firmware esté cargado.' : `No se pudo conectar: ${error.message}`);
  }
}

// =============================================================================
// 5. Botones de la página
// =============================================================================
// addEventListener('click', f) = "cuando se pulse este botón, ejecuta f".

$('connect').addEventListener('click', connect);
$('disconnect').addEventListener('click', () => { device?.gatt?.disconnect(); disconnected(); message('Conexión cerrada. El registro sigue disponible para descargar.'); });
// Al mover el deslizador, actualiza la cifra que hay a su lado (no envía nada).
$('speed').addEventListener('input', () => text('speed-value', `${$('speed').value} RPM`));

// Envía una orden y muestra el resultado. Pase lo que pase, los desplegables
// vuelven a mostrar lo que dice la última lectura de la placa.
async function runCommand(kind, value) {
  try { await send(kind, value); message('Orden confirmada por la ESP32. Esperando la próxima lectura.'); }
  catch (error) { message(error.message); }
  finally { if (lastPacket) { $('mode').value = lastPacket.mode; $('turns').value = String(lastPacket.turns); } }
}
$('apply-speed').addEventListener('click', () => runCommand('SPEED', $('speed').value));
// "Poner simulación a cero": deslizador a 0 y orden SPEED:0.
$('stop').addEventListener('click', () => { $('speed').value = '0'; text('speed-value', '0 RPM'); runCommand('SPEED', 0); });
$('mode').addEventListener('change', () => runCommand('MODE', $('mode').value));
$('turns').addEventListener('change', () => runCommand('TURNS', $('turns').value));

// Descargar CSV: crea un archivo temporal en memoria y simula un clic en un
// enlace de descarga. El nombre lleva la fecha y la hora, p. ej.
// sara-2026-09-29T14-05-00-000Z.csv.
$('export').addEventListener('click', () => {
  // '\ufeff' es una marca invisible que indica a Excel que el texto está en
  // UTF-8, para que muestre bien las tildes.
  const url = URL.createObjectURL(new Blob(['\ufeff', csvRows(rows)], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a'); a.href = url; a.download = `sara-${new Date().toISOString().replace(/[:.]/g, '-')}.csv`;
  // Pasado un segundo, libera la memoria del archivo temporal.
  a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
});
// Borrar registro, con confirmación previa.
$('clear').addEventListener('click', () => {
  if (!confirm('¿Borrar las muestras de esta pestaña? Descarga primero el CSV si quieres conservarlas.')) return;
  rows = []; history = []; dropped = 0; text('sample-count', '0 muestras'); text('log-info', 'Registro vacío.'); setControls(); draw();
});

// =============================================================================
// 6. Gráfica
// =============================================================================
// Dibuja en el <canvas> dos gráficas, una encima de otra: RPM arriba y
// voltios abajo. El eje horizontal va de hace 60 s (izquierda) a ahora
// (derecha). La escala se ajusta sola al valor más alto visible.
function draw() {
  const canvas = $('chart'), box = canvas.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
  // En pantallas de alta densidad (móviles), cada punto CSS son varios
  // píxeles reales; se multiplica por "dpr" para que no se vea borroso.
  canvas.width = Math.round(box.width * dpr); canvas.height = Math.round(box.height * dpr);
  const ctx = canvas.getContext('2d'); ctx.scale(dpr, dpr);
  const w = box.width, h = box.height, now = Date.now();
  const plots = [{ key: 'rpm', label: 'RPM', color: '#69dfce' }, { key: 'volts', label: 'VOLTIOS', color: '#ffc66c' }];
  ctx.font = '11px system-ui';
  plots.forEach((p, index) => {
    // Zona de esta gráfica: mitad superior (index 0) o inferior (index 1),
    // con márgenes para los textos.
    const top = index * h / 2 + 22, bottom = (index + 1) * h / 2 - 20, left = 44, right = w - 10;
    const visible = history.filter(r => now - r.received <= 60000);
    // Escala: el mayor valor absoluto visible más un 10 % de margen (mínimo 1).
    const max = Math.max(1, ...visible.map(r => Math.abs(r[p.key] ?? 0))) * 1.1;
    ctx.fillStyle = p.color; ctx.fillText(`${p.label} · escala ±${max.toFixed(1)}`, left, top - 9);
    // Línea inferior de la zona.
    ctx.strokeStyle = '#2b425b'; ctx.beginPath(); ctx.moveTo(left, bottom); ctx.lineTo(right, bottom); ctx.stroke();
    // Línea del cero, en el centro (la escala es simétrica: de −máx a +máx).
    ctx.fillStyle = '#b1c3d7'; ctx.fillText('0', 20, (top + bottom) / 2 + 4);
    ctx.strokeStyle = '#344e65'; ctx.beginPath(); ctx.moveTo(left, (top + bottom) / 2); ctx.lineTo(right, (top + bottom) / 2); ctx.stroke();
    // Traza de los datos.
    ctx.strokeStyle = p.color; ctx.lineWidth = 2; ctx.beginPath(); let previous = null;
    for (const r of visible) {
      // Un dato ausente corta la línea: deja un hueco en vez de inventar valores.
      if (r[p.key] === null) { previous = null; continue; }
      // Posición: x según la antigüedad del dato; y según su valor.
      const x = left + (1 - (now - r.received) / 60000) * (right - left);
      const y = (top + bottom) / 2 - r[p.key] / max * (bottom - top) / 2;
      // Empieza un tramo nuevo (sin unir con el anterior) si pasaron más de
      // 2 s o si cambió la sesión, el modo o las vueltas: son datos distintos
      // y unirlos con una línea sería engañoso.
      if (!previous || r.received - previous.received > 2000 || r.session !== previous.session || r.mode !== previous.mode || r.turns !== previous.turns) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      previous = r;
    }
    ctx.stroke(); ctx.fillStyle = '#b1c3d7'; ctx.fillText('−60 s', left, bottom + 15); ctx.fillText('ahora', Math.max(left, right - 34), bottom + 15);
  });
}
// Si cambia el tamaño de la ventana (o se gira el móvil), redibuja.
window.addEventListener('resize', draw);

// =============================================================================
// 7. Comprobaciones periódicas y de arranque
// =============================================================================

// Una vez por segundo: si hay conexión pero no llegan lecturas desde hace
// 3 s o más, borra las cifras para no mostrar datos viejos como actuales.
// También refresca botones y gráfica (que se desplaza con el tiempo).
setInterval(() => {
  if (connected && lastAt && performance.now() - lastAt >= 3000) { blank('SIN DATOS RECIENTES'); text('connection', 'Conectado, sin datos'); }
  setControls(); draw();
}, 1000);

// Al abrir la página: Web Bluetooth solo funciona con HTTPS (o localhost) y en
// navegadores compatibles (Chrome, Edge). Si no se cumple, se explica.
if (!window.isSecureContext) message('Bluetooth requiere HTTPS. Desde Android usa la URL publicada; http://IP-del-PC no sirve. En el propio PC puedes usar localhost.');
else if (!navigator.bluetooth) message('Este navegador no ofrece Web Bluetooth. Usa Chrome en Android o Chrome/Edge compatible en el ordenador.');
setControls(); draw();
