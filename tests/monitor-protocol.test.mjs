import test from 'node:test';
import assert from 'node:assert/strict';
import { decodePacket, decodeDiag, hex, csvRows, commandText, parseSerialLine, theoreticalOutput } from '../assets/js/monitor-protocol.js';
function packet({ mode = 0, flags = 3, status = 0, turns = 655, rpm = 300, volts = 2, ma = 20, sequence = 4 } = {}) {
  const d = new DataView(new ArrayBuffer(20));
  d.setUint8(0, 1); d.setUint8(1, mode); d.setUint8(2, flags); d.setUint8(3, status);
  d.setUint16(4, sequence, true); d.setUint16(6, turns, true);
  d.setFloat32(8, rpm, true); d.setFloat32(12, volts, true); d.setFloat32(16, ma, true); return d;
}
test('demo: 20 bytes, 655 vueltas y V × mA = mW', () => {
  const r = decodePacket(packet()); assert.equal(r.power, 40); assert.equal(r.turns, 655);
  assert.equal(r.rpmSource, 'SIMULADO'); assert.equal(r.electricSource, 'SIMULADO');
});
test('real no se convierte a demo si falla INA219', () => {
  const r = decodePacket(packet({ mode: 1, flags: 9, status: 2, volts: NaN, ma: NaN }));
  assert.equal(r.mode, 'REAL'); assert.equal(r.volts, null); assert.equal(r.power, null);
  assert.equal(r.rpmSource, 'MEDIDO'); assert.equal(r.electricSource, 'SIN_DATO'); assert.equal(r.status, 'INA_ERROR');
});
test('mixto separa RPM medidas y electricidad simulada', () => {
  const r = decodePacket(packet({ mode: 2, flags: 11 }));
  assert.equal(r.rpmSource, 'MEDIDO'); assert.equal(r.electricSource, 'SIMULADO');
});
test('cero válido no es ausencia de dato', () => {
  const r = decodePacket(packet({ rpm: 0, volts: 0, ma: 0 })); assert.equal(r.power, 0); assert.equal(r.rpm, 0);
});
test('rechaza datos inválidos y la antigua opción de 800 vueltas', () => {
  assert.throws(() => decodePacket(new DataView(new ArrayBuffer(19))));
  for (const props of [{ mode: 3 }, { turns: 800 }, { rpm: NaN }, { volts: Infinity }, { status: 9 }, { flags: 255 }, { rpm: -1 }]) assert.throws(() => decodePacket(packet(props)));
  const p = packet(); p.setUint8(0, 2); assert.throws(() => decodePacket(p));
});
test('controles limitados y mensajes menores de 20 bytes', () => {
  for (const n of [200, 400, 600, 655]) assert.equal(commandText('TURNS', n), `TURNS:${n}`);
  for (const mode of ['REAL', 'DEMO', 'MIXED']) assert.ok(commandText('MODE', mode).length <= 20);
  for (const n of [-1, 1201, NaN, 1.5]) assert.throws(() => commandText('SPEED', n));
  assert.throws(() => commandText('TURNS', 800)); assert.throws(() => commandText('MODE', 'AUTO'));
});
test('CSV registra procedencia y deja vacío lo ausente', () => {
  const row = { ...decodePacket(packet({ mode: 1, flags: 0, status: 2 })), time: '2026-09-29T14:00:00.000Z', session: 1 };
  const csv = csvRows([row]); assert.match(csv, /REAL,655,,,,,SIN_DATO,SIN_DATO,INA_ERROR,,\r\n$/);
  assert.match(csv, /origen_rpm,origen_electrico,estado,sensor_rpm,ppr\r\n/); assert.doesNotMatch(csv, /NaN|null|undefined/);
});
// Paquete de diagnóstico del firmware 1.1.0 (ver encodeDiag en protocol.h).
function diag({ flags = 4 | 16 | 32, ina = 0x40, ppr = 4, hall = 123456, ir = 7, count = 2, addresses = [0x3c, 0x40] } = {}) {
  const d = new DataView(new ArrayBuffer(20));
  d.setUint8(0, 1); d.setUint8(1, flags); d.setUint8(2, ina); d.setUint8(3, ppr);
  d.setUint32(4, hall, true); d.setUint32(8, ir, true); d.setUint8(12, count);
  addresses.forEach((a, i) => d.setUint8(13 + i, a)); return d;
}
test('diagnóstico: INA219, contadores de 32 bits, niveles y lista I2C', () => {
  const r = decodeDiag(diag({ flags: 4 | 16 | 32 | 1 | 8 }));
  assert.equal(r.inaFound, true); assert.equal(r.inaAddress, 0x40); assert.equal(hex(r.inaAddress), '0x40');
  assert.equal(r.hallPulses, 123456); assert.equal(r.irPulses, 7); assert.equal(r.ppr, 4);
  assert.equal(r.hallLow, true); assert.equal(r.irLow, false); assert.equal(r.source, 'IR');
  assert.deepEqual(r.i2cAddresses, [0x3c, 0x40]); assert.equal(r.i2cCount, 2);
  const none = decodeDiag(diag({ flags: 64, ina: 0, count: 0, addresses: [] }));
  assert.equal(none.inaAddress, null); assert.equal(none.i2cStuck, true); assert.equal(none.source, 'HALL');
});
test('diagnóstico: rechaza tamaño, versión, bit desconocido y PPR imposible', () => {
  assert.throws(() => decodeDiag(new DataView(new ArrayBuffer(19))));
  const v = diag(); v.setUint8(0, 2); assert.throws(() => decodeDiag(v));
  assert.throws(() => decodeDiag(diag({ flags: 128 }))); assert.throws(() => decodeDiag(diag({ ppr: 65 })));
});
test('líneas USB: DIAG y LECTURA con números, hexadecimal y sin dato', () => {
  const d = parseSerialLine('DIAG ir=13 ir_bajo=1 hall=0 hall_bajo=0 ina=0x40 sda=1 scl=1 bloqueo=0 i2c=1 ppr=2 sensor=IR\r');
  assert.equal(d.type, 'DIAG'); assert.equal(d.ir, 13); assert.equal(d.ir_bajo, 1); assert.equal(d.ina, 0x40);
  assert.equal(d.ppr, 2); assert.equal(d.sensor, 'IR');
  assert.equal(parseSerialLine('DIAG ir=0 ina=0x00').ina, 0);
  const l = parseSerialLine('LECTURA mode=2 turns=655 rpm=60.0 V=nan mA=nan status=0 src=IR ppr=1');
  assert.equal(l.type, 'LECTURA'); assert.equal(l.mode, 2); assert.equal(l.rpm, 60); assert.equal(l.V, null);
  for (const other of ['BLE listo: busca Generador Sara', 'OK PPR:2', 'I2C: 1 dispositivo(s)', '']) assert.equal(parseSerialLine(other), null);
});
test('órdenes de sensores: PPR, sensor, contadores y búsqueda I2C', () => {
  assert.equal(commandText('PPR', '4'), 'PPR:4'); assert.equal(commandText('PPR', 0), 'PPR:0'); assert.equal(commandText('PPR', 64), 'PPR:64');
  for (const v of ['', ' ', 65, -1, 1.5, 'x']) assert.throws(() => commandText('PPR', v));
  assert.equal(commandText('SRC', 'HALL'), 'SRC:HALL'); assert.equal(commandText('SRC', 'IR'), 'SRC:IR'); assert.throws(() => commandText('SRC', 'OPTICO'));
  assert.equal(commandText('RESET', 'PULSES'), 'RESET:PULSES'); assert.throws(() => commandText('RESET', 'TODO'));
  assert.equal(commandText('SCAN'), 'SCAN');
  for (const c of [commandText('RESET', 'PULSES'), commandText('SRC', 'HALL'), commandText('PPR', 64)]) assert.ok(c.length <= 20);
});
test('modelo teórico: Faraday proporcional a RPM y vueltas, y umbral del puente', () => {
  const t = theoreticalOutput(3685, 655);
  assert.ok(Math.abs(t.frequency - 184.25) < 1e-9);             // 6 imanes → 3 ciclos por vuelta
  assert.ok(t.emf > 3.5 && t.emf < 5.5, `emf ${t.emf}`);         // unos 4,3 V~ sin carga
  assert.ok(t.volts > 2.3 && t.volts < 3.4, `V ${t.volts}`);     // unos 2,9 V tras el puente
  assert.ok(Math.abs(t.current - t.volts * 10) < 1e-9);           // 100 Ω → mA = V × 10
  assert.ok(Math.abs(t.power - t.volts * t.current) < 1e-9);      // mW = V × mA
  assert.ok(Math.abs(theoreticalOutput(7370, 655).emf / t.emf - 2) < 1e-9);    // doble de RPM, doble de tensión
  assert.ok(Math.abs(theoreticalOutput(3685, 200).emf / t.emf - 200 / 655) < 1e-9);
  assert.equal(theoreticalOutput(300, 655).volts, 0);             // a poca velocidad no pasa el puente
  assert.deepEqual(theoreticalOutput(0, 655), { frequency: 0, emf: 0, vac: 0, volts: 0, current: 0, power: 0 });
  assert.ok(theoreticalOutput(3685, 655, { gapMm: 10 }).emf < t.emf); // más lejos, menos tensión
  assert.ok(theoreticalOutput(3685, 655, { magnets: 8 }).frequency > t.frequency);
});
