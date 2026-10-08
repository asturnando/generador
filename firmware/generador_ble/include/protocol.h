// =============================================================================
// protocol.h · El "idioma" que hablan la ESP32 y la web del monitor
// =============================================================================
//
// La ESP32 y el móvil se comunican por Bluetooth Low Energy (BLE). En BLE, un
// dispositivo ofrece "servicios", y cada servicio contiene "características":
// pequeñas casillas de datos que el móvil puede leer, escribir o a las que se
// puede suscribir para recibir avisos ("notificaciones") cuando cambian.
//
// Este archivo define:
//   1. Los identificadores (UUID) del servicio y de sus características.
//   2. Los códigos numéricos de modo, estado y banderas.
//   3. La fórmula de demostración (datos simulados).
//   4. Cómo se empaquetan las lecturas en 20 bytes para enviarlas.
//   5. Cómo se empaqueta el diagnóstico de los sensores (otros 20 bytes).
//
// IMPORTANTE: la web tiene una copia de todo esto en
// assets/js/monitor-protocol.js. Si se cambia algo aquí, hay que cambiarlo
// también allí; si no, la placa y la web dejarán de entenderse.
// =============================================================================

// "#pragma once" evita que este archivo se incluya dos veces en la misma
// compilación (lo que provocaría errores por definiciones repetidas).
#pragma once
#include <stdint.h>  // Tipos de tamaño fijo: uint8_t (1 byte), uint16_t (2 bytes)...
#include <string.h>  // memcpy: copiar bytes de un sitio a otro.
#include <math.h>    // Funciones matemáticas (y el valor NAN).

// Todo va dentro del espacio de nombres "Protocol" para que estos nombres
// (OK, DEMO, INFO...) no choquen con otros iguales de otras bibliotecas.
namespace Protocol {

// -----------------------------------------------------------------------------
// 1. Identificadores UUID
// -----------------------------------------------------------------------------
// Un UUID es un número de 128 bits escrito en hexadecimal que identifica de
// forma única un servicio o una característica. Estos son inventados para este
// proyecto: comparten la misma base y solo cambia el segundo bloque
// (0001, 0002, 0003, 0004) para que sea fácil reconocerlos.

// Servicio principal "Generador Sara". La web busca placas que lo anuncien.
constexpr const char* SERVICE = "aa510001-7a4b-4c26-8e01-8c5370b56555";
// Telemetría: las lecturas (RPM, voltios, miliamperios...). La web se
// suscribe y recibe un paquete de 20 bytes cada vez que hay una lectura nueva.
constexpr const char* TELEMETRY = "aa510002-7a4b-4c26-8e01-8c5370b56555";
// Control: la web escribe aquí órdenes de texto ("MODE:DEMO", "SPEED:300"...)
// y la placa responde en la misma característica ("OK ..." o "ERR ...").
constexpr const char* CONTROL = "aa510003-7a4b-4c26-8e01-8c5370b56555";
// Información: un texto JSON fijo con la versión del firmware, los pines y
// qué sensores estaban listos al arrancar. La web lo lee una vez al conectar
// para comprobar que la placa es compatible.
constexpr const char* INFO = "aa510004-7a4b-4c26-8e01-8c5370b56555";
// Diagnóstico (desde la versión 1.1.0): estado de los sensores en directo
// (INA219 encontrado, contadores de pulsos, nivel de cada sensor...). La web
// lo usa para el panel "Sensores y ajustes". Las placas con firmware anterior
// no lo tienen, y la web simplemente oculta ese panel.
constexpr const char* DIAG = "aa510005-7a4b-4c26-8e01-8c5370b56555";

// Versión del firmware. Se muestra en el monitor serie y en el monitor web.
constexpr const char* FIRMWARE_VERSION = "1.1.0";

// -----------------------------------------------------------------------------
// 2. Códigos numéricos
// -----------------------------------------------------------------------------
// Un "enum" da nombre a una lista de números. ": uint8_t" indica que cada
// valor ocupa exactamente 1 byte, que es lo que se envía por Bluetooth.

// Origen de los datos:
//   DEMO  = todo simulado (no necesita sensores). Es el modo al arrancar.
//   REAL  = RPM medidas con el sensor de pulsos y electricidad medida con el INA219.
//   MIXED = RPM medidas, pero electricidad simulada con la fórmula de demostración.
enum Mode : uint8_t { DEMO = 0, REAL = 1, MIXED = 2 };

// Estado de la lectura que acompaña a cada paquete:
//   OK           = todo correcto.
//   CONFIG_ERROR = se pidió medir, pero el sensor no está configurado.
//   INA_ERROR    = el INA219 no respondió o dio una lectura imposible.
//   NO_PULSES    = en modo REAL o MIXED no llegan pulsos del sensor de RPM
//                  (el rotor está parado o el sensor no funciona).
//   RANGE_ERROR  = la medida se sale del rango que el INA219 puede medir.
enum Status : uint8_t { OK = 0, CONFIG_ERROR = 1, INA_ERROR = 2, NO_PULSES = 3, RANGE_ERROR = 4 };

// Banderas: cada una es un bit distinto dentro del mismo byte, así que se
// pueden combinar varias a la vez (por ejemplo, 1 + 2 = 3 = "RPM y
// electricidad válidas"). Valores 1, 2, 4 y 8 = bits 0, 1, 2 y 3.
//   RPM_VALID      = el campo de RPM de este paquete contiene un número válido.
//   ELECTRIC_VALID = los campos de voltios y miliamperios son válidos.
//   INA_READY      = el INA219 está configurado y respondió al arrancar.
//   RPM_READY      = el sensor de RPM está configurado.
enum Flag : uint8_t { RPM_VALID = 1, ELECTRIC_VALID = 2, INA_READY = 4, RPM_READY = 8 };

// Sensor del que salen las RPM: el Hall KY-003 (imanes) o el infrarrojo
// TCRT5000 (marca reflectante). Se elige desde el móvil.
enum RpmSource : uint8_t { SOURCE_HALL = 0, SOURCE_IR = 1 };

// Banderas del paquete de diagnóstico (un bit cada una):
//   DIAG_HALL_LOW  = la salida del sensor Hall está ahora a 0 V. En la mayoría
//                    de módulos significa "detectando" (y se enciende su LED).
//   DIAG_IR_LOW    = lo mismo para el sensor infrarrojo.
//   DIAG_INA_FOUND = el INA219 responde y está calibrado.
//   DIAG_SOURCE_IR = las RPM salen del infrarrojo (si no, del Hall).
//   DIAG_SDA_PULLUP / DIAG_SCL_PULLUP = la línea llega a 3,3 V a través de las
//                    resistencias del módulo INA219: señal de que ese cable
//                    está conectado y el módulo alimentado.
//   DIAG_I2C_STUCK = SDA o SCL están clavadas a 0 V (cable a GND o cruzado);
//                    en ese caso no se busca el INA219.
enum DiagFlag : uint8_t {
  DIAG_HALL_LOW = 1, DIAG_IR_LOW = 2, DIAG_INA_FOUND = 4, DIAG_SOURCE_IR = 8,
  DIAG_SDA_PULLUP = 16, DIAG_SCL_PULLUP = 32, DIAG_I2C_STUCK = 64
};

// -----------------------------------------------------------------------------
// 3. Utilidades
// -----------------------------------------------------------------------------

// Las únicas tomas de la bobina que existen: 200, 400, 600 y 655 vueltas
// (INICIO → T200, T400, T600 y FINAL). Cualquier otro número es un error.
// "inline" permite definir la función en un archivo .h sin que se duplique
// al compilar.
inline bool validTurns(unsigned n) { return n == 200 || n == 400 || n == 600 || n == 655; }

// Función de demostración ARBITRARIA, no modelo validado del generador.
// Solo sirve para comprobar que el software funciona: da una tensión que crece
// con la velocidad y con el número de vueltas, como cabría esperar de forma
// cualitativa, pero los números (300, 655, 2) están elegidos para que la
// prueba sea fácil de comprobar: 300 RPM con 655 vueltas → exactamente 2 V.
//   V = RPM / 300 × (vueltas / 655) × 2
// Si las RPM son 0 o negativas, devuelve 0 V.
// La "f" detrás de los números (300.0f) indica que son float (decimal de
// 32 bits), el mismo tipo que se envía por Bluetooth.
inline float demoVoltage(float rpm, unsigned turns) {
  return rpm > 0 ? rpm / 300.0f * (turns / 655.0f) * 2.0f : 0.0f;
}

// -----------------------------------------------------------------------------
// 4. Empaquetado de las lecturas (20 bytes)
// -----------------------------------------------------------------------------
// 20 bytes: cabe incluso en el MTU BLE mínimo (23 - 3).
// El MTU es el tamaño máximo de un mensaje BLE. El mínimo que garantiza
// cualquier móvil es 23 bytes, de los que 3 son cabecera: quedan 20 útiles.
// Así cada lectura viaja siempre en un único mensaje, sin trocearse.
//
// Distribución de los bytes (posición: contenido):
//   0      versión del protocolo (siempre 1)
//   1      modo (DEMO, REAL o MIXED)
//   2      banderas (RPM_VALID, ELECTRIC_VALID...)
//   3      estado (OK, INA_ERROR...)
//   4-5    número de secuencia (cuenta 0, 1, 2... para detectar paquetes perdidos)
//   6-7    vueltas de la toma seleccionada (200, 400, 600 o 655)
//   8-11   RPM, número decimal float de 4 bytes
//   12-15  tensión en voltios, float de 4 bytes
//   16-19  corriente en miliamperios, float de 4 bytes
//
// "out" apunta a un bloque de 20 bytes donde se escribe el paquete.
inline void encode(uint8_t* out, Mode mode, uint8_t flags, Status status,
                   uint16_t sequence, uint16_t turns, float rpm, float volts, float ma) {
  out[0] = 1; out[1] = mode; out[2] = flags; out[3] = status;
  // Los números de 2 bytes se guardan en orden "little endian": primero el
  // byte bajo y luego el alto. "& 255" se queda con el byte bajo y ">> 8"
  // desplaza 8 bits para obtener el byte alto. Ejemplo: 655 = 0x028F →
  // se guarda como 0x8F, 0x02.
  out[4] = sequence & 255; out[5] = sequence >> 8;
  out[6] = turns & 255; out[7] = turns >> 8;
  // Comprobación al compilar: si en esta placa un float no midiera 4 bytes,
  // la compilación fallaría con este mensaje en lugar de enviar datos erróneos.
  static_assert(sizeof(float) == 4, "BLE requiere float32");
  // ESP32-S3 utiliza little endian IEEE754.
  // IEEE 754 es el formato estándar de los números decimales. Como la ESP32 lo
  // guarda en memoria igual que lo espera la web (little endian), basta con
  // copiar sus 4 bytes tal cual. Si un valor es NAN ("no es un número"), se
  // copia igualmente; la web lo ignora porque su bandera de validez está a 0.
  memcpy(out + 8, &rpm, 4); memcpy(out + 12, &volts, 4); memcpy(out + 16, &ma, 4);
}

// -----------------------------------------------------------------------------
// 5. Empaquetado del diagnóstico (20 bytes)
// -----------------------------------------------------------------------------
// Distribución de los bytes:
//   0      versión del paquete de diagnóstico (siempre 1)
//   1      banderas de diagnóstico (DIAG_...)
//   2      dirección I2C del INA219 (0 = no encontrado)
//   3      pulsos por vuelta configurados (0 = sin configurar)
//   4-7    pulsos totales contados por el sensor Hall (número de 4 bytes)
//   8-11   pulsos totales contados por el sensor infrarrojo
//   12     cuántos dispositivos I2C respondieron en la última búsqueda
//   13-19  sus direcciones (hasta 7; 0 = hueco vacío)
inline void encodeDiag(uint8_t* out, uint8_t flags, uint8_t inaAddress, uint8_t ppr,
                       uint32_t hallPulses, uint32_t irPulses,
                       uint8_t i2cCount, const uint8_t* i2cAddresses) {
  out[0] = 1; out[1] = flags; out[2] = inaAddress; out[3] = ppr;
  // Igual que los float: la ESP32 guarda los números en little endian, que es
  // como los lee la web, así que se copian sus 4 bytes tal cual.
  memcpy(out + 4, &hallPulses, 4); memcpy(out + 8, &irPulses, 4);
  out[12] = i2cCount;
  memcpy(out + 13, i2cAddresses, 7);
}
}
