// =============================================================================
// main.cpp · Programa principal del Generador Sara (firmware 1.0.1)
// =============================================================================
//
// Qué hace este programa:
//   - Convierte la ESP32 en un dispositivo Bluetooth llamado "Generador Sara"
//     al que se conecta la web del monitor (monitor.html) desde el móvil.
//   - Cada 500 ms prepara una lectura (RPM, voltios, miliamperios) y la envía
//     al móvil. En modo DEMO la lectura es simulada; en REAL y MIXED viene de
//     los sensores (cuando estén configurados en config.h).
//   - Recibe órdenes del móvil: cambiar de modo, elegir la toma de la bobina y
//     fijar la velocidad simulada. Responde "OK ..." o "ERR ...".
//
// Qué NO hace: no controla el motor ni ninguna salida. Solo mide y simula.
//
// Cómo funciona un programa de Arduino:
//   - setup() se ejecuta una sola vez al encender o reiniciar la placa.
//   - loop() se ejecuta después una y otra vez, sin parar, mientras haya corriente.
//
// Organización de este archivo:
//   1. Variables globales (el estado de la placa).
//   2. Sensores: contador de pulsos y preparación del INA219.
//   3. Órdenes recibidas por Bluetooth.
//   4. sample(): prepara y envía cada lectura.
//   5. setup(): arranque.
//   6. loop(): bucle principal.
// =============================================================================

#include <Arduino.h>          // Base de Arduino: pinMode, millis, Serial...
#include <Wire.h>             // Bus I2C, para hablar con el INA219.
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

// Punteros a dos características BLE (ver protocol.h). Se crean en setup() y
// se usan después para enviar lecturas (telemetry) y respuestas (control).
NimBLECharacteristic *telemetry, *control;

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

// Si cada sensor quedó configurado correctamente en el arranque.
bool rpmReady = false, inaReady = false;

// Últimas RPM medidas. NAN ("not a number") significa "todavía no hay dato".
float measuredRpm = NAN;

// Objeto que maneja el INA219 en la dirección I2C configurada. Crearlo no
// hace nada con el hardware; solo se usa si prepareSensors() lo activa.
Adafruit_INA219 ina(Config::INA_ADDRESS);

// Cerrojo para proteger pulseCount. La ESP32-S3 tiene dos núcleos y el
// contador lo modifican a la vez la interrupción del sensor y loop(); el
// cerrojo garantiza que nunca lo toquen los dos al mismo tiempo.
portMUX_TYPE pulseMux = portMUX_INITIALIZER_UNLOCKED;

// Pulsos contados desde la última vez que se calcularon las RPM.
// "volatile" avisa al compilador de que esta variable puede cambiar en
// cualquier momento (desde la interrupción), así que debe leerla siempre de
// la memoria en lugar de suponer que sigue igual.
volatile uint32_t pulseCount = 0;

// Momento (en milisegundos desde el arranque) en que empezó la ventana
// actual de conteo de pulsos.
uint32_t rpmTime = 0;

// =============================================================================
// 2. Sensores
// =============================================================================

// Rutina de interrupción: la ESP32 la ejecuta AUTOMÁTICAMENTE cada vez que
// llega un pulso del sensor de RPM, interrumpiendo lo que estuviera haciendo.
// Debe ser lo más corta posible: solo suma 1 al contador.
// ARDUINO_ISR_ATTR la guarda en la memoria interna rápida (IRAM), para que
// pueda ejecutarse incluso mientras la memoria flash está ocupada.
void ARDUINO_ISR_ATTR countPulse() {
  portENTER_CRITICAL_ISR(&pulseMux);  // Cierra el cerrojo.
  ++pulseCount;
  portEXIT_CRITICAL_ISR(&pulseMux);   // Lo abre de nuevo.
}

// Devuelve true si un pin se puede usar para un sensor sin estropear nada.
bool allowedPin(int pin) {
  // Excluir USB, UART0, pines de arranque y memoria en este perfil.
  // En la ESP32-S3 (módulo N16R8):
  //   0, 3, 45, 46  → pines de arranque: su nivel al encender decide cómo
  //                   arranca la placa (el 0 es el botón BOOT).
  //   19, 20        → el USB nativo de la placa.
  //   26 a 37       → conectados a la memoria flash y a la PSRAM del módulo.
  //   43, 44        → UART0: el puerto serie por el que se carga el firmware
  //                   y salen los mensajes de Serial (conector "UART").
  // GPIO_IS_VALID_GPIO además descarta números que no existen en este chip
  // (por ejemplo, el -1 de "sin configurar").
  return GPIO_IS_VALID_GPIO(pin) && pin != 0 && pin != 3 && pin != 19 && pin != 20 &&
         !(pin >= 26 && pin <= 37) && pin != 43 && pin != 44 && pin != 45 && pin != 46;
}

// Activa los sensores que estén configurados y verificados en config.h.
// Con la configuración actual (todo a false / -1) no activa ninguno, y la
// placa queda solo en modo DEMO.
void prepareSensors() {
  // El sensor de RPM está listo si: se marcó como verificado, su pin es
  // válido y se indicaron los pulsos por vuelta.
  rpmReady = Config::RPM_VERIFIED && allowedPin(Config::RPM_PIN) && Config::PULSES_PER_REV > 0;
  // El INA219 se intenta activar si TODO esto se cumple:
  const bool i2cConfig = Config::INA_VERIFIED && Config::INA_16V_400MA_APPROVED &&  // verificado y rango aprobado,
      allowedPin(Config::SDA_PIN) && allowedPin(Config::SCL_PIN) &&                // pines SDA y SCL válidos,
      Config::SDA_PIN != Config::SCL_PIN &&                                        // distintos entre sí,
      (!rpmReady || (Config::RPM_PIN != Config::SDA_PIN && Config::RPM_PIN != Config::SCL_PIN)) &&  // sin compartir pin con el sensor de RPM,
      Config::INA_ADDRESS >= 0x40 && Config::INA_ADDRESS <= 0x4f;                  // y dirección I2C posible para un INA219.
  if (rpmReady) {
    // Configura el pin como entrada (con o sin resistencia interna) y pide a
    // la ESP32 que llame a countPulse() en cada flanco elegido.
    pinMode(Config::RPM_PIN, Config::RPM_PULLUP ? INPUT_PULLUP : INPUT);
    attachInterrupt(digitalPinToInterrupt(Config::RPM_PIN), countPulse, Config::RPM_EDGE);
  }
  if (i2cConfig) {
    // Arranca el bus I2C en esos pines a 100 kHz (velocidad estándar, la más
    // tolerante con cables largos).
    Wire.begin(Config::SDA_PIN, Config::SCL_PIN, 100000);
    // Si el sensor no contesta en 50 ms, se da por fallida la operación en
    // lugar de quedarse esperando para siempre.
    Wire.setTimeOut(50);
    inaReady = ina.begin(&Wire);  // true si el INA219 responde.
    // Carga la calibración para 16 V / 400 mA y comprueba que se escribió bien.
    if (inaReady) { ina.setCalibration_16V_400mA(); inaReady = ina.success(); }
  }
}

// =============================================================================
// 3. Órdenes recibidas por Bluetooth
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
//   MODE:REAL     → sensores reales; solo si RPM e INA219 están listos.
//   MODE:MIXED    → RPM reales y electricidad simulada; solo si RPM está listo.
//   SPEED:n       → velocidad simulada de 0 a 1200 RPM; solo en modo DEMO.
//   TURNS:n       → toma de la bobina: 200, 400, 600 o 655.
// Si la orden se aplica, responde "OK <orden>"; si no, "ERR <motivo>".
void processCommand(const char* text) {
  unsigned n;
  // strcmp da 0 cuando los dos textos son iguales, por eso se niega con "!".
  if (!strcmp(text, "MODE:DEMO")) { mode = DEMO; demoSpeed = 0; }
  else if (!strcmp(text, "MODE:REAL")) {
    if (!rpmReady || !inaReady) { reply("ERR CONFIG_REAL"); return; }
    mode = REAL;
  } else if (!strcmp(text, "MODE:MIXED")) {
    if (!rpmReady) { reply("ERR CONFIG_RPM"); return; }
    mode = MIXED;
  } else if (numberAfter(text, "SPEED:", n) && n <= 1200) {
    // La velocidad simulada solo tiene sentido en DEMO; en los otros modos
    // las RPM vienen del sensor.
    if (mode != DEMO) { reply("ERR NOT_DEMO"); return; }
    demoSpeed = n;
  } else if (numberAfter(text, "TURNS:", n) && validTurns(n)) turns = n;
  else { reply("ERR COMMAND"); return; }  // Orden desconocida o valor fuera de rango.
  // Respuesta de confirmación: "OK " (3) + orden (hasta 20) + '\0' (1) = 24 caracteres.
  char response[24];
  snprintf(response, sizeof(response), "OK %s", text);
  reply(response);
}

// =============================================================================
// 4. sample(): prepara y envía una lectura
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
  // Banderas de qué sensores están configurados.
  uint8_t flags = (rpmReady ? RPM_READY : 0) | (inaReady ? INA_READY : 0);
  // isfinite() es true si es un número normal (no NAN ni infinito).
  if (isfinite(rpm)) flags |= RPM_VALID;
  if (mode == REAL) {
    // ---- Modo REAL: se mide la electricidad con el INA219 ----
    if (inaReady) {
      voltage = ina.getBusVoltage_V();  // Tensión en la carga, en voltios.
      bool success = ina.success();     // ¿Funcionó la lectura?
      current = ina.getCurrent_mA();    // Corriente, en miliamperios.
      success = ina.success() && success;  // Ambas lecturas deben haber funcionado.
      // Comprobar también el bit de desbordamiento del INA219 (bus register).
      // Se lee directamente el registro 0x02 del sensor (tensión del bus): su
      // bit 0 se pone a 1 cuando el cálculo interno se sale de rango.
      Wire.beginTransmission(Config::INA_ADDRESS); Wire.write(0x02);  // "Quiero leer el registro 0x02"...
      bool busOk = Wire.endTransmission(false) == 0;  // ...(false = sin soltar el bus entre medias).
      uint16_t bus = 0;
      if (busOk && Wire.requestFrom(Config::INA_ADDRESS, uint8_t(2)) == 2) {
        // Llegan 2 bytes, primero el alto; se unen en un número de 16 bits.
        bus = (Wire.read() << 8) | Wire.read();
      } else busOk = false;
      // Se decide el estado de la lectura:
      if (!success || !busOk || !isfinite(voltage) || !isfinite(current)) status = INA_ERROR;  // Fallo de comunicación.
      else if ((bus & 1) || voltage >= 16.0f || fabsf(current) >= 400.0f) status = RANGE_ERROR;  // Fuera de 16 V / 400 mA.
      else flags |= ELECTRIC_VALID;  // Lectura buena.
      // Si la lectura no es buena, no se envía ningún número: mejor "sin dato"
      // que un valor falso que parezca real.
      if (!(flags & ELECTRIC_VALID)) { voltage = NAN; current = NAN; }
    } else status = CONFIG_ERROR;  // Se pidió REAL sin INA219 configurado.
  } else if (isfinite(rpm)) {
    // ---- Modos DEMO y MIXED: electricidad simulada a partir de las RPM ----
    voltage = demoVoltage(rpm, turns);
    current = voltage * 10.0f; // carga ilustrativa 100 ohmios; no medición.
    // (Ley de Ohm: I = V / R = V / 100 Ω, que en miliamperios es V × 10.)
    flags |= ELECTRIC_VALID;
  }
  // Fuera de DEMO, 0 RPM o ninguna medida significa que no llegan pulsos:
  // puede que el rotor esté parado o que el sensor no funcione.
  if (mode != DEMO && status == Protocol::OK && (!isfinite(rpm) || rpm == 0)) status = NO_PULSES;
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
  Serial.printf("mode=%u turns=%u rpm=%.1f V=%.3f mA=%.3f status=%u\n", mode, turns, rpm, voltage, current, status);
}

// =============================================================================
// 5. setup(): se ejecuta una vez al encender
// =============================================================================
void setup() {
  // Abre el puerto serie a 115200 baudios (la misma velocidad que usa el
  // monitor de PlatformIO) y espera medio segundo a que esté listo.
  Serial.begin(115200);
  delay(500);
  Serial.println("\nGenerador Sara BLE 1.0.1 | DEMO | 655 vueltas | NO controla el motor");
  // Crea la cola de órdenes: caben 8 órdenes pendientes.
  commands = xQueueCreate(8, sizeof(Command));
  // Si no hubo memoria para la cola, el programa no puede funcionar: avisa y
  // se queda parado aquí para siempre.
  if (!commands) { Serial.println("ERROR memoria"); while (true) delay(1000); }
  prepareSensors();
  rpmTime = millis();  // Empieza la primera ventana de conteo de RPM.

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
  // Característica de información: solo lectura.
  auto info = service->createCharacteristic(INFO, NIMBLE_PROPERTY::READ);
  // Construye el texto JSON con la versión y el estado de los sensores, por
  // ejemplo: {"protocol":1,"firmware":"1.0.1","finalTurns":655,
  //           "rpmReady":false,"inaReady":false,"ppr":0}
  // snprintf escribe el texto sustituyendo cada %s o %u por los valores que
  // van detrás, sin pasarse nunca del tamaño del búfer (200).
  char metadata[200];
  snprintf(metadata, sizeof(metadata),
    "{\"protocol\":1,\"firmware\":\"1.0.1\",\"finalTurns\":655,\"rpmReady\":%s,\"inaReady\":%s,\"ppr\":%u}",
    rpmReady ? "true" : "false", inaReady ? "true" : "false", Config::PULSES_PER_REV);
  // Longitud explícita: con un char[] NimBLE enviaría los 200 bytes, incluidos los '\0'.
  // (Este era el fallo de la versión 1.0.0: la web recibía el JSON seguido de
  // basura y no podía leerlo.)
  info->setValue(reinterpret_cast<const uint8_t*>(metadata), strlen(metadata));
  service->start();  // Publica el servicio con sus tres características.
  // Primera lectura, para que la telemetría ya tenga un valor antes de que se
  // conecte nadie.
  sample();
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
// 6. loop(): se repite sin parar
// =============================================================================
void loop() {
  // a) Si hay alguna orden en la cola, la ejecuta (una por vuelta). El 0
  //    significa "no esperar": si no hay órdenes, sigue adelante.
  Command command;
  if (xQueueReceive(commands, &command, 0) == pdTRUE) processCommand(command.text);

  // b) Cálculo de RPM. millis() da los milisegundos desde el arranque.
  //    Restar números sin signo funciona bien incluso cuando millis() se
  //    desborda y vuelve a 0 (cada 49,7 días).
  const uint32_t now = millis();
  const uint32_t elapsed = now - rpmTime;
  if (elapsed >= Config::RPM_WINDOW_MS && rpmReady) {
    // Lee el contador y lo pone a 0 con el cerrojo cerrado, para que no se
    // pierda ningún pulso que llegue justo entre las dos operaciones.
    portENTER_CRITICAL(&pulseMux);
    uint32_t pulses = pulseCount; pulseCount = 0;
    portEXIT_CRITICAL(&pulseMux);
    // RPM = vueltas / minutos
    //     = (pulsos / pulsos por vuelta) / (milisegundos / 60000)
    measuredRpm = pulses * 60000.0f / (elapsed * float(Config::PULSES_PER_REV));
    rpmTime = now;  // Empieza una ventana nueva.
  }

  // c) Cada SAMPLE_MS (500 ms) prepara y envía una lectura. "static" hace que
  //    "previous" conserve su valor entre una vuelta de loop() y la siguiente.
  static uint32_t previous = 0;
  if (now - previous >= Config::SAMPLE_MS) { previous = now; sample(); }

  // d) Pequeña pausa de 5 ms para dejar tiempo al resto de tareas del sistema
  //    (entre ellas, el Bluetooth).
  delay(5);
}
