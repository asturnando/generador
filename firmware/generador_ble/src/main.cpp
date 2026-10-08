// =============================================================================
// main.cpp · Programa principal del Generador Sara (firmware 1.1.0)
// =============================================================================
//
// Qué hace este programa:
//   - Convierte la ESP32 en un dispositivo Bluetooth llamado "Generador Sara"
//     al que se conecta la web del monitor (monitor.html) desde el móvil.
//   - Cada 500 ms prepara una lectura (RPM, voltios, miliamperios) y la envía
//     al móvil. En modo DEMO la lectura es simulada; en REAL y MIXED viene de
//     los sensores.
//   - Vigila siempre los sensores, aunque se esté en DEMO, y envía su estado
//     en directo (paquete de diagnóstico): si el INA219 responde, cuántos
//     pulsos ha contado cada sensor de RPM y si ahora mismo está detectando.
//     Así se comprueba todo el montaje con este mismo firmware, sin cargar
//     programas de prueba.
//   - Recibe órdenes del móvil: modo, toma de la bobina, velocidad simulada,
//     sensor de RPM, pulsos por vuelta, poner contadores a cero y volver a
//     buscar el INA219. Responde "OK ..." o "ERR ...".
//
// Qué NO hace: no controla el motor ni ninguna salida. Solo mide y simula.
//
// Cómo funciona un programa de Arduino:
//   - setup() se ejecuta una sola vez al encender o reiniciar la placa.
//   - loop() se ejecuta después una y otra vez, sin parar, mientras haya corriente.
//
// Organización de este archivo:
//   1. Variables globales (el estado de la placa).
//   2. Sensores de RPM: contadores de pulsos y cálculo de RPM.
//   3. INA219: búsqueda en el bus I2C y vigilancia.
//   4. Órdenes recibidas por Bluetooth.
//   5. sample(): prepara y envía cada lectura.
//   6. sendDiag(): envía el diagnóstico.
//   7. setup(): arranque.
//   8. loop(): bucle principal.
// =============================================================================

#include <Arduino.h>          // Base de Arduino: pinMode, millis, Serial...
#include <Wire.h>             // Bus I2C, para hablar con el INA219.
#include <Preferences.h>      // Memoria que no se borra al apagar (ajustes).
#include <NimBLEDevice.h>     // Bluetooth Low Energy (biblioteca NimBLE).
#include <Adafruit_INA219.h>  // Manejo del sensor de tensión y corriente INA219.
#include <driver/gpio.h>      // Datos de los pines de la ESP32 (GPIO_IS_VALID_GPIO).
#include "config.h"           // Nuestros ajustes de hardware.
#include "protocol.h"         // Nuestro "idioma" compartido con la web.

// Permite escribir DEMO, SERVICE, encode... sin anteponer "Protocol::".
using namespace Protocol;

// =============================================================================
// 1. Variables globales
// =============================================================================
// Están fuera de cualquier función, así que las pueden usar todas y conservan
// su valor durante todo el funcionamiento.

// Punteros a tres características BLE (ver protocol.h). Se crean en setup() y
// se usan después para enviar lecturas, respuestas y diagnóstico.
NimBLECharacteristic *telemetry, *control, *diagnostics;

// Cola de órdenes. El Bluetooth funciona en su propia "tarea" (un hilo de
// ejecución paralelo del sistema FreeRTOS que lleva la ESP32), distinta de la
// de loop(). Si el Bluetooth cambiara el modo mientras loop() está a mitad de
// una lectura, podría mezclar datos. Para evitarlo, el Bluetooth solo deja la
// orden en esta cola, y loop() la recoge y la ejecuta cuando le toca.
QueueHandle_t commands;

// Una orden recibida: hasta 20 caracteres más el '\0' que marca el final del
// texto en C, por eso 21.
struct Command { char text[21]; };

// Estado actual de la placa. Al encender: modo DEMO, bobina completa y
// velocidad simulada 0 (por seguridad, nunca arranca en otro estado).
Mode mode = DEMO;
uint16_t turns = Config::FINAL_TURNS;  // Toma de la bobina seleccionada (vueltas).
uint16_t demoSpeed = 0;                // Velocidad simulada en modo DEMO (RPM).
uint16_t sequence = 0;                 // Contador de paquetes enviados (0, 1, 2...).
                                       // Al pasar de 65535 vuelve a 0; la web lo tiene en cuenta.

// Ajustes que se guardan en la memoria de la placa y sobreviven al apagado.
// Se cambian desde el móvil.
Preferences settings;
uint8_t ppr = 0;                    // Pulsos por vuelta (0 = sin configurar).
RpmSource source = SOURCE_HALL;     // Sensor del que salen las RPM.

// Últimas RPM medidas. NAN ("not a number") significa "no hay dato" (por
// ejemplo, porque aún no se configuraron los pulsos por vuelta).
float measuredRpm = NAN;

// ---- INA219 ----
// Puntero al objeto que maneja el INA219. Se crea cuando se encuentra el
// módulo, porque hasta entonces no se sabe su dirección.
Adafruit_INA219* ina = nullptr;
uint8_t inaAddress = 0;     // Dirección donde respondió (0 = no encontrado).
bool inaReady = false;      // true = responde y está calibrado.
uint8_t inaFailures = 0;    // Fallos seguidos; a partir de 3 se da por perdido.
// Resultado de la última búsqueda en el bus I2C.
uint8_t i2cFound[7] = {};   // Direcciones que respondieron (hasta 7).
uint8_t i2cCount = 0;       // Cuántas respondieron en total.
bool sdaPullup = false, sclPullup = false, i2cStuck = false;  // Ver DIAG_... en protocol.h.

// ---- Sensores de RPM ----
// Datos de cada entrada de pulsos. "volatile" avisa al compilador de que
// estos valores pueden cambiar en cualquier momento (desde la interrupción),
// así que debe leerlos siempre de la memoria en lugar de suponer que siguen igual.
struct PulseInput {
  int pin;                          // GPIO donde está conectado.
  bool enabled;                     // false si el pin no es válido.
  volatile uint32_t count;          // Pulsos contados desde el arranque (o el último "poner a cero").
  volatile uint32_t lastPulseUs;    // Momento del último pulso contado (µs).
  volatile uint32_t lastHighUs;     // Momento en que la señal subió a alto por última vez.
  volatile bool armed;              // true = la señal estuvo en alto y el próximo bajón puede contar.
};
// "{pin}" rellena el primer campo; el resto empieza a cero / false.
PulseInput hall{Config::HALL_PIN};
PulseInput ir{Config::IR_PIN};

// Cerrojo para proteger los contadores. La ESP32-S3 tiene dos núcleos y los
// contadores los modifican a la vez las interrupciones y loop(); el cerrojo
// garantiza que nunca los toquen los dos al mismo tiempo.
portMUX_TYPE pulseMux = portMUX_INITIALIZER_UNLOCKED;

// Memoria del cálculo de RPM (ver updateRpm()).
struct RpmEstimator {
  bool hasRef = false;      // true = hay un pulso reciente de referencia.
  uint32_t refCount = 0;    // Valor del contador en la última revisión.
  uint32_t refUs = 0;       // Momento del último pulso visto.
  float rpm = 0;            // Última estimación.
} estimator;

// =============================================================================
// 2. Sensores de RPM
// =============================================================================

// Rutina de interrupción común: la ESP32 la ejecuta AUTOMÁTICAMENTE cada vez
// que la señal de un sensor cambia (de alto a bajo o al revés),
// interrumpiendo lo que estuviera haciendo. Debe ser muy corta.
// ARDUINO_ISR_ATTR la guarda en la memoria interna rápida (IRAM), para que
// pueda ejecutarse incluso mientras la memoria flash está ocupada.
//
// Los dos módulos ponen su salida a 0 V al detectar (imán o marca). Se cuenta
// un pulso en cada bajada, pero solo si antes la señal estuvo en alto al
// menos MIN_HIGH_US: así el "temblor" de la señal cuando la marca pasa
// despacio no se cuenta como varios pulsos.
// (Da igual que un módulo concreto funcione al revés, con 3,3 V al detectar:
// cada paso del imán produce una bajada y una subida, así que el número de
// pulsos por vuelta sale igual.)
void ARDUINO_ISR_ATTR onEdge(PulseInput& in) {
  const uint32_t now = micros();
  const bool high = digitalRead(in.pin) == HIGH;
  portENTER_CRITICAL_ISR(&pulseMux);  // Cierra el cerrojo.
  if (high) {
    // Subida: se apunta cuándo empezó el alto y se "arma" el siguiente pulso.
    in.lastHighUs = now; in.armed = true;
  } else if (in.armed && now - in.lastHighUs >= Config::MIN_HIGH_US) {
    // Bajada tras un alto suficientemente largo: es un pulso de verdad.
    ++in.count; in.lastPulseUs = now; in.armed = false;
  }
  portEXIT_CRITICAL_ISR(&pulseMux);   // Lo abre de nuevo.
}
// attachInterrupt necesita una función sin parámetros para cada pin.
void ARDUINO_ISR_ATTR onHallEdge() { onEdge(hall); }
void ARDUINO_ISR_ATTR onIrEdge() { onEdge(ir); }

// Devuelve true si un pin se puede usar para un sensor sin estropear nada.
bool allowedPin(int pin) {
  // Excluir USB, UART0, pines de arranque y memoria en este perfil.
  // En la ESP32-S3:
  //   0, 3, 45, 46  → pines de arranque: su nivel al encender decide cómo
  //                   arranca la placa (el 0 es el botón BOOT).
  //   19, 20        → el USB nativo de la placa.
  //   26 a 37       → conectados a la memoria flash y a la PSRAM del módulo.
  //   43, 44        → UART0: el puerto serie por el que se carga el firmware
  //                   y salen los mensajes de Serial (conector "UART").
  // GPIO_IS_VALID_GPIO además descarta números que no existen en este chip.
  return GPIO_IS_VALID_GPIO(pin) && pin != 0 && pin != 3 && pin != 19 && pin != 20 &&
         !(pin >= 26 && pin <= 37) && pin != 43 && pin != 44 && pin != 45 && pin != 46;
}

// Prepara un pin de sensor: entrada (con resistencia interna a 3,3 V) y una
// interrupción en cada cambio de la señal.
void setupPulseInput(PulseInput& in, void (*isr)()) {
  in.enabled = allowedPin(in.pin);
  if (!in.enabled) { Serial.printf("ERROR pin %d no permitido para un sensor\n", in.pin); return; }
  pinMode(in.pin, Config::SENSOR_PULLUP ? INPUT_PULLUP : INPUT);
  // Estado inicial: si la señal ya está en alto, el primer bajón contará.
  in.armed = digitalRead(in.pin) == HIGH;
  in.lastHighUs = micros() - Config::MIN_HIGH_US;
  attachInterrupt(digitalPinToInterrupt(in.pin), isr, CHANGE);
}

// Copia el contador y la hora del último pulso con el cerrojo cerrado, para
// que no cambien a mitad de la lectura.
void readPulses(PulseInput& in, uint32_t& count, uint32_t& lastUs) {
  portENTER_CRITICAL(&pulseMux);
  count = in.count; lastUs = in.lastPulseUs;
  portEXIT_CRITICAL(&pulseMux);
}

// Sensor elegido para las RPM.
PulseInput& activeInput() { return source == SOURCE_IR ? ir : hall; }

// Hay RPM medibles si se configuraron los pulsos por vuelta y el pin del
// sensor elegido es válido.
bool rpmReady() { return ppr > 0 && activeInput().enabled; }

// Olvida el cálculo de RPM anterior (al cambiar de sensor, de pulsos por
// vuelta o al poner los contadores a cero), para no mezclar datos.
void resetRpm() {
  uint32_t count, lastUs;
  readPulses(activeInput(), count, lastUs);
  estimator = RpmEstimator{};
  estimator.refCount = count;
  measuredRpm = rpmReady() ? 0.0f : NAN;
}

// Calcula las RPM del sensor elegido. Se llama cada 500 ms.
// Método: en lugar de contar pulsos en una ventana fija (que da RPM "a
// saltos"), mide el tiempo exacto entre pulsos:
//   RPM = pulsos nuevos × 60 000 000 / (µs entre el pulso de referencia y el
//         último pulso × pulsos por vuelta)
// Así una sola vuelta ya da una cifra precisa.
void updateRpm() {
  if (!rpmReady()) { measuredRpm = NAN; estimator.hasRef = false; return; }
  uint32_t count, lastUs;
  readPulses(activeInput(), count, lastUs);
  const uint32_t now = micros();
  if (count != estimator.refCount) {
    // Han llegado pulsos nuevos.
    if (estimator.hasRef) {
      const uint32_t dt = lastUs - estimator.refUs;
      if (dt > 0) estimator.rpm = (count - estimator.refCount) * 60e6f / (float(dt) * ppr);
    } else {
      // Primer pulso tras estar parado: solo sirve de referencia. Las RPM se
      // calcularán con el siguiente.
      estimator.rpm = 0;
    }
    estimator.refCount = count; estimator.refUs = lastUs; estimator.hasRef = true;
  } else if (estimator.hasRef) {
    // Ningún pulso nuevo desde la última revisión.
    const uint32_t idle = now - estimator.refUs;
    if (idle >= Config::RPM_TIMEOUT_MS * 1000UL) {
      // Demasiado tiempo sin pulsos: se considera parado.
      estimator.hasRef = false; estimator.rpm = 0;
    } else {
      // Si en "idle" µs no ha llegado ningún pulso, el rotor no puede ir más
      // rápido que una vuelta cada idle × ppr µs. Así la cifra baja de forma
      // realista cuando el rotor frena, en vez de congelarse.
      estimator.rpm = fminf(estimator.rpm, 60e6f / (float(idle) * ppr));
    }
  }
  measuredRpm = estimator.rpm;
}

// =============================================================================
// 3. INA219
// =============================================================================

// Comprueba si un pin llega a 3,3 V a través de una resistencia externa: se
// activa la resistencia interna hacia 0 V (más débil que la del módulo) y se
// lee. Si se lee alto, algo lo sujeta a 3,3 V: el módulo INA219 alimentado.
bool hasPullup(int pin) {
  pinMode(pin, INPUT_PULLDOWN); delayMicroseconds(100);
  return digitalRead(pin) == HIGH;
}
// Comprueba si un pin está clavado a 0 V: se activa la resistencia interna
// hacia 3,3 V y se lee. Si aun así se lee bajo, está unido a GND.
bool isStuckLow(int pin) {
  pinMode(pin, INPUT_PULLUP); delayMicroseconds(100);
  return digitalRead(pin) == LOW;
}

// Busca el INA219: revisa las líneas, recorre todas las direcciones I2C
// posibles y, si alguna entre 0x40 y 0x4F responde, prepara el INA219 allí.
void detectIna() {
  // 1. Se suelta el bus para poder revisar las líneas como pines normales.
  Wire.end();
  i2cStuck = isStuckLow(Config::SDA_PIN) || isStuckLow(Config::SCL_PIN);
  sdaPullup = hasPullup(Config::SDA_PIN);
  sclPullup = hasPullup(Config::SCL_PIN);
  // 2. Se arranca el bus I2C en sus pines a 100 kHz (velocidad estándar, la
  //    más tolerante con cables largos). Si el sensor no contesta en 50 ms,
  //    se da por fallida la operación en vez de esperar para siempre.
  Wire.begin(Config::SDA_PIN, Config::SCL_PIN, 100000);
  Wire.setTimeOut(50);
  memset(i2cFound, 0, sizeof(i2cFound)); i2cCount = 0;
  uint8_t found = 0;
  // 3. Con una línea clavada a 0 V el bus no funciona: no se busca nada.
  if (!i2cStuck) {
    // Se "llama" a cada dirección; quien exista contesta (endTransmission = 0).
    for (uint8_t address = 0x08; address <= 0x77; ++address) {
      Wire.beginTransmission(address);
      if (Wire.endTransmission() != 0) continue;
      if (i2cCount < sizeof(i2cFound)) i2cFound[i2cCount] = address;
      if (i2cCount < 255) ++i2cCount;
      // El INA219 solo puede estar entre 0x40 y 0x4F (según sus puentes A0/A1).
      if (!found && address >= 0x40 && address <= 0x4f) found = address;
    }
  }
  inaReady = false; inaFailures = 0;
  if (found) {
    // Se crea el objeto para esa dirección (o se reutiliza si es la misma).
    if (!ina || inaAddress != found) { delete ina; ina = new Adafruit_INA219(found); }
    inaAddress = found;
    inaReady = ina->begin(&Wire);
    // Carga la calibración 16 V / 400 mA y comprueba que se escribió bien.
    if (inaReady) { ina->setCalibration_16V_400mA(); inaReady = ina->success(); }
  } else {
    inaAddress = 0;
  }
  Serial.printf("I2C: %u dispositivo(s), INA219 %s 0x%02X, SDA %s, SCL %s%s\n", i2cCount,
                inaReady ? "listo en" : "no encontrado", inaAddress,
                sdaPullup ? "con pull-up" : "sin pull-up", sclPullup ? "con pull-up" : "sin pull-up",
                i2cStuck ? " | LINEA A 0 V" : "");
}

// Se llama cada 3 s. Si el INA219 estaba listo, comprueba que sigue
// contestando; si no lo estaba (o se ha perdido), lo vuelve a buscar.
void checkIna() {
  if (inaReady) {
    // En modo REAL ya se lee en cada muestra; sample() cuenta los fallos.
    if (mode == REAL) return;
    Wire.beginTransmission(inaAddress);
    if (Wire.endTransmission() == 0) { inaFailures = 0; return; }
    if (++inaFailures < 2) return;
    inaReady = false;
    Serial.println("INA219 perdido: se buscará de nuevo");
  }
  detectIna();
}

// =============================================================================
// 4. Órdenes recibidas por Bluetooth
// =============================================================================

// Envía una respuesta al móvil por la característica de control y la escribe
// también en el monitor serie (útil para depurar con el cable USB).
void reply(const char* message) {
  control->setValue(message);  // Guarda el texto en la característica...
  control->notify();           // ...y avisa al móvil de que ha cambiado.
  Serial.println(message);
}

// Esta clase define qué hacer cuando el móvil escribe en la característica de
// control. NimBLE llama a onWrite() automáticamente, desde la tarea del
// Bluetooth, cada vez que llega una orden.
class ControlCallbacks : public NimBLECharacteristicCallbacks {
  void onWrite(NimBLECharacteristic* characteristic, NimBLEConnInfo&) override {
    auto value = characteristic->getValue();  // Bytes recibidos.
    // Rechaza órdenes vacías o de más de 20 caracteres (no caben en Command).
    if (value.length() == 0 || value.length() > 20) { reply("ERR COMMAND"); return; }
    // "{}" rellena la orden con ceros, así el texto copiado queda terminado
    // en '\0' automáticamente.
    Command command{};
    memcpy(command.text, value.data(), value.length());
    // Solo se aceptan caracteres imprimibles (códigos ASCII 32 a 126): letras,
    // números, espacio, ':'... Cualquier otro byte indica una orden corrupta.
    for (size_t i = 0; i < value.length(); ++i) {
      if (command.text[i] < 32 || command.text[i] > 126) { reply("ERR COMMAND"); return; }
    }
    // Deja la orden en la cola para que loop() la ejecute. El 0 significa "no
    // esperar": si la cola está llena (8 órdenes pendientes), responde que la
    // placa está ocupada en lugar de bloquear el Bluetooth.
    if (xQueueSend(commands, &command, 0) != pdTRUE) reply("ERR BUSY");
  }
} controlCallbacks;  // Se crea aquí mismo el único objeto de esta clase.

// Comprueba si "command" empieza por "prefix" seguido de un número entero de
// 1 a 4 cifras, y guarda ese número en "result".
// Ejemplo: numberAfter("SPEED:300", "SPEED:", n) → devuelve true y n = 300.
// Devuelve false para "SPEED:", "SPEED:3a0" o "SPEED:12345".
bool numberAfter(const char* command, const char* prefix, unsigned& result) {
  size_t len = strlen(prefix);
  // strncmp da 0 si los primeros "len" caracteres coinciden. Falla si no
  // empieza por el prefijo, si no hay nada detrás o si hay más de 4 cifras.
  if (strncmp(command, prefix, len) || !command[len] || strlen(command + len) > 4) return false;
  char* end;
  // Todo lo que va detrás del prefijo tiene que ser una cifra del 0 al 9.
  for (const char* p = command + len; *p; ++p) if (*p < '0' || *p > '9') return false;
  // Convierte el texto a número. "end" queda apuntando al primer carácter que
  // no se pudo convertir; si apunta al final del texto, se convirtió todo.
  result = strtoul(command + len, &end, 10);
  return *end == 0;
}

// Ejecuta una orden ya validada. Órdenes que entiende:
//   MODE:DEMO     → modo demostración (y velocidad simulada a 0).
//   MODE:REAL     → sensores reales; necesita el INA219 listo. Las RPM se
//                   miden si están configuradas; si no, van como "sin dato".
//   MODE:MIXED    → RPM reales y electricidad simulada; necesita RPM listas.
//   SPEED:n       → velocidad simulada de 0 a 1200 RPM; solo en modo DEMO.
//   TURNS:n       → toma de la bobina: 200, 400, 600 o 655.
//   PPR:n         → pulsos por vuelta, de 0 (sin configurar) a 64. Se guarda.
//   SRC:HALL      → las RPM salen del sensor Hall. Se guarda.
//   SRC:IR        → las RPM salen del sensor infrarrojo. Se guarda.
//   RESET:PULSES  → pone a cero los contadores de pulsos de los dos sensores.
//   SCAN          → vuelve a buscar el INA219 en el bus I2C.
// Si la orden se aplica, responde "OK <orden>"; si no, "ERR <motivo>".
void processCommand(const char* text) {
  unsigned n;
  // strcmp da 0 cuando los dos textos son iguales, por eso se niega con "!".
  if (!strcmp(text, "MODE:DEMO")) { mode = DEMO; demoSpeed = 0; }
  else if (!strcmp(text, "MODE:REAL")) {
    if (!inaReady) { reply("ERR CONFIG_REAL"); return; }
    mode = REAL; inaFailures = 0;
  } else if (!strcmp(text, "MODE:MIXED")) {
    if (!rpmReady()) { reply("ERR CONFIG_RPM"); return; }
    mode = MIXED;
  } else if (numberAfter(text, "SPEED:", n) && n <= 1200) {
    // La velocidad simulada solo tiene sentido en DEMO; en los otros modos
    // las RPM vienen del sensor.
    if (mode != DEMO) { reply("ERR NOT_DEMO"); return; }
    demoSpeed = n;
  } else if (numberAfter(text, "TURNS:", n) && validTurns(n)) turns = n;
  else if (numberAfter(text, "PPR:", n) && n <= Config::MAX_PPR) {
    // Quitar los pulsos por vuelta dejaría el modo MIXTO sin RPM.
    if (n == 0 && mode == MIXED) { reply("ERR CONFIG_RPM"); return; }
    ppr = n; settings.putUChar("ppr", ppr); resetRpm();
  } else if (!strcmp(text, "SRC:HALL") || !strcmp(text, "SRC:IR")) {
    const RpmSource next = text[4] == 'I' ? SOURCE_IR : SOURCE_HALL;
    if (!(next == SOURCE_IR ? ir : hall).enabled) { reply("ERR CONFIG_RPM"); return; }
    source = next; settings.putUChar("src", source); resetRpm();
  } else if (!strcmp(text, "RESET:PULSES")) {
    portENTER_CRITICAL(&pulseMux);
    hall.count = 0; ir.count = 0;
    portEXIT_CRITICAL(&pulseMux);
    resetRpm();
  } else if (!strcmp(text, "SCAN")) detectIna();
  else { reply("ERR COMMAND"); return; }  // Orden desconocida o valor fuera de rango.
  // Respuesta de confirmación: "OK " (3) + orden (hasta 20) + '\0' (1) = 24 caracteres.
  char response[24];
  snprintf(response, sizeof(response), "OK %s", text);
  reply(response);
}

// =============================================================================
// 5. sample(): prepara y envía una lectura
// =============================================================================
// Se llama cada 500 ms desde loop(). Reúne RPM, tensión y corriente según el
// modo, decide el estado, empaqueta todo en 20 bytes y lo envía al móvil.
void sample() {
  // RPM: en DEMO, la velocidad simulada; en REAL y MIXED, la medida.
  float rpm = mode == DEMO ? float(demoSpeed) : measuredRpm;
  // Tensión y corriente empiezan como "sin dato" (NAN).
  float voltage = NAN, current = NAN;
  // "Protocol::" se escribe explícitamente para no confundir este OK con
  // otros nombres OK de otras bibliotecas.
  Status status = Protocol::OK;
  // Banderas de qué sensores están listos ahora mismo.
  uint8_t flags = (rpmReady() ? RPM_READY : 0) | (inaReady ? INA_READY : 0);
  // isfinite() es true si es un número normal (no NAN ni infinito).
  if (isfinite(rpm)) flags |= RPM_VALID;
  if (mode == REAL) {
    // ---- Modo REAL: se mide la electricidad con el INA219 ----
    if (inaReady) {
      voltage = ina->getBusVoltage_V();  // Tensión en la carga, en voltios.
      bool success = ina->success();     // ¿Funcionó la lectura?
      current = ina->getCurrent_mA();    // Corriente, en miliamperios.
      success = ina->success() && success;  // Ambas lecturas deben haber funcionado.
      // Comprobar también el bit de desbordamiento del INA219 (bus register).
      // Se lee directamente el registro 0x02 del sensor (tensión del bus): su
      // bit 0 se pone a 1 cuando el cálculo interno se sale de rango.
      Wire.beginTransmission(inaAddress); Wire.write(0x02);  // "Quiero leer el registro 0x02"...
      bool busOk = Wire.endTransmission(false) == 0;         // ...(false = sin soltar el bus entre medias).
      uint16_t bus = 0;
      if (busOk && Wire.requestFrom(inaAddress, uint8_t(2)) == 2) {
        // Llegan 2 bytes, primero el alto; se unen en un número de 16 bits.
        bus = (Wire.read() << 8) | Wire.read();
      } else busOk = false;
      // Se decide el estado de la lectura:
      if (!success || !busOk || !isfinite(voltage) || !isfinite(current)) status = INA_ERROR;  // Fallo de comunicación.
      else if ((bus & 1) || voltage >= 16.0f || fabsf(current) >= 400.0f) status = RANGE_ERROR;  // Fuera de 16 V / 400 mA.
      else flags |= ELECTRIC_VALID;  // Lectura buena.
      // Tres fallos de comunicación seguidos: se da el INA219 por perdido y
      // loop() lo volverá a buscar. El modo sigue siendo REAL (nunca se
      // cambia solo a datos simulados).
      if (status == INA_ERROR) { if (++inaFailures >= 3) { inaReady = false; flags &= ~INA_READY; } }
      else inaFailures = 0;
      // Si la lectura no es buena, no se envía ningún número: mejor "sin dato"
      // que un valor falso que parezca real.
      if (!(flags & ELECTRIC_VALID)) { voltage = NAN; current = NAN; }
    } else status = INA_ERROR;  // En REAL sin INA219 (desconectado): error de lectura.
  } else if (isfinite(rpm)) {
    // ---- Modos DEMO y MIXED: electricidad simulada a partir de las RPM ----
    voltage = demoVoltage(rpm, turns);
    current = voltage * 10.0f; // carga ilustrativa 100 ohmios; no medición.
    // (Ley de Ohm: I = V / R = V / 100 Ω, que en miliamperios es V × 10.)
    flags |= ELECTRIC_VALID;
  }
  // Fuera de DEMO, con RPM configuradas, 0 RPM significa que no llegan
  // pulsos: puede que el rotor esté parado o que el sensor no funcione.
  if (mode != DEMO && status == Protocol::OK && rpmReady() && (!isfinite(rpm) || rpm == 0)) status = NO_PULSES;
  // Empaqueta todo en 20 bytes (ver encode en protocol.h). "sequence++" usa el
  // número actual y después lo aumenta en 1 para el siguiente paquete.
  uint8_t packet[20];
  encode(packet, mode, flags, status, sequence++, turns, rpm, voltage, current);
  // Guarda el paquete en la característica de telemetría (así también se
  // puede leer bajo petición)...
  telemetry->setValue(packet, sizeof(packet));
  // ...y, si hay un móvil conectado, se lo envía como notificación.
  if (NimBLEDevice::getServer()->getConnectedCount()) telemetry->notify();
  // Copia legible en el monitor serie, para comprobar con el cable USB.
  Serial.printf("mode=%u turns=%u rpm=%.1f V=%.3f mA=%.3f status=%u src=%s ppr=%u\n", mode, turns, rpm,
                voltage, current, status, source == SOURCE_IR ? "IR" : "HALL", ppr);
}

// =============================================================================
// 6. sendDiag(): envía el diagnóstico
// =============================================================================
// Se llama cada 200 ms. Solo envía si algo ha cambiado (un pulso nuevo, un
// sensor que empieza a detectar...) o si "force" es true (una vez por
// segundo), para no saturar el Bluetooth.
void sendDiag(bool force) {
  static uint8_t previous[20] = {};
  uint32_t hallCount, irCount, unused;
  readPulses(hall, hallCount, unused);
  readPulses(ir, irCount, unused);
  uint8_t flags = 0;
  // Nivel actual de cada sensor (0 V = detectando, en la mayoría de módulos).
  if (hall.enabled && digitalRead(hall.pin) == LOW) flags |= DIAG_HALL_LOW;
  if (ir.enabled && digitalRead(ir.pin) == LOW) flags |= DIAG_IR_LOW;
  if (inaReady) flags |= DIAG_INA_FOUND;
  if (source == SOURCE_IR) flags |= DIAG_SOURCE_IR;
  if (sdaPullup) flags |= DIAG_SDA_PULLUP;
  if (sclPullup) flags |= DIAG_SCL_PULLUP;
  if (i2cStuck) flags |= DIAG_I2C_STUCK;
  uint8_t packet[20];
  encodeDiag(packet, flags, inaReady ? inaAddress : 0, ppr, hallCount, irCount, i2cCount, i2cFound);
  // memcmp compara los 20 bytes: 0 = idénticos al último envío.
  if (!force && !memcmp(packet, previous, sizeof(packet))) return;
  memcpy(previous, packet, sizeof(packet));
  diagnostics->setValue(packet, sizeof(packet));
  if (NimBLEDevice::getServer()->getConnectedCount()) diagnostics->notify();
}

// =============================================================================
// 7. setup(): se ejecuta una vez al encender
// =============================================================================
void setup() {
  // Abre el puerto serie a 115200 baudios (la misma velocidad que usa el
  // monitor de PlatformIO) y espera medio segundo a que esté listo.
  Serial.begin(115200);
  delay(500);
  Serial.printf("\nGenerador Sara BLE %s | DEMO | 655 vueltas | NO controla el motor\n", FIRMWARE_VERSION);
  Serial.printf("Pines: SDA=%d SCL=%d Hall=%d IR=%d\n", Config::SDA_PIN, Config::SCL_PIN, Config::HALL_PIN, Config::IR_PIN);
  // Crea la cola de órdenes: caben 8 órdenes pendientes.
  commands = xQueueCreate(8, sizeof(Command));
  // Si no hubo memoria para la cola, el programa no puede funcionar: avisa y
  // se queda parado aquí para siempre.
  if (!commands) { Serial.println("ERROR memoria"); while (true) delay(1000); }

  // ---- Ajustes guardados ----
  // Abre el espacio "sara" de la memoria permanente (false = lectura y escritura)
  // y recupera los ajustes. Si no existen (primera vez), usa los valores por defecto.
  settings.begin("sara", false);
  ppr = settings.getUChar("ppr", 0);
  if (ppr > Config::MAX_PPR) ppr = 0;
  source = settings.getUChar("src", SOURCE_HALL) == SOURCE_IR ? SOURCE_IR : SOURCE_HALL;

  // ---- Sensores ----
  setupPulseInput(hall, onHallEdge);
  setupPulseInput(ir, onIrEdge);
  resetRpm();
  detectIna();

  // ---- Configuración del Bluetooth ----
  // Inicia el Bluetooth con el nombre que se verá en el móvil.
  NimBLEDevice::init("Generador Sara");
  // La placa actúa como "servidor": ofrece datos y el móvil se conecta a ella.
  auto server = NimBLEDevice::createServer();
  // Al desconectarse el móvil, vuelve a anunciarse para permitir reconectar.
  server->advertiseOnDisconnect(true);
  auto service = server->createService(SERVICE);
  // Característica de telemetría: se puede leer (READ) y suscribirse a
  // notificaciones (NOTIFY). Tamaño máximo: 20 bytes, un paquete.
  telemetry = service->createCharacteristic(TELEMETRY, NIMBLE_PROPERTY::READ | NIMBLE_PROPERTY::NOTIFY, 20);
  // Característica de control: el móvil escribe órdenes (WRITE) y recibe las
  // respuestas (READ y NOTIFY). Tamaño máximo: 24 bytes, la respuesta más larga.
  control = service->createCharacteristic(CONTROL, NIMBLE_PROPERTY::WRITE | NIMBLE_PROPERTY::READ | NIMBLE_PROPERTY::NOTIFY, 24);
  control->setCallbacks(&controlCallbacks);  // Enlaza onWrite() con esta característica.
  // Valor inicial. Se pasa como std::string para que NimBLE use la longitud
  // real del texto (5 bytes), sin el '\0' final.
  control->setValue(std::string("READY"));
  // Característica de diagnóstico: lectura y notificaciones, 20 bytes.
  diagnostics = service->createCharacteristic(DIAG, NIMBLE_PROPERTY::READ | NIMBLE_PROPERTY::NOTIFY, 20);
  // Característica de información: solo lectura.
  auto info = service->createCharacteristic(INFO, NIMBLE_PROPERTY::READ);
  // Construye el texto JSON con la versión, los pines y el estado de los
  // sensores al arrancar, por ejemplo:
  //   {"protocol":1,"firmware":"1.1.0","finalTurns":655,"diag":1,"sda":8,
  //    "scl":9,"hall":6,"ir":7,"rpmReady":false,"inaReady":true,"ppr":0}
  // snprintf escribe el texto sustituyendo cada %s, %d o %u por los valores
  // que van detrás, sin pasarse nunca del tamaño del búfer (200).
  char metadata[200];
  snprintf(metadata, sizeof(metadata),
    "{\"protocol\":1,\"firmware\":\"%s\",\"finalTurns\":655,\"diag\":1,\"sda\":%d,\"scl\":%d,\"hall\":%d,\"ir\":%d,"
    "\"rpmReady\":%s,\"inaReady\":%s,\"ppr\":%u}",
    FIRMWARE_VERSION, Config::SDA_PIN, Config::SCL_PIN, Config::HALL_PIN, Config::IR_PIN,
    rpmReady() ? "true" : "false", inaReady ? "true" : "false", ppr);
  // Longitud explícita: con un char[] NimBLE enviaría los 200 bytes, incluidos los '\0'.
  // (Este era el fallo de la versión 1.0.0: la web recibía el JSON seguido de
  // basura y no podía leerlo.)
  info->setValue(reinterpret_cast<const uint8_t*>(metadata), strlen(metadata));
  service->start();  // Publica el servicio con sus cuatro características.
  // Primera lectura y primer diagnóstico, para que ya tengan valor antes de
  // que se conecte nadie.
  sample();
  sendDiag(true);
  // "Anuncio" (advertising): la señal que emite la placa para que los móviles
  // la encuentren al buscar dispositivos.
  auto advertising = NimBLEDevice::getAdvertising();
  // Incluye el UUID del servicio: la web solo muestra placas que lo anuncian.
  advertising->addServiceUUID(SERVICE);
  // El anuncio solo admite 31 bytes y el UUID ya ocupa 18; la "respuesta de
  // escaneo" da espacio extra para que también quepa el nombre.
  advertising->enableScanResponse(true);
  advertising->setName("Generador Sara");
  advertising->start();
  Serial.println("BLE listo: busca Generador Sara desde monitor.html");
}

// =============================================================================
// 8. loop(): se repite sin parar
// =============================================================================
void loop() {
  // a) Si hay alguna orden en la cola, la ejecuta (una por vuelta). El 0
  //    significa "no esperar": si no hay órdenes, sigue adelante.
  Command command;
  if (xQueueReceive(commands, &command, 0) == pdTRUE) processCommand(command.text);

  // millis() da los milisegundos desde el arranque. Restar números sin signo
  // funciona bien incluso cuando millis() se desborda y vuelve a 0 (cada
  // 49,7 días). "static" hace que estas variables conserven su valor entre
  // una vuelta de loop() y la siguiente.
  const uint32_t now = millis();
  static uint32_t lastI2c = 0, lastSample = 0, lastDiag = 0, lastDiagForced = 0;

  // b) Cada 3 s: comprobar el INA219 o volver a buscarlo.
  if (now - lastI2c >= Config::I2C_CHECK_MS) { lastI2c = now; checkIna(); }

  // c) Cada 500 ms: calcular RPM y enviar una lectura.
  if (now - lastSample >= Config::SAMPLE_MS) { lastSample = now; updateRpm(); sample(); }

  // d) Cada 200 ms: enviar el diagnóstico si ha cambiado (y una vez por
  //    segundo aunque no cambie).
  if (now - lastDiag >= Config::DIAG_MS) {
    lastDiag = now;
    const bool force = now - lastDiagForced >= 1000;
    if (force) lastDiagForced = now;
    sendDiag(force);
  }

  // e) Pequeña pausa de 5 ms para dejar tiempo al resto de tareas del sistema
  //    (entre ellas, el Bluetooth).
  delay(5);
}
