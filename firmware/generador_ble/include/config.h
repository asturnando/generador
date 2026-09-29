#pragma once
#include <Arduino.h>

// Primera prueba: ESP32 sola por USB. No se configura ningún GPIO por defecto.
// Activar únicamente tras identificar y verificar el hardware de Sara.
namespace Config {
constexpr bool RPM_VERIFIED = false;
constexpr int RPM_PIN = -1;
constexpr uint16_t PULSES_PER_REV = 0;
constexpr int RPM_EDGE = FALLING;
constexpr bool RPM_PULLUP = false;

constexpr bool INA_VERIFIED = false;
constexpr int SDA_PIN = -1;
constexpr int SCL_PIN = -1;
constexpr uint8_t INA_ADDRESS = 0;
// Este perfil solo implementa el rango 16 V / 400 mA (shunt de 0,1 ohmios).
// Debe confirmarse que es adecuado; no describe los límites del montaje.
constexpr bool INA_16V_400MA_APPROVED = false;

// Siempre reinicia en DEMO con velocidad cero. Nunca conmutar automáticamente.
constexpr uint16_t FINAL_TURNS = 655;
constexpr uint32_t SAMPLE_MS = 500;
constexpr uint32_t RPM_WINDOW_MS = 1000;
}

