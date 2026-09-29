// =============================================================================
// config.h · Ajustes del hardware conectado a la ESP32
// =============================================================================
//
// Aquí se indica qué sensores hay, en qué pines están conectados y cada cuánto
// se mide. Es el ÚNICO archivo que habrá que tocar cuando se conecten los
// sensores de verdad.
//
// Estado actual: primera prueba con la ESP32 sola por USB. Ningún sensor está
// activado, así que la placa solo puede funcionar en modo DEMO (datos
// simulados). Los modos REAL y MIXED quedan bloqueados hasta que se rellenen
// y verifiquen estos valores.
//
// "constexpr" significa que el valor es fijo y se conoce al compilar: no puede
// cambiar mientras el programa funciona. Para cambiarlo hay que editar este
// archivo y volver a cargar el firmware.
// =============================================================================

#pragma once
#include <Arduino.h>  // Para FALLING (tipo de flanco) y otros nombres de Arduino.

// Primera prueba: ESP32 sola por USB. No se configura ningún GPIO por defecto.
// Activar únicamente tras identificar y verificar el hardware de Sara.
namespace Config {

// -----------------------------------------------------------------------------
// Sensor de velocidad (RPM)
// -----------------------------------------------------------------------------
// El sensor envía un pulso eléctrico cada vez que pasa una marca o un imán del
// rotor. La ESP32 cuenta los pulsos durante un tiempo y calcula las RPM.

// Interruptor de seguridad: mientras sea false, el sensor de RPM no se usa
// aunque el resto de valores estén rellenos. Ponerlo a true solo después de
// comprobar el montaje.
constexpr bool RPM_VERIFIED = false;
// Número de pin (GPIO) donde está conectada la señal del sensor.
// -1 = ninguno. El firmware además rechaza los pines reservados de la placa
// (ver allowedPin en main.cpp).
constexpr int RPM_PIN = -1;
// Pulsos que da el sensor en una vuelta completa del rotor (por ejemplo,
// 1 si hay una sola marca, 2 si hay dos imanes...). 0 = sin configurar.
constexpr uint16_t PULSES_PER_REV = 0;
// En qué momento del pulso se cuenta:
//   FALLING = cuando la señal baja de 3,3 V a 0 V (flanco de bajada).
//   RISING  = cuando sube de 0 V a 3,3 V (flanco de subida).
// Depende del sensor; hay que comprobarlo girando el rotor a mano.
constexpr int RPM_EDGE = FALLING;
// true = activa la resistencia interna de la ESP32 que mantiene la entrada en
// 3,3 V cuando el sensor no la está tirando a 0 V. Algunos sensores la
// necesitan y otros ya llevan la suya.
constexpr bool RPM_PULLUP = false;

// -----------------------------------------------------------------------------
// Sensor de tensión y corriente INA219
// -----------------------------------------------------------------------------
// El INA219 mide la tensión en la carga y la corriente que pasa por ella. Se
// comunica con la ESP32 por I2C: un bus de dos cables, SDA (datos) y SCL (reloj).

// Interruptor de seguridad equivalente al del sensor de RPM.
constexpr bool INA_VERIFIED = false;
// Pines del bus I2C. -1 = sin configurar.
constexpr int SDA_PIN = -1;
constexpr int SCL_PIN = -1;
// Dirección I2C del INA219 (entre 0x40 y 0x4F según cómo estén soldados sus
// puentes A0/A1; la más habitual es 0x40). Se averigua con el programa
// firmware/escanner_i2c. 0 = sin configurar.
constexpr uint8_t INA_ADDRESS = 0;
// Este perfil solo implementa el rango 16 V / 400 mA (shunt de 0,1 ohmios).
// Debe confirmarse que es adecuado; no describe los límites del montaje.
// Si el generador pudiera superar 16 V o 400 mA, este rango no sirve y las
// lecturas se marcarán como fuera de rango.
constexpr bool INA_16V_400MA_APPROVED = false;

// -----------------------------------------------------------------------------
// Ajustes generales
// -----------------------------------------------------------------------------
// Siempre reinicia en DEMO con velocidad cero. Nunca conmutar automáticamente.

// Vueltas de la toma seleccionada al encender: la bobina completa.
constexpr uint16_t FINAL_TURNS = 655;
// Cada cuántos milisegundos se envía una lectura al móvil: 500 ms = 2 por segundo.
constexpr uint32_t SAMPLE_MS = 500;
// Durante cuántos milisegundos se cuentan pulsos para calcular las RPM.
// Una ventana más larga da más precisión pero reacciona más despacio.
// La resolución es 60000 / (RPM_WINDOW_MS × PULSES_PER_REV) RPM: con 1000 ms
// y 1 pulso por vuelta, las RPM van de 60 en 60.
constexpr uint32_t RPM_WINDOW_MS = 1000;
}
