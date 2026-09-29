import test from 'node:test';
import assert from 'node:assert/strict';
import { decodePacket, csvRows, commandText } from '../assets/js/monitor-protocol.js';
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
  const csv = csvRows([row]); assert.match(csv, /REAL,655,,,,,SIN_DATO,SIN_DATO,INA_ERROR/);
  assert.match(csv, /origen_rpm,origen_electrico/); assert.doesNotMatch(csv, /NaN|null|undefined/);
});
