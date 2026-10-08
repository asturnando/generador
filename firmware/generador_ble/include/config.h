// =============================================================================
// config.h · Ajustes del hardware conectado a la ESP32
// =============================================================================
//
// Aquí se indica en qué pines está conectado cada sensor y cada cuánto se
// mide. Pensado para la placa de Sara: ESP32-S3-WROOM-1 montada en una base
// con regletas de tornillos verdes (numeración ESP32-S3-DevKitC-1).
//
// Desde la versión 1.1.0 los sensores ya no se activan a mano aquí: el
// firmware los vigila siempre y cuenta lo que llega.
//   - El INA219 se busca solo por el bus I2C (y se vuelve a buscar si se
//     desconecta). No hace falta saber su dirección.
//   - Los dos sensores de RPM se leen a la vez. Desde el móvil se elige cuál
//     da las RPM y cuántos pulsos hay por vuelta (PPR); se guarda en la placa.
//
// "constexpr" significa que el valor es fijo y se conoce al compilar: para
// cambiarlo hay que editar este archivo y volver a cargar el firmware.
// =============================================================================

#pragma once
#include <Arduino.h>  // Para FALLING, INPUT_PULLUP y otros nombres de Arduino.

namespace Config {

// -----------------------------------------------------------------------------
// Pines (número de GPIO). Posición en la regleta IZQUIERDA, contando desde
// arriba con la antena arriba y los USB abajo: 1 = 3V3, 2 = 3V3, 3 = RST...
// -----------------------------------------------------------------------------

// INA219 (tensión y corriente) por I2C: SDA = datos, SCL = reloj.
// Son los pines I2C por defecto de la ESP32-S3 en Arduino.
constexpr int SDA_PIN = 8;   // Borne "8", posición 12.
constexpr int SCL_PIN = 9;   // Borne "9", posición 15.

// Sensor Hall KY-003 (detecta imanes): su pin S.
constexpr int HALL_PIN = 6;  // Borne "6", posición 6.
// Sensor infrarrojo TCRT5000 (detecta una marca reflectante): su pin OUT.
constexpr int IR_PIN = 7;    // Borne "7", posición 7.

// Todos los módulos se alimentan desde 3V3, nunca desde 5V: así sus salidas
// nunca superan los 3,3 V que admiten los pines de la ESP32.

// -----------------------------------------------------------------------------
// Sensores de RPM
// -----------------------------------------------------------------------------

// Activa la resistencia interna de la ESP32 que mantiene cada entrada en
// 3,3 V. Si un sensor se desconecta, su entrada se queda quieta en alto en
// lugar de captar ruido y contar pulsos falsos.
constexpr bool SENSOR_PULLUP = true;
// Antirrebote: un pulso solo cuenta si antes la señal estuvo en alto al menos
// este tiempo (microsegundos). Filtra el "temblor" de la señal cuando el
// imán o la marca pasan despacio. 300 µs permite hasta unos 1600 pulsos por
// segundo, de sobra para este rotor.
constexpr uint32_t MIN_HIGH_US = 300;
// Si pasan estos milisegundos sin ningún pulso, las RPM pasan a 0.
// Con 1 pulso por vuelta, por debajo de 20 RPM se mostrará 0.
constexpr uint32_t RPM_TIMEOUT_MS = 3000;
// Máximo de pulsos por vuelta que se puede configurar desde el móvil.
constexpr uint8_t MAX_PPR = 64;

// -----------------------------------------------------------------------------
// INA219
// -----------------------------------------------------------------------------
// Se usa la calibración de la biblioteca "16 V / 400 mA" (shunt R100 de
// 0,1 ohmios): la de más resolución. Por encima de 16 V o de 400 mA las
// lecturas se marcan como fuera de rango en lugar de mostrarse.
// Cada cuántos milisegundos se comprueba que el INA219 sigue respondiendo
// (o se vuelve a buscar si no estaba).
constexpr uint32_t I2C_CHECK_MS = 3000;

// -----------------------------------------------------------------------------
// Ajustes generales
// -----------------------------------------------------------------------------
// Siempre reinicia en DEMO con velocidad cero. Nunca conmutar automáticamente.

// Vueltas de la toma seleccionada al encender: la bobina completa.
constexpr uint16_t FINAL_TURNS = 655;
// Cada cuántos milisegundos se envía una lectura al móvil: 500 ms = 2 por segundo.
constexpr uint32_t SAMPLE_MS = 500;
// Cada cuántos milisegundos se revisa si el diagnóstico ha cambiado (para que
// los contadores de pulsos se vean casi al instante). Si no cambia nada, se
// reenvía igualmente una vez por segundo.
constexpr uint32_t DIAG_MS = 200;
}
