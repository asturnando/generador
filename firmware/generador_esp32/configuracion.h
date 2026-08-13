#pragma once

// VERIFICACIONES OBLIGATORIAS: sustituir únicamente después de verificar la placa física,
// su pinout oficial, el escaneo I2C y los pulsos por vuelta del Capítulo 7.
constexpr int PIN_SDA = -1;
constexpr int PIN_SCL = -1;
constexpr int PIN_RPM = -1;
constexpr int INA219_ADDRESS = 0x00;
constexpr unsigned int PULSES_PER_REVOLUTION = 0;

enum class Ina219Calibration {
  UNSET,
  RANGE_16V_400MA,
  // Estos dos nombres proceden de la biblioteca. No autorizan superar el
  // límite físico de bus de 26 V del INA219 ni los límites del módulo real.
  RANGE_32V_1A,
  RANGE_32V_2A
};
constexpr Ina219Calibration INA219_CALIBRATION = Ina219Calibration::UNSET;

constexpr unsigned long SAMPLE_INTERVAL_MS = 1000;
#define RPM_INTERRUPT_MODE FALLING
