#include <Arduino.h>
#include <Wire.h>
#include <Adafruit_INA219.h>
#include "configuracion.h"

Adafruit_INA219 ina219(static_cast<uint8_t>(INA219_ADDRESS));
volatile uint32_t pulseCount = 0;
bool measurementReady = false;

void ARDUINO_ISR_ATTR countRpmPulse() {
  pulseCount += 1;
}

bool configurationIsValid() {
  return PIN_SDA >= 0 && PIN_SCL >= 0 && PIN_RPM >= 0 &&
         INA219_ADDRESS >= 0x08 && INA219_ADDRESS <= 0x77 &&
         PULSES_PER_REVOLUTION > 0 &&
         INA219_CALIBRATION != Ina219Calibration::UNSET;
}

void setup() {
  Serial.begin(115200);
  delay(500);

  if (!configurationIsValid()) {
    Serial.println("ERROR_CONFIG: completa configuracion.h con valores verificados.");
    return;
  }

  Wire.begin(PIN_SDA, PIN_SCL, 100000);
  if (!ina219.begin(&Wire)) {
    Serial.println("ERROR_INA219: dispositivo no encontrado en la direccion configurada.");
    return;
  }

  switch (INA219_CALIBRATION) {
    case Ina219Calibration::RANGE_16V_400MA:
      ina219.setCalibration_16V_400mA();
      break;
    case Ina219Calibration::RANGE_32V_1A:
      ina219.setCalibration_32V_1A();
      break;
    case Ina219Calibration::RANGE_32V_2A:
      ina219.setCalibration_32V_2A();
      break;
    case Ina219Calibration::UNSET:
      return;
  }

  pinMode(PIN_RPM, INPUT_PULLUP);
  attachInterrupt(digitalPinToInterrupt(PIN_RPM), countRpmPulse, RPM_INTERRUPT_MODE);
  measurementReady = true;

  Serial.println("tiempo_ms,voltaje_V,corriente_mA,potencia_mW,rpm,pulsos,estado");
}

void loop() {
  static uint32_t previousSampleMs = millis();
  if (!measurementReady) {
    delay(1000);
    return;
  }

  const uint32_t nowMs = millis();
  const uint32_t elapsedMs = nowMs - previousSampleMs;
  if (elapsedMs < SAMPLE_INTERVAL_MS) return;
  previousSampleMs = nowMs;

  noInterrupts();
  const uint32_t pulses = pulseCount;
  pulseCount = 0;
  interrupts();

  const float rpm = (pulses * 60000.0f) /
                    (elapsedMs * static_cast<float>(PULSES_PER_REVOLUTION));
  const float voltageV = ina219.getBusVoltage_V();
  const float currentMa = ina219.getCurrent_mA();
  const float powerMw = ina219.getPower_mW();
  const bool sensorOk = ina219.success();
  const char *status = !sensorOk ? "ERROR_INA219" :
                       (pulses > 0 ? "OK" : "SIN_PULSOS");

  Serial.printf("%lu,%.4f,%.3f,%.3f,%.2f,%lu,%s\n",
                static_cast<unsigned long>(nowMs), voltageV, currentMa,
                powerMw, rpm, static_cast<unsigned long>(pulses), status);
}
