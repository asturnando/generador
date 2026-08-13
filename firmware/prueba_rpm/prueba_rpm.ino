#include <Arduino.h>

// Completar: completar con valores medidos en el Capítulo 7.
constexpr int PIN_RPM = -1;
constexpr unsigned int PULSES_PER_REVOLUTION = 0;
constexpr unsigned long SAMPLE_INTERVAL_MS = 1000;
#define RPM_INTERRUPT_MODE FALLING

volatile uint32_t pulseCount = 0;

void ARDUINO_ISR_ATTR countRpmPulse() {
  pulseCount += 1;
}

void setup() {
  Serial.begin(115200);
  delay(500);
  if (PIN_RPM < 0 || PULSES_PER_REVOLUTION == 0) {
    Serial.println("ERROR_CONFIG: define PIN_RPM y PULSES_PER_REVOLUTION verificados.");
    return;
  }
  pinMode(PIN_RPM, INPUT_PULLUP);
  attachInterrupt(digitalPinToInterrupt(PIN_RPM), countRpmPulse, RPM_INTERRUPT_MODE);
  Serial.println("tiempo_ms,rpm,pulsos");
}

void loop() {
  static uint32_t previousSampleMs = millis();
  if (PIN_RPM < 0 || PULSES_PER_REVOLUTION == 0) {
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
  Serial.printf("%lu,%.2f,%lu\n", static_cast<unsigned long>(nowMs), rpm,
                static_cast<unsigned long>(pulses));
}
