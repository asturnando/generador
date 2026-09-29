import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { UUID, decodePacket, commandText, csvRows } from '../assets/js/monitor-protocol.js';
const source = readFileSync(new URL('../assets/js/monitor.js', import.meta.url), 'utf8').replace(/^import .*;\r?\n/, '');
const html = readFileSync(new URL('../monitor.html', import.meta.url), 'utf8');
function packet({ sequence = 1, mode = 0, flags = 3, status = 0, rpm = 0, volts = 0, ma = 0 } = {}) {
  const p = new DataView(new ArrayBuffer(20));
  p.setUint8(0, 1); p.setUint8(1, mode); p.setUint8(2, flags); p.setUint8(3, status);
  p.setUint16(4, sequence, true); p.setUint16(6, 655, true);
  p.setFloat32(8, rpm, true); p.setFloat32(12, volts, true); p.setFloat32(16, ma, true); return p;
}
class Emitter {
  handlers = new Map();
  addEventListener(name, handler) { if (!this.handlers.has(name)) this.handlers.set(name, new Set()); this.handlers.get(name).add(handler); }
  removeEventListener(name, handler) { this.handlers.get(name)?.delete(handler); }
  emit(name) { for (const handler of this.handlers.get(name) || []) handler({ target: this }); }
}
function fixture({ bluetooth = true, secure = true, rpmReady = false, inaReady = false, infoPadding = false } = {}) {
  const ctx2d = new Proxy({}, { get: (o, key) => o[key] ?? (() => {}) });
  const nodes = new Map([...html.matchAll(/id="([^"]+)"/g)].map(([, id]) => {
    const el = new Emitter(); Object.assign(el, { textContent: '', value: id === 'mode' ? 'DEMO' : id === 'turns' ? '655' : '0', disabled: false,
      getBoundingClientRect: () => ({ width: 600, height: 280 }), getContext: () => ctx2d,
      querySelector: selector => { if (!el.options) el.options = {}; return el.options[selector] ||= {}; } });
    return [id, el];
  }));
  let now = 100, nextTimer = 0;
  const timers = new Map(), intervals = [];
  class Characteristic extends Emitter {
    async startNotifications() { return this; }
    async readValue() { return this.value; }
    async writeValueWithResponse(bytes) {
      this.lastWrite = new TextDecoder().decode(bytes);
      if (this.rejectWrite) throw new Error('Write failed');
      if (!this.noAck) { this.value = new TextEncoder().encode(this.error || `OK ${this.lastWrite}`); this.emit('characteristicvaluechanged'); }
    }
  }
  const telemetry = new Characteristic(); telemetry.value = packet();
  const control = new Characteristic(), info = new Characteristic();
  info.value = new TextEncoder().encode(JSON.stringify({ protocol: 1, finalTurns: 655, firmware: '1.0.0', rpmReady, inaReady }));
  // Firmware 1.0.0: char[200] completo, con '\0' y basura de pila tras el JSON.
  if (infoPadding) { const raw = new Uint8Array(200).fill(0x41); raw.set(info.value); raw[info.value.length] = 0; info.value = raw; }
  const chars = { [UUID.telemetry]: telemetry, [UUID.control]: control, [UUID.info]: info };
  const device = new Emitter(); device.name = 'Generador Sara';
  device.gatt = { connected: false, async connect() { this.connected = true; return this; }, async getPrimaryService() { return { getCharacteristic: async id => chars[id] }; }, disconnect() { if (this.connected) { this.connected = false; device.emit('gattserverdisconnected'); } } };
  const context = vm.createContext({ UUID, decodePacket, commandText, csvRows, console, TextEncoder, TextDecoder, DataView, Date, Blob, URL,
    document: { getElementById: id => { assert.ok(nodes.has(id), `ID ${id} existe`); return nodes.get(id); }, createElement: () => ({ click() {} }) },
    navigator: bluetooth ? { bluetooth: { requestDevice: async () => device } } : {},
    window: { isSecureContext: secure, devicePixelRatio: 1, addEventListener() {} },
    performance: { now: () => now }, confirm: () => true,
    setInterval: fn => intervals.push(fn),
    setTimeout: (fn, ms) => { const id = ++nextTimer; timers.set(id, { fn, deadline: now + ms }); return id; }, clearTimeout: id => timers.delete(id),
  });
  vm.runInContext(source, context);
  return { nodes, telemetry, control, device, context, run: expr => vm.runInContext(expr, context),
    push(props) { telemetry.value = packet(props); telemetry.emit('characteristicvaluechanged'); },
    advance(ms) { now += ms; for (const [id, timer] of timers) if (timer.deadline <= now) { timers.delete(id); timer.fn(); } for (const fn of intervals) fn(); },
  };
}
test('sin Bluetooth / sin HTTPS se explica el bloqueo', () => {
  for (const options of [{ bluetooth: false }, { secure: false }]) { const f = fixture(options); assert.equal(f.nodes.get('connect').disabled, true); assert.ok(f.nodes.get('message').textContent.length > 20); }
});
test('conectar, recibir demo, confirmar orden y exportar origen', async () => {
  const f = fixture(); await f.run('connect()');
  assert.equal(f.nodes.get('connect').disabled, true); assert.equal(f.nodes.get('speed').disabled, false);
  assert.match(f.nodes.get('mode-label').textContent, /SIMULADOS/);
  assert.equal(f.nodes.get('mode').querySelector('[value="REAL"]').disabled, true);
  await f.run('send("SPEED", 300)'); assert.equal(f.control.lastWrite, 'SPEED:300');
  f.push({ sequence: 2, rpm: 300, volts: 2, ma: 20 });
  assert.match(f.nodes.get('rpm').textContent, /300/); assert.match(f.nodes.get('power').textContent, /40/);
  assert.match(f.run('csvRows(rows)'), /SIMULADO,SIMULADO/);
});
test('acepta la info del firmware 1.0.0 con relleno tras el JSON', async () => {
  const f = fixture({ infoPadding: true }); await f.run('connect()');
  assert.equal(f.run('connected'), true); assert.match(f.nodes.get('device').textContent, /firmware 1\.0\.0/);
});
test('desconectar limpia lecturas pero no el CSV; reconecta sin handlers duplicados', async () => {
  const f = fixture(); await f.run('connect()'); f.push({ sequence: 2, rpm: 300, volts: 2, ma: 20 });
  f.device.gatt.disconnect(); assert.equal(f.nodes.get('rpm').textContent, '—'); assert.equal(f.run('rows.length'), 2);
  await f.run('connect()'); assert.equal(f.telemetry.handlers.get('characteristicvaluechanged').size, 1);
  assert.equal(f.run('rows.at(-1).session'), 2);
});
test('pasados 3 segundos sin paquetes borra lecturas y desactiva órdenes; recupera', async () => {
  const f = fixture(); await f.run('connect()'); f.advance(3100);
  assert.equal(f.nodes.get('rpm').textContent, '—'); assert.equal(f.nodes.get('apply-speed').disabled, true);
  f.push({ sequence: 2, rpm: 200 }); assert.equal(f.nodes.get('apply-speed').disabled, false);
});
test('real con fallo conserva REAL y no inventa electricidad', async () => {
  const f = fixture({ rpmReady: true, inaReady: true }); await f.run('connect()');
  f.push({ mode: 1, sequence: 2, flags: 9, status: 2, rpm: 120, volts: NaN, ma: NaN });
  assert.equal(f.nodes.get('volts').textContent, '—'); assert.match(f.nodes.get('mode-label').textContent, /REAL/);
  assert.match(f.nodes.get('sensor-status').textContent, /Error de lectura/); assert.equal(f.nodes.get('demo-controls').hidden, true);
});
test('orden rechazada muestra error, no confirmación falsa', async () => {
  const f = fixture(); await f.run('connect()'); f.control.error = 'ERR CONFIG_REAL';
  await f.run('runCommand("MODE", "REAL")'); assert.match(f.nodes.get('message').textContent, /rechazó/);
  assert.equal(f.run('pending'), null);
});
test('timeout de confirmación cierra conexión y evita ACK atrasado', async () => {
  const f = fixture(); await f.run('connect()'); f.control.noAck = true;
  const task = f.run('send("SPEED", 200)'); const assertion = assert.rejects(task, /no confirmó/);
  f.advance(3100); await assertion; assert.equal(f.device.gatt.connected, false); assert.equal(f.nodes.get('rpm').textContent, '—');
});
test('rechaza paquetes duplicados, contabiliza secuencia tras rollover', async () => {
  const f = fixture(); await f.run('connect()'); f.push({ sequence: 1 }); assert.equal(f.run('rows.length'), 1);
  f.push({ sequence: 65535 }); f.push({ sequence: 0 }); assert.equal(f.run('rows.length'), 3);
});
test('un fallo de escritura libera controles', async () => {
  const f = fixture(); await f.run('connect()'); f.control.rejectWrite = true;
  await assert.rejects(f.run('send("SPEED", 300)'), /Write failed/); assert.equal(f.run('pending'), null);
  assert.equal(f.nodes.get('apply-speed').disabled, false);
});
