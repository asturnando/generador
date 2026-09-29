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
});

// Listas de valores posibles. La placa envía un número (0, 1, 2...) y su
// posición en la lista da el nombre: MODES[0] = 'DEMO', MODES[1] = 'REAL'...
export const MODES = ['DEMO', 'REAL', 'MIXED'];
// Tomas de la bobina que existen.
export const TURNS = [200, 400, 600, 655];
// Estados de lectura, en el mismo orden que en protocol.h.
export const STATUSES = ['OK', 'CONFIG_ERROR', 'INA_ERROR', 'NO_PULSES', 'RANGE_ERROR'];

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

// Construye el texto de una orden para la placa, comprobándola antes.
//   commandText('MODE', 'DEMO')  → 'MODE:DEMO'
//   commandText('TURNS', 400)    → 'TURNS:400'
//   commandText('SPEED', 300)    → 'SPEED:300'  (entero de 0 a 1200)
// Cualquier otra cosa lanza un error y no se envía nada.
// La placa vuelve a comprobarlo todo por su cuenta (processCommand en main.cpp).
export function commandText(kind, value) {
  if (kind === 'MODE' && MODES.includes(value)) return `MODE:${value}`;
  if (kind === 'TURNS' && TURNS.includes(Number(value))) return `TURNS:${Number(value)}`;
  if (kind === 'SPEED' && Number.isInteger(Number(value)) && Number(value) >= 0 && Number(value) <= 1200) return `SPEED:${Number(value)}`;
  throw new Error('Orden no válida');
}

// Convierte el registro de lecturas en texto CSV (valores separados por comas),
// que se abre con Excel, LibreOffice u hojas de cálculo de Google.
// Primera línea: nombres de las columnas. Después, una línea por lectura.
// Los datos ausentes (null) quedan como una casilla vacía ("?? ''").
// "\r\n" es el salto de línea que espera Excel en Windows.
export function csvRows(rows) {
  const header = 'recepcion_utc,sesion,secuencia,modo,vueltas,rpm,voltaje_V,corriente_mA,potencia_mW,origen_rpm,origen_electrico,estado';
  return header + '\r\n' + rows.map(r => [r.time, r.session, r.sequence, r.mode, r.turns, r.rpm, r.volts, r.current, r.power, r.rpmSource, r.electricSource, r.status].map(v => v ?? '').join(',')).join('\r\n') + '\r\n';
}
