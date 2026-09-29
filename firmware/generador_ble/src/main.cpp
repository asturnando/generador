#include <Arduino.h>
#include <Wire.h>
#include <NimBLEDevice.h>
#include <Adafruit_INA219.h>
#include <driver/gpio.h>
#include "config.h"
#include "protocol.h"

using namespace Protocol;
NimBLECharacteristic *telemetry, *control;
QueueHandle_t commands;
struct Command { char text[21]; };
Mode mode = DEMO;
uint16_t turns = Config::FINAL_TURNS, demoSpeed = 0, sequence = 0;
bool rpmReady = false, inaReady = false;
float measuredRpm = NAN;
Adafruit_INA219 ina(Config::INA_ADDRESS);
portMUX_TYPE pulseMux = portMUX_INITIALIZER_UNLOCKED;
volatile uint32_t pulseCount = 0;
uint32_t rpmTime = 0;

void ARDUINO_ISR_ATTR countPulse() {
  portENTER_CRITICAL_ISR(&pulseMux);
  ++pulseCount;
  portEXIT_CRITICAL_ISR(&pulseMux);
}

bool allowedPin(int pin) {
  // Excluir USB, UART0, pines de arranque y memoria en este perfil.
  return GPIO_IS_VALID_GPIO(pin) && pin != 0 && pin != 3 && pin != 19 && pin != 20 &&
         !(pin >= 26 && pin <= 37) && pin != 43 && pin != 44 && pin != 45 && pin != 46;
}

void prepareSensors() {
  rpmReady = Config::RPM_VERIFIED && allowedPin(Config::RPM_PIN) && Config::PULSES_PER_REV > 0;
  const bool i2cConfig = Config::INA_VERIFIED && Config::INA_16V_400MA_APPROVED &&
      allowedPin(Config::SDA_PIN) && allowedPin(Config::SCL_PIN) &&
      Config::SDA_PIN != Config::SCL_PIN &&
      (!rpmReady || (Config::RPM_PIN != Config::SDA_PIN && Config::RPM_PIN != Config::SCL_PIN)) &&
      Config::INA_ADDRESS >= 0x40 && Config::INA_ADDRESS <= 0x4f;
  if (rpmReady) {
    pinMode(Config::RPM_PIN, Config::RPM_PULLUP ? INPUT_PULLUP : INPUT);
    attachInterrupt(digitalPinToInterrupt(Config::RPM_PIN), countPulse, Config::RPM_EDGE);
  }
  if (i2cConfig) {
    Wire.begin(Config::SDA_PIN, Config::SCL_PIN, 100000);
    Wire.setTimeOut(50);
    inaReady = ina.begin(&Wire);
    if (inaReady) { ina.setCalibration_16V_400mA(); inaReady = ina.success(); }
  }
}

void reply(const char* message) {
  control->setValue(message);
  control->notify();
  Serial.println(message);
}

class ControlCallbacks : public NimBLECharacteristicCallbacks {
  void onWrite(NimBLECharacteristic* characteristic, NimBLEConnInfo&) override {
    auto value = characteristic->getValue();
    if (value.length() == 0 || value.length() > 20) { reply("ERR COMMAND"); return; }
    Command command{};
    memcpy(command.text, value.data(), value.length());
    for (size_t i = 0; i < value.length(); ++i) {
      if (command.text[i] < 32 || command.text[i] > 126) { reply("ERR COMMAND"); return; }
    }
    if (xQueueSend(commands, &command, 0) != pdTRUE) reply("ERR BUSY");
  }
} controlCallbacks;

bool numberAfter(const char* command, const char* prefix, unsigned& result) {
  size_t len = strlen(prefix);
  if (strncmp(command, prefix, len) || !command[len] || strlen(command + len) > 4) return false;
  char* end;
  for (const char* p = command + len; *p; ++p) if (*p < '0' || *p > '9') return false;
  result = strtoul(command + len, &end, 10);
  return *end == 0;
}

void processCommand(const char* text) {
  unsigned n;
  if (!strcmp(text, "MODE:DEMO")) { mode = DEMO; demoSpeed = 0; }
  else if (!strcmp(text, "MODE:REAL")) {
    if (!rpmReady || !inaReady) { reply("ERR CONFIG_REAL"); return; }
    mode = REAL;
  } else if (!strcmp(text, "MODE:MIXED")) {
    if (!rpmReady) { reply("ERR CONFIG_RPM"); return; }
    mode = MIXED;
  } else if (numberAfter(text, "SPEED:", n) && n <= 1200) {
    if (mode != DEMO) { reply("ERR NOT_DEMO"); return; }
    demoSpeed = n;
  } else if (numberAfter(text, "TURNS:", n) && validTurns(n)) turns = n;
  else { reply("ERR COMMAND"); return; }
  char response[24];
  snprintf(response, sizeof(response), "OK %s", text);
  reply(response);
}

void sample() {
  float rpm = mode == DEMO ? float(demoSpeed) : measuredRpm;
  float voltage = NAN, current = NAN;
  Status status = Protocol::OK;
  uint8_t flags = (rpmReady ? RPM_READY : 0) | (inaReady ? INA_READY : 0);
  if (isfinite(rpm)) flags |= RPM_VALID;
  if (mode == REAL) {
    if (inaReady) {
      voltage = ina.getBusVoltage_V();
      bool success = ina.success();
      current = ina.getCurrent_mA();
      success = ina.success() && success;
      // Comprobar también el bit de desbordamiento del INA219 (bus register).
      Wire.beginTransmission(Config::INA_ADDRESS); Wire.write(0x02);
      bool busOk = Wire.endTransmission(false) == 0;
      uint16_t bus = 0;
      if (busOk && Wire.requestFrom(Config::INA_ADDRESS, uint8_t(2)) == 2) {
        bus = (Wire.read() << 8) | Wire.read();
      } else busOk = false;
      if (!success || !busOk || !isfinite(voltage) || !isfinite(current)) status = INA_ERROR;
      else if ((bus & 1) || voltage >= 16.0f || fabsf(current) >= 400.0f) status = RANGE_ERROR;
      else flags |= ELECTRIC_VALID;
      if (!(flags & ELECTRIC_VALID)) { voltage = NAN; current = NAN; }
    } else status = CONFIG_ERROR;
  } else if (isfinite(rpm)) {
    voltage = demoVoltage(rpm, turns);
    current = voltage * 10.0f; // carga ilustrativa 100 ohmios; no medición.
    flags |= ELECTRIC_VALID;
  }
  if (mode != DEMO && status == Protocol::OK && (!isfinite(rpm) || rpm == 0)) status = NO_PULSES;
  uint8_t packet[20];
  encode(packet, mode, flags, status, sequence++, turns, rpm, voltage, current);
  telemetry->setValue(packet, sizeof(packet));
  if (NimBLEDevice::getServer()->getConnectedCount()) telemetry->notify();
  Serial.printf("mode=%u turns=%u rpm=%.1f V=%.3f mA=%.3f status=%u\n", mode, turns, rpm, voltage, current, status);
}

void setup() {
  Serial.begin(115200);
  delay(500);
  Serial.println("\nGenerador Sara BLE 1.0.0 | DEMO | 655 vueltas | NO controla el motor");
  commands = xQueueCreate(8, sizeof(Command));
  if (!commands) { Serial.println("ERROR memoria"); while (true) delay(1000); }
  prepareSensors();
  rpmTime = millis();
  NimBLEDevice::init("Generador Sara");
  auto server = NimBLEDevice::createServer();
  server->advertiseOnDisconnect(true);
  auto service = server->createService(SERVICE);
  telemetry = service->createCharacteristic(TELEMETRY, NIMBLE_PROPERTY::READ | NIMBLE_PROPERTY::NOTIFY, 20);
  control = service->createCharacteristic(CONTROL, NIMBLE_PROPERTY::WRITE | NIMBLE_PROPERTY::READ | NIMBLE_PROPERTY::NOTIFY, 24);
  control->setCallbacks(&controlCallbacks);
  control->setValue("READY");
  auto info = service->createCharacteristic(INFO, NIMBLE_PROPERTY::READ);
  char metadata[200];
  snprintf(metadata, sizeof(metadata),
    "{\"protocol\":1,\"firmware\":\"1.0.0\",\"finalTurns\":655,\"rpmReady\":%s,\"inaReady\":%s,\"ppr\":%u}",
    rpmReady ? "true" : "false", inaReady ? "true" : "false", Config::PULSES_PER_REV);
  info->setValue(metadata);
  service->start();
  sample();
  auto advertising = NimBLEDevice::getAdvertising();
  advertising->addServiceUUID(SERVICE);
  advertising->enableScanResponse(true);
  advertising->setName("Generador Sara");
  advertising->start();
  Serial.println("BLE listo: busca Generador Sara desde monitor.html");
}

void loop() {
  Command command;
  if (xQueueReceive(commands, &command, 0) == pdTRUE) processCommand(command.text);
  const uint32_t now = millis();
  const uint32_t elapsed = now - rpmTime;
  if (elapsed >= Config::RPM_WINDOW_MS && rpmReady) {
    portENTER_CRITICAL(&pulseMux);
    uint32_t pulses = pulseCount; pulseCount = 0;
    portEXIT_CRITICAL(&pulseMux);
    measuredRpm = pulses * 60000.0f / (elapsed * float(Config::PULSES_PER_REV));
    rpmTime = now;
  }
  static uint32_t previous = 0;
  if (now - previous >= Config::SAMPLE_MS) { previous = now; sample(); }
  delay(5);
}
