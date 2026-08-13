# Firmware del generador

Los programas se entregan con valores bloqueantes sin configurar. No se deben
rellenar por semejanza con una fotografía.

1. `escanner_i2c/escanner_i2c.ino`: confirmar SDA, SCL y la dirección real del INA219.
2. `prueba_rpm/prueba_rpm.ino`: validar GPIO, flanco y pulsos por revolución con giro manual.
3. `generador_esp32/`: integrar INA219 y RPM; editar primero `configuracion.h`, incluida la calibración cuyo rango cubra las medidas reales.

Dependencias del programa integrado:

- soporte Arduino para ESP32 de Espressif;
- biblioteca `Adafruit INA219` y sus dependencias desde Library Manager.

Antes de subir código, registrar la versión de la placa, del core y de cada
biblioteca. El programa no controla el PWM ni constituye una protección contra
sobrevelocidad.
