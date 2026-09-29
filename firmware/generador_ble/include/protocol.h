#pragma once
#include <stdint.h>
#include <string.h>
#include <math.h>

namespace Protocol {
constexpr const char* SERVICE = "aa510001-7a4b-4c26-8e01-8c5370b56555";
constexpr const char* TELEMETRY = "aa510002-7a4b-4c26-8e01-8c5370b56555";
constexpr const char* CONTROL = "aa510003-7a4b-4c26-8e01-8c5370b56555";
constexpr const char* INFO = "aa510004-7a4b-4c26-8e01-8c5370b56555";
enum Mode : uint8_t { DEMO = 0, REAL = 1, MIXED = 2 };
enum Status : uint8_t { OK = 0, CONFIG_ERROR = 1, INA_ERROR = 2, NO_PULSES = 3, RANGE_ERROR = 4 };
enum Flag : uint8_t { RPM_VALID = 1, ELECTRIC_VALID = 2, INA_READY = 4, RPM_READY = 8 };

inline bool validTurns(unsigned n) { return n == 200 || n == 400 || n == 600 || n == 655; }
// Función de demostración ARBITRARIA, no modelo validado del generador.
inline float demoVoltage(float rpm, unsigned turns) {
  return rpm > 0 ? rpm / 300.0f * (turns / 655.0f) * 2.0f : 0.0f;
}
// 20 bytes: cabe incluso en el MTU BLE mínimo (23 - 3).
inline void encode(uint8_t* out, Mode mode, uint8_t flags, Status status,
                   uint16_t sequence, uint16_t turns, float rpm, float volts, float ma) {
  out[0] = 1; out[1] = mode; out[2] = flags; out[3] = status;
  out[4] = sequence & 255; out[5] = sequence >> 8;
  out[6] = turns & 255; out[7] = turns >> 8;
  static_assert(sizeof(float) == 4, "BLE requiere float32");
  // ESP32-S3 utiliza little endian IEEE754.
  memcpy(out + 8, &rpm, 4); memcpy(out + 12, &volts, 4); memcpy(out + 16, &ma, 4);
}
}

