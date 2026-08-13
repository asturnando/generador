#include <Arduino.h>
#include <Wire.h>

// Completar: completar desde el pinout oficial de la placa ESP32-S3 real.
constexpr int PIN_SDA = -1;
constexpr int PIN_SCL = -1;

void setup() {
  Serial.begin(115200);
  delay(500);

  if (PIN_SDA < 0 || PIN_SCL < 0) {
    Serial.println("ERROR_CONFIG: define PIN_SDA y PIN_SCL verificados.");
    return;
  }

  Wire.begin(PIN_SDA, PIN_SCL, 100000);
  Serial.println("Escaneo I2C iniciado");
}

void loop() {
  if (PIN_SDA < 0 || PIN_SCL < 0) {
    delay(1000);
    return;
  }

  unsigned int found = 0;
  for (uint8_t address = 0x08; address <= 0x77; address += 1) {
    Wire.beginTransmission(address);
    if (Wire.endTransmission() == 0) {
      Serial.printf("Dispositivo en 0x%02X\n", address);
      found += 1;
    }
  }
  Serial.printf("Total: %u\n", found);
  delay(3000);
}
