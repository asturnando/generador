import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { parseSerialLine, commandText, hex } from '../assets/js/monitor-protocol.js';
// Se ejecuta consola.js sin su línea import, con un navegador y un puerto
// serie simulados. Las líneas que se "reciben" son las del firmware 1.1.1.
const source = readFileSync(new URL('../assets/js/consola.js', import.meta.url), 'utf8').replace(/^import .*;\r?\n/, '');
const html = readFileSync(new URL('../consola.html', import.meta.url), 'utf8');
class Emitter {
  handlers = new Map();
  addEventListener(name, handler) { if (!this.handlers.has(name)) this.handlers.set(name, new Set()); this.handlers.get(name).add(handler); }
  emit(name) { for (const handler of this.handlers.get(name) || []) handler({ target: this }); }
}
const flush = () => new Promise(resolve => setImmediate(resolve));
function fixture({ serial = true } = {}) {
  const nodes = new Map([...html.matchAll(/id="([^"]+)"/g)].map(([, id]) => {
    const el = new Emitter(); Object.assign(el, { textContent: '', value: '', disabled: false, className: '', checked: id === 'quiet', scrollTop: 0, scrollHeight: 0 });
    return [id, el];
  }));
  let controller; const written = [];
  const port = {
    signals: [],
    async open(options) { this.options = options; },
    async setSignals(signals) { this.signals.push(signals); },
    readable: new ReadableStream({ start(c) { controller = c; } }),
    writable: new WritableStream({ write(chunk) { written.push(new TextDecoder().decode(chunk)); } }),
    async close() { this.closed = true; },
  };
  let now = 0; const intervals = [];
  const context = vm.createContext({ parseSerialLine, commandText, hex, console, TextEncoder, TextDecoder, TextDecoderStream,
    document: { getElementById: id => { assert.ok(nodes.has(id), `ID ${id} existe`); return nodes.get(id); }, activeElement: null },
    navigator: serial ? { serial: { requestPort: async () => port } } : {},
    performance: { now: () => now }, setInterval: fn => intervals.push(fn), setTimeout: fn => { fn(); return 0; } });
  vm.runInContext(source, context);
  return { nodes, port, written, run: expr => vm.runInContext(expr, context),
    async feed(text) { controller.enqueue(new TextEncoder().encode(text)); for (let i = 0; i < 6; i++) await flush(); },
    advance(ms) { now += ms; for (const fn of intervals) fn(); },
    async click(id) { nodes.get(id).emit('click'); for (let i = 0; i < 4; i++) await flush(); },
    async change(id, value) { nodes.get(id).value = value; nodes.get(id).emit('change'); for (let i = 0; i < 4; i++) await flush(); },
  };
}
const DIAG = 'DIAG ir=3 ir_bajo=1 hall=0 hall_bajo=0 ina=0x00 sda=0 scl=0 bloqueo=0 i2c=0 ppr=0 sensor=HALL\r\n';
test('sin Web Serial se explica y no deja conectar', () => {
  const f = fixture({ serial: false });
  assert.equal(f.nodes.get('connect').disabled, true); assert.match(f.nodes.get('message').textContent, /Chrome o Edge/);
});
test('conecta a 115200 con DTR/RTS en reposo y muestra los pulsos del infrarrojo', async () => {
  const f = fixture(); await f.run('connect()');
  assert.equal(f.port.options.baudRate, 115200);
  assert.deepEqual({ ...f.port.signals[0] }, { dataTerminalReady: false, requestToSend: false });
  assert.equal(f.nodes.get('zero').disabled, false);
  await f.feed(DIAG);
  assert.equal(f.nodes.get('ir-count').textContent, '3'); assert.match(f.nodes.get('ir-level').textContent, /0 V/);
  assert.equal(f.nodes.get('ir-dot').className, 'dot live'); assert.match(f.nodes.get('ina-status').textContent, /Ni SDA/);
  // Una línea partida en dos trozos se junta antes de procesarla.
  await f.feed('DIAG ir=4 ir_bajo=0 hall=0 hall_bajo=0 ina=0x40 ');
  assert.equal(f.nodes.get('ir-count').textContent, '3');
  await f.feed('sda=1 scl=1 bloqueo=0 i2c=1 ppr=2 sensor=IR\n');
  assert.equal(f.nodes.get('ir-count').textContent, '4'); assert.match(f.nodes.get('ina-status').textContent, /0x40/);
  assert.equal(f.nodes.get('sensor').value, 'IR'); assert.equal(f.nodes.get('ppr').value, '2');
});
test('lectura en mixto muestra RPM del infrarrojo; firmware antiguo avisa', async () => {
  const f = fixture(); await f.run('connect()');
  await f.feed('LECTURA mode=2 turns=655 rpm=60.0 V=0.400 mA=4.000 status=0 src=IR ppr=1\n');
  assert.equal(f.nodes.get('rpm-now').textContent, '60'); assert.match(f.nodes.get('reading-detail').textContent, /Mixto.*infrarrojo/);
  assert.equal(f.nodes.get('mode').value, 'MIXED');
  const old = fixture(); await old.run('connect()');
  await old.feed('mode=0 turns=655 rpm=0.0 V=0.000 mA=0.000 status=0\n');
  assert.match(old.nodes.get('message').textContent, /anterior a 1\.1\.1/);
});
test('órdenes por USB: PPR, sensor, contadores, búsqueda y orden manual', async () => {
  const f = fixture(); await f.run('connect()');
  f.nodes.get('ppr').value = '2'; await f.click('save-ppr'); assert.equal(f.written.at(-1), 'PPR:2\n');
  await f.change('sensor', 'IR'); assert.equal(f.written.at(-1), 'SRC:IR\n');
  await f.click('zero'); assert.equal(f.written.at(-1), 'RESET:PULSES\n');
  await f.click('scan'); assert.equal(f.written.at(-1), 'SCAN\n');
  await f.change('mode', 'MIXED'); assert.equal(f.written.at(-1), 'MODE:MIXED\n');
  f.nodes.get('command').value = ' speed:300 '; await f.click('send'); assert.equal(f.written.at(-1), 'SPEED:300\n');
  const before = f.written.length; f.nodes.get('ppr').value = '70'; await f.click('save-ppr');
  assert.equal(f.written.length, before); assert.match(f.nodes.get('message').textContent, /0 a 64/);
});
test('respuestas OK y ERR, registro silencioso y aviso sin datos', async () => {
  const f = fixture(); await f.run('connect()');
  await f.feed('OK PPR:2\n'); assert.match(f.nodes.get('message').textContent, /confirmó la orden PPR:2/);
  await f.feed('ERR CONFIG_RPM\n'); assert.match(f.nodes.get('message').textContent, /rechazó/);
  await f.feed(DIAG + 'BLE listo: busca Generador Sara desde monitor.html\n');
  assert.doesNotMatch(f.nodes.get('log').textContent, /DIAG/); assert.match(f.nodes.get('log').textContent, /BLE listo/);
  f.advance(5000); assert.match(f.nodes.get('message').textContent, /No llegan datos/);
});
test('reiniciar pulsa RTS y lo suelta', async () => {
  const f = fixture(); await f.run('connect()'); await f.click('reset');
  assert.deepEqual(f.port.signals.slice(1).map(s => ({ ...s })), [
    { dataTerminalReady: false, requestToSend: true }, { dataTerminalReady: false, requestToSend: false }]);
});
