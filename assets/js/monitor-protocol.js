// =============================================================================
// monitor-protocol.js · El "idioma" de la placa, visto desde la web
// =============================================================================
//
// Protocolo binario compartido por el monitor y las pruebas de Node.
// Es la otra mitad de firmware/generador_ble/include/protocol.h. Aquí se
// traducen los paquetes de 20 bytes que envía la ESP32 a números que la web
// puede mostrar, se construyen las órdenes de texto que se le envían y se
// genera el archivo CSV del registro.
//
// Si se cambia algo en protocol.h, hay que cambiarlo también aquí.
//
// Este archivo no toca la página: solo contiene datos y funciones de cálculo.
// Por eso lo usan tanto monitor.js (en el navegador) como las pruebas
// automáticas de la carpeta tests/ (con Node).
//
// "export" hace que cada elemento se pueda usar desde otros archivos con
// "import". "Object.freeze" impide que se modifique por error.
// =============================================================================

// Identificadores Bluetooth del servicio y sus características.
// Deben ser exactamente los mismos que en protocol.h.
export const UUID = Object.freeze({
  service: 'aa510001-7a4b-4c26-8e01-8c5370b56555',    // Servicio "Generador Sara".
  telemetry: 'aa510002-7a4b-4c26-8e01-8c5370b56555',  // Lecturas (paquetes de 20 bytes).
  control: 'aa510003-7a4b-4c26-8e01-8c5370b56555',    // Órdenes y respuestas de texto.
  info: 'aa510004-7a4b-4c26-8e01-8c5370b56555',       // JSON con versión y sensores.
  diag: 'aa510005-7a4b-4c26-8e01-8c5370b56555',       // Diagnóstico en directo (firmware 1.1.0+).
});

// Listas de valores posibles. La placa envía un número (0, 1, 2...) y su
// posición en la lista da el nombre: MODES[0] = 'DEMO', MODES[1] = 'REAL'...
export const MODES = ['DEMO', 'REAL', 'MIXED'];
// Tomas de la bobina que existen.
export const TURNS = [200, 400, 600, 655];
// Estados de lectura, en el mismo orden que en protocol.h.
export const STATUSES = ['OK', 'CONFIG_ERROR', 'INA_ERROR', 'NO_PULSES', 'RANGE_ERROR'];
// Sensores de RPM que se pueden elegir: Hall (imanes) o IR (infrarrojo).
export const SOURCES = ['HALL', 'IR'];
// Máximo de pulsos por vuelta que acepta la placa (MAX_PPR en config.h).
export const MAX_PPR = 64;

// -----------------------------------------------------------------------------
// Modelo teórico (modo «Teórico» del monitor)
// -----------------------------------------------------------------------------
// Estima lo que daría el generador BIEN MONTADO a partir de las RPM medidas,
// con la ley de Faraday. Es un orden de magnitud para comparar con lo medido,
// no una medida: el monitor lo rotula siempre como «Teórico».
// Supuestos (valores por defecto, los dos primeros se pueden cambiar en pantalla):
//   magnets          → imanes en el CD, alternando N y S.
//   gapMm            → distancia entre la cara de los imanes y la bobina.
//   magnetDiameterMm, magnetThicknessMm → imanes de neodimio de 15 × 2 mm.
//   remanenceT       → campo propio del neodimio (unos 1,2 T).
//   fluxFactor       → fracción media del campo central que atraviesa un hueco
//                      de bobina del tamaño del imán (0,6).
//   coilOhmAt655     → resistencia estimada del hilo con 655 vueltas (13 Ω).
//   loadOhm          → la carga de 100 Ω.
//   bridgeDropV      → lo que se comen los dos diodos que conducen (0,6 V).
export const THEORY_DEFAULTS = Object.freeze({
  magnets: 6, gapMm: 5, magnetDiameterMm: 15, magnetThicknessMm: 2, remanenceT: 1.2,
  fluxFactor: 0.6, coilOhmAt655: 13, loadOhm: 100, bridgeDropV: 0.6,
});

// Devuelve, para unas RPM y unas vueltas de bobina:
//   frequency (Hz), emf (V~ de la bobina sin carga), vac (V~ con la carga),
//   volts (V continuos tras el puente), current (mA) y power (mW).
export function theoreticalOutput(rpm, turns, params = {}) {
  const p = { ...THEORY_DEFAULTS, ...params };
  if (!(rpm > 0) || !(turns > 0)) return { frequency: 0, emf: 0, vac: 0, volts: 0, current: 0, power: 0 };
  // Campo en el eje de un imán de disco, a la distancia de la bobina (en metros).
  const R = p.magnetDiameterMm / 2000, L = p.magnetThicknessMm / 1000, z = p.gapMm / 1000;
  const field = p.remanenceT / 2 * ((L + z) / Math.hypot(R, L + z) - z / Math.hypot(R, z));
  // Flujo máximo por el hueco de la bobina (del tamaño del imán).
  const flux = p.fluxFactor * field * Math.PI * R * R;
  // Con los imanes alternados, cada pareja N-S es un ciclo de la onda.
  const frequency = (p.magnets / 2) * rpm / 60;
  // Tensión eficaz inducida: E = 4,44 × f × N × Φ (onda senoidal).
  const emf = 4.44 * frequency * turns * flux;
  // Parte de la tensión se queda en el propio hilo de la bobina.
  const coilOhm = p.coilOhmAt655 * turns / 655;
  const vac = emf * p.loadOhm / (p.loadOhm + coilOhm);
  // Tras el puente: media de la onda rectificada (0,9 × eficaz) menos los diodos.
  const volts = Math.max(0, 0.9 * vac - p.bridgeDropV);
  const current = volts / p.loadOhm * 1000;
  return { frequency, emf, vac, volts, current, power: volts * current };
}

// Traduce un paquete de telemetría (20 bytes) a un objeto con nombres claros.
// "view" es un DataView: una forma de leer bytes indicando su posición y tipo.
// Si el paquete no es válido, lanza un error en vez de mostrar datos dudosos.
//
// Recordatorio de las posiciones (ver protocol.h):
//   0 versión · 1 modo · 2 banderas · 3 estado · 4-5 secuencia · 6-7 vueltas
//   8-11 RPM · 12-15 voltios · 16-19 miliamperios
export function decodePacket(view) {
  // Debe tener exactamente 20 bytes.
  if (!(view instanceof DataView) || view.byteLength !== 20) throw new Error('Paquete BLE incompleto');
  // Byte 0: versión del protocolo. Esta web solo entiende la versión 1.
  if (view.getUint8(0) !== 1) throw new Error('Versión del protocolo incompatible');
  // Bytes 1, 2 y 3: modo, banderas y estado (1 byte cada uno).
  const mode = MODES[view.getUint8(1)], flags = view.getUint8(2), status = STATUSES[view.getUint8(3)];
  // Bytes 6-7: vueltas. "true" indica little endian (primero el byte bajo),
  // igual que lo escribe la ESP32.
  const turns = view.getUint16(6, true);
  // Comprueba que todo tenga sentido: modo y estado conocidos, vueltas de una
  // toma real y ninguna bandera desconocida. Las banderas existentes suman
  // como mucho 1 + 2 + 4 + 8 = 15; "flags & ~15" detecta cualquier bit de más.
  if (!mode || !status || !TURNS.includes(turns) || (flags & ~15)) throw new Error('Paquete BLE no válido');
  // Banderas (ver protocol.h): 1 = RPM válidas, 2 = electricidad válida.
  // Si la bandera no está, el valor se trata como "sin dato" (null) aunque
  // el paquete traiga algún número en esa posición.
  const rpm = flags & 1 ? view.getFloat32(8, true) : null;
  const volts = flags & 2 ? view.getFloat32(12, true) : null;
  const current = flags & 2 ? view.getFloat32(16, true) : null;
  // Un valor marcado como válido debe ser un número normal (no NaN ni
  // infinito), y las RPM no pueden ser negativas.
  if ([rpm, volts, current].some(v => v !== null && !Number.isFinite(v)) || (rpm !== null && rpm < 0)) throw new Error('Lecturas BLE no válidas');
  return { mode, status, turns,
    sequence: view.getUint16(4, true),  // Bytes 4-5: número de paquete.
    rpm, volts, current,
    // Potencia = tensión × corriente. Como la corriente va en mA, el
    // resultado sale en mW. Solo se calcula si hay ambos datos.
    power: volts === null || current === null ? null : volts * current,
    // De dónde viene cada dato, para mostrarlo en pantalla y en el CSV:
    //   RPM: simuladas en DEMO, medidas en REAL y MIXED.
    rpmSource: rpm === null ? 'SIN_DATO' : mode === 'DEMO' ? 'SIMULADO' : 'MEDIDO',
    //   Electricidad: medida solo en REAL; simulada en DEMO y MIXED.
    electricSource: volts === null ? 'SIN_DATO' : mode === 'REAL' ? 'MEDIDO' : 'SIMULADO',
    // Banderas 8 = sensor de RPM configurado y 4 = INA219 configurado.
    // "!!" convierte el resultado en true o false.
    rpmReady: !!(flags & 8), inaReady: !!(flags & 4) };
}

// Traduce un paquete de diagnóstico (20 bytes, firmware 1.1.0 o posterior).
// Recordatorio de las posiciones (ver encodeDiag en protocol.h):
//   0 versión · 1 banderas · 2 dirección INA219 · 3 pulsos por vuelta
//   4-7 pulsos Hall · 8-11 pulsos infrarrojo · 12 nº dispositivos I2C
//   13-19 sus direcciones
export function decodeDiag(view) {
  if (!(view instanceof DataView) || view.byteLength !== 20) throw new Error('Diagnóstico BLE incompleto');
  if (view.getUint8(0) !== 1) throw new Error('Versión del diagnóstico incompatible');
  const flags = view.getUint8(1), ppr = view.getUint8(3);
  // Solo existen los bits 1 a 64 (suman 127); el 128 no debe aparecer.
  if ((flags & 128) || ppr > MAX_PPR) throw new Error('Diagnóstico BLE no válido');
  const i2cCount = view.getUint8(12);
  // Direcciones encontradas: los huecos a 0 se descartan.
  const i2cAddresses = [];
  for (let i = 13; i < 20; i++) if (view.getUint8(i)) i2cAddresses.push(view.getUint8(i));
  return {
    hallLow: !!(flags & 1),         // Salida del Hall a 0 V ahora mismo.
    irLow: !!(flags & 2),           // Salida del infrarrojo a 0 V ahora mismo.
    inaFound: !!(flags & 4),        // INA219 respondiendo y calibrado.
    source: flags & 8 ? 'IR' : 'HALL',  // Sensor elegido para las RPM.
    sdaPullup: !!(flags & 16),      // SDA llega a 3,3 V a través del módulo.
    sclPullup: !!(flags & 32),      // SCL llega a 3,3 V a través del módulo.
    i2cStuck: !!(flags & 64),       // SDA o SCL clavadas a 0 V.
    inaAddress: view.getUint8(2) || null,  // null = no encontrado.
    ppr,                            // 0 = sin configurar.
    hallPulses: view.getUint32(4, true),
    irPulses: view.getUint32(8, true),
    i2cCount, i2cAddresses,
  };
}

// Lee una línea de texto que la placa escribe por USB (firmware 1.1.1+) y
// devuelve su tipo y sus valores "clave=valor", o null si no es de las suyas.
//   'DIAG ir=13 ir_bajo=1 ... sensor=IR' → { type: 'DIAG', ir: 13, ir_bajo: 1, ..., sensor: 'IR' }
//   'LECTURA mode=2 rpm=60.0 ...'        → { type: 'LECTURA', mode: 2, rpm: 60, ... }
// Los valores numéricos (también "0x40") se convierten en números; "nan"
// (sin dato) pasa a null; el resto queda como texto.
export function parseSerialLine(line) {
  const match = /^(DIAG|LECTURA) (.*)$/.exec(String(line).trim());
  if (!match) return null;
  const result = { type: match[1] };
  for (const [, key, raw] of match[2].matchAll(/(\w+)=(\S+)/g)) {
    if (/^nan$/i.test(raw)) result[key] = null;
    else if (/^0x[0-9a-f]+$/i.test(raw)) result[key] = parseInt(raw, 16);
    else if (/^-?\d+(\.\d+)?$/.test(raw)) result[key] = Number(raw);
    else result[key] = raw;
  }
  return result;
}

// Escribe una dirección I2C en hexadecimal, como 0x40.
export const hex = n => '0x' + n.toString(16).toUpperCase().padStart(2, '0');

// Construye el texto de una orden para la placa, comprobándola antes.
//   commandText('MODE', 'DEMO')    → 'MODE:DEMO'
//   commandText('TURNS', 400)      → 'TURNS:400'
//   commandText('SPEED', 300)      → 'SPEED:300'  (entero de 0 a 1200)
//   commandText('PPR', 4)          → 'PPR:4'      (entero de 0 a 64)
//   commandText('SRC', 'IR')       → 'SRC:IR'     (HALL o IR)
//   commandText('RESET', 'PULSES') → 'RESET:PULSES'
//   commandText('SCAN')            → 'SCAN'
// Cualquier otra cosa lanza un error y no se envía nada.
// La placa vuelve a comprobarlo todo por su cuenta (processCommand en main.cpp).
export function commandText(kind, value) {
  if (kind === 'MODE' && MODES.includes(value)) return `MODE:${value}`;
  if (kind === 'TURNS' && TURNS.includes(Number(value))) return `TURNS:${Number(value)}`;
  if (kind === 'SPEED' && Number.isInteger(Number(value)) && Number(value) >= 0 && Number(value) <= 1200) return `SPEED:${Number(value)}`;
  // String(value).trim() !== '' evita que un campo vacío cuente como 0.
  if (kind === 'PPR' && String(value).trim() !== '' && Number.isInteger(Number(value)) && Number(value) >= 0 && Number(value) <= MAX_PPR) return `PPR:${Number(value)}`;
  if (kind === 'SRC' && SOURCES.includes(value)) return `SRC:${value}`;
  if (kind === 'RESET' && value === 'PULSES') return 'RESET:PULSES';
  if (kind === 'SCAN') return 'SCAN';
  throw new Error('Orden no válida');
}

// Convierte el registro de lecturas en texto CSV (valores separados por comas),
// que se abre con Excel, LibreOffice u hojas de cálculo de Google.
// Primera línea: nombres de las columnas. Después, una línea por lectura.
// Los datos ausentes (null) quedan como una casilla vacía ("?? ''").
// Las dos últimas columnas dicen con qué sensor y cuántos pulsos por vuelta
// se calcularon las RPM medidas: si se cambia el PPR, cambian las RPM, así
// que el dato debe acompañar a cada fila. Quedan vacías si las RPM no se
// midieron (demostración o sin dato).
// "\r\n" es el salto de línea que espera Excel en Windows.
export function csvRows(rows) {
  const header = 'recepcion_utc,sesion,secuencia,modo,vueltas,rpm,voltaje_V,corriente_mA,potencia_mW,origen_rpm,origen_electrico,estado,sensor_rpm,ppr';
  return header + '\r\n' + rows.map(r => [r.time, r.session, r.sequence, r.mode, r.turns, r.rpm, r.volts, r.current, r.power, r.rpmSource, r.electricSource, r.status, r.rpmSensor, r.ppr].map(v => v ?? '').join(',')).join('\r\n') + '\r\n';
}
