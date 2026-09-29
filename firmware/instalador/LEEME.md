# Instalador web del firmware

Archivos que usa la página `instalar.html` para cargar el firmware desde el
navegador (con ESP Web Tools), sin VS Code ni PlatformIO.

- `manifest.json`: nombre, versión y qué archivo instalar según el chip. Hoy
  solo hay una entrada, para `ESP32-S3`. Si se conecta otro chip, la página
  avisa de que no es compatible. `new_install_prompt_erase: true` ofrece
  borrar la memoria antes de instalar.
- `generador-sara-esp32s3.bin`: imagen completa que se escribe desde la
  dirección 0 de la memoria flash. Contiene, en este orden:

  | Dirección | Contenido | Origen |
  |-----------|-----------|--------|
  | `0x0`     | Programa de arranque (bootloader) | `.pio/build/nando_s3_uart/bootloader.bin` |
  | `0x8000`  | Tabla de particiones | `.pio/build/nando_s3_uart/partitions.bin` |
  | `0xe000`  | Selector de partición de arranque | `boot_app0.bin` del núcleo Arduino |
  | `0x10000` | El programa (firmware) | `.pio/build/nando_s3_uart/firmware.bin` |

## Regenerar el .bin tras cambiar el firmware

1. Cambiar la versión en `firmware/generador_ble/src/main.cpp` (dos sitios:
   el mensaje de arranque y el JSON de información), en `manifest.json` y en
   los textos de `instalar.html`.
2. En `firmware/generador_ble`, compilar con `pio run`.
3. Desde esa misma carpeta, unir las cuatro partes:

   ```text
   python ~/.platformio/packages/tool-esptoolpy/esptool.py --chip esp32s3 merge_bin \
     -o ../instalador/generador-sara-esp32s3.bin \
     --flash_mode dio --flash_freq 80m --flash_size 4MB \
     0x0 .pio/build/nando_s3_uart/bootloader.bin \
     0x8000 .pio/build/nando_s3_uart/partitions.bin \
     0xe000 ~/.platformio/packages/framework-arduinoespressif32/tools/partitions/boot_app0.bin \
     0x10000 .pio/build/nando_s3_uart/firmware.bin
   ```

   En Windows, `python` es `~/.platformio/penv/Scripts/python.exe`.
   `dio`, `80m` y `4MB` deben coincidir con `platformio.ini`.
4. Probar la página con una placa propia antes de pasar el enlace.
