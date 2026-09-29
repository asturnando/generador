// Protocolo binario compartido por el monitor y las pruebas de Node.
export const UUID = Object.freeze({
  service: 'aa510001-7a4b-4c26-8e01-8c5370b56555',
  telemetry: 'aa510002-7a4b-4c26-8e01-8c5370b56555',
  control: 'aa510003-7a4b-4c26-8e01-8c5370b56555',
  info: 'aa510004-7a4b-4c26-8e01-8c5370b56555',
});
export const MODES = ['DEMO', 'REAL', 'MIXED'];
export const TURNS = [200, 400, 600, 655];
export const STATUSES = ['OK', 'CONFIG_ERROR', 'INA_ERROR', 'NO_PULSES', 'RANGE_ERROR'];
export function decodePacket(view) {
  if (!(view instanceof DataView) || view.byteLength !== 20) throw new Error('Paquete BLE incompleto');
  if (view.getUint8(0) !== 1) throw new Error('Versión del protocolo incompatible');
  const mode = MODES[view.getUint8(1)], flags = view.getUint8(2), status = STATUSES[view.getUint8(3)];
  const turns = view.getUint16(6, true);
  if (!mode || !status || !TURNS.includes(turns) || (flags & ~15)) throw new Error('Paquete BLE no válido');
  const rpm = flags & 1 ? view.getFloat32(8, true) : null;
  const volts = flags & 2 ? view.getFloat32(12, true) : null;
  const current = flags & 2 ? view.getFloat32(16, true) : null;
  if ([rpm, volts, current].some(v => v !== null && !Number.isFinite(v)) || (rpm !== null && rpm < 0)) throw new Error('Lecturas BLE no válidas');
  return { mode, status, turns, sequence: view.getUint16(4, true), rpm, volts, current,
    power: volts === null || current === null ? null : volts * current,
    rpmSource: rpm === null ? 'SIN_DATO' : mode === 'DEMO' ? 'SIMULADO' : 'MEDIDO',
    electricSource: volts === null ? 'SIN_DATO' : mode === 'REAL' ? 'MEDIDO' : 'SIMULADO',
    rpmReady: !!(flags & 8), inaReady: !!(flags & 4) };
}
export function commandText(kind, value) {
  if (kind === 'MODE' && MODES.includes(value)) return `MODE:${value}`;
  if (kind === 'TURNS' && TURNS.includes(Number(value))) return `TURNS:${Number(value)}`;
  if (kind === 'SPEED' && Number.isInteger(Number(value)) && Number(value) >= 0 && Number(value) <= 1200) return `SPEED:${Number(value)}`;
  throw new Error('Orden no válida');
}
export function csvRows(rows) {
  const header = 'recepcion_utc,sesion,secuencia,modo,vueltas,rpm,voltaje_V,corriente_mA,potencia_mW,origen_rpm,origen_electrico,estado';
  return header + '\r\n' + rows.map(r => [r.time, r.session, r.sequence, r.mode, r.turns, r.rpm, r.volts, r.current, r.power, r.rpmSource, r.electricSource, r.status].map(v => v ?? '').join(',')).join('\r\n') + '\r\n';
}
