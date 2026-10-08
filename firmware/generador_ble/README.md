# Generador Sara · PlatformIO + Bluetooth BLE

Firmware completo (versión 1.1.0) para la placa de Sara: demostración, medida
real con INA219, sensores de RPM Hall KY-003 e infrarrojo TCRT5000, y diagnóstico
en directo de todo el montaje desde el monitor web. Siempre arranca en
**DEMO, 0 RPM, 655 vueltas**. No controla ninguna salida del motor ni reemplaza
protecciones físicas. Guía de cableado: `montaje.html` en la raíz del repositorio.

Pines (ver `include/config.h`): SDA = GPIO 8, SCL = GPIO 9, Hall = GPIO 6,
infrarrojo = GPIO 7. Todo alimentado a 3V3.

## Abrir en VS Code

No crees otro proyecto. Abre **esta carpeta** (`firmware/generador_ble`) con
Archivo → Abrir carpeta. PlatformIO reconocerá `platformio.ini`.

1. Conecta solo el USB-C marcado **UART**, a la derecha en la foto aportada
   (antena arriba y los dos USB abajo). Usa un cable de datos.
2. PlatformIO → Devices debe mostrar un puerto COM. Si no aparece, revisar cable,
   puerto USB y detección en Windows antes de instalar controladores.
3. Ejecuta **Build** (marca de verificación) con `nando_s3_uart`.
4. **Upload** (flecha) escribe el programa y sustituye el firmware de la placa.
   Guardar antes cualquier programa anterior que quieras conservar.
5. **Monitor** (enchufe) a 115200 baudios. Debe aparecer `BLE listo` y lecturas DEMO.
   Cierra el monitor antes de otra carga. No pulses BOOT salvo que la carga lo pida
   y se haya identificado correctamente el puerto de esta placa.

Comandos, ejecutados en esta carpeta:

```text
pio device list
pio run
pio run -t upload --upload-port COMx
pio device monitor --port COMx --baud 115200
```

`COMx` es un ejemplo, no un puerto asignado. Nunca se selecciona otra placa por descarte.

## Web y primera prueba

La página está en `monitor.html`, en la raíz del repositorio. Es estática y no
envía medidas a servidores: el enlace de datos es BLE directo entre móvil y ESP32.
El historial vive en la pestaña; descargar CSV antes de cerrarla.

- Android: Chrome y una URL **HTTPS**. GitHub Pages podrá servirla cuando se
  publique el cambio. Crear los archivos locales no publica la web.
- PC: Chrome/Edge con Bluetooth compatible. Una vista local en `http://localhost`
  sirve para ensayar; abrir el HTML como archivo o la IP HTTP del PC desde el móvil
  no es la vía de prueba Android.
- No usar el navegador incrustado de WhatsApp. La primera conexión exige pulsar
  el botón y elegir `Generador Sara` en el selector del navegador.

Prueba de aceptación con placa sola:

1. Conectar y confirmar DEMOSTRACIÓN, 655 vueltas, 0 RPM.
2. Aplicar 300 RPM: esperar 300 RPM, 2,000 V, 20,00 mA y 40,00 mW sintéticos.
3. Elegir 200 vueltas: cambia la función de demostración y la etiqueta. No mueve
   nada físico. Volver a 655.
4. Poner simulación a cero: todas las lecturas deben bajar a cero.
5. Descargar CSV: comprobar `SIMULADO` en ambas columnas de origen.
6. Quitar USB: las lecturas actuales deben borrarse al desconectar o tras 3 s sin
   paquetes, nunca quedar presentadas como medidas nuevas.
7. Reconectar USB y conectar de nuevo desde la web: arranca DEMO a cero.
8. Comprobar con el Android real la reconexión tras apagar pantalla/cambiar de app.

## Sara: 655 vueltas, tres modos

Dato aportado por Sara el 29/09/2026: INICIO, 200, 400, 600 y FINAL con 55 vueltas
adicionales desde 600. **Total: 655**. Conservamos el firmware anterior; esta
implementación nueva no reescribe las decisiones pendientes del manual.

- **DEMO**: todo simulado; no requiere sensores. Fórmula arbitraria para probar
  software: `V = RPM / 300 × vueltas / 655 × 2`, `mA = V × 10` y `mW = V × mA`.
  No es un modelo físico validado ni predice resultados del generador.
- **REAL**: RPM por pulsos e INA219. Sin lectura válida se envía ausencia de dato,
  no se cambia a demo. Potencia mostrada = tensión de carga × corriente.
- **MIXED**: RPM por pulsos, electricidad sintética calculada con la misma función
  de demostración. El origen se indica por magnitud en pantalla y en el CSV.

Desde la 1.1.0 los pines están fijados para la placa de Sara (ESP32-S3-WROOM-1
en base de bornes, serigrafía DevKitC-1) y los sensores se vigilan siempre:

- **INA219**: se busca solo en todo el bus I2C (0x08–0x77) al arrancar, cada 3 s
  mientras no aparezca, y con la orden `SCAN`. Antes se comprueba si SDA/SCL
  llegan a 3,3 V a través de las resistencias del módulo o están a 0 V, para
  explicar en el monitor qué cable falla. Tres lecturas fallidas seguidas en REAL
  lo dan por perdido; el modo sigue siendo REAL, con estado de error.
- **RPM**: las dos entradas cuentan pulsos a la vez (interrupción en cada
  cambio, antirrebote de 300 µs en alto). Las RPM del sensor elegido se calculan
  con el tiempo exacto entre pulsos, no por ventanas fijas; sin pulsos durante
  3 s pasan a 0. Sensor (`SRC`) y pulsos por vuelta (`PPR`) se eligen desde el
  móvil y se guardan en la memoria permanente (NVS). Con PPR = 0 no hay RPM.
- **REAL** necesita el INA219; las RPM se miden si hay PPR. **MIXED** necesita PPR.

Se implementa únicamente la calibración 16 V / 400 mA de Adafruit para shunt de
0,1 ohmios. Los límites seguros reales pueden ser menores. La lectura de tensión
es en VIN− respecto a GND (carga), no la tensión en vacío de la bobina; DC− debe
estar unido a GND. La corriente conserva su signo.

Cero pulsos también puede indicar sensor desconectado: el diagnóstico muestra el
nivel de cada entrada para comprobarlo. La inicialización del INA219 no equivale
a calibración verificada. Ante fallo, parar y revisar; no reconectar sensores
con tensión.

Cambiar «vueltas» solo etiqueta: para ensayar cada toma hay que cambiar físicamente
el cable con el motor parado y desconectado. No une derivaciones electrónicamente.

## Perfil de placa y dependencias

PlatformIO espressif32 6.12.0 / Arduino ESP32 2.0.17; NimBLE-Arduino 2.3.6;
Adafruit INA219 1.2.3; BusIO 1.17.4. Perfil S3 genérico basado en DevKitC-1,
UART0, flash DIO 80 MHz y partición de 4 MB, sin PSRAM. No requiere usar los
16 MB/8 MB anunciados; no confirma la memoria instalada. El firmware anterior
para Arduino permanece intacto. No se instala ni actualiza PlatformIO global.

## Protocolo BLE v1

Servicio `aa510001-7a4b-4c26-8e01-8c5370b56555`.
Características con el mismo sufijo: `aa510002` telemetría READ/NOTIFY,
`aa510003` control WRITE/READ/NOTIFY, `aa510004` información READ (JSON),
`aa510005` diagnóstico READ/NOTIFY (desde 1.1.0; el JSON lo anuncia con `"diag":1`).

Paquetes de 20 bytes cada 500 ms; no dependen de negociar un MTU grande:

| Bytes | Campo |
|---|---|
| 0 | Versión = 1 |
| 1 | Modo: 0 DEMO, 1 REAL, 2 MIXED |
| 2 | Flags: 1 RPM válida, 2 electricidad válida, 4 INA inicializado, 8 RPM configurado |
| 3 | Estado: 0 OK, 1 config, 2 INA error, 3 sin pulsos, 4 fuera de rango |
| 4–5 | Secuencia uint16 little endian, vuelve a cero tras 65535 |
| 6–7 | Vueltas uint16 LE |
| 8–11 | RPM float32 LE |
| 12–15 | Voltios float32 LE |
| 16–19 | mA float32 LE |

Diagnóstico, 20 bytes, al cambiar algo (revisión cada 200 ms) y al menos una vez
por segundo:

| Bytes | Campo |
|---|---|
| 0 | Versión = 1 |
| 1 | Flags: 1 Hall a 0 V, 2 infrarrojo a 0 V, 4 INA219 listo, 8 RPM del infrarrojo, 16 pull-up en SDA, 32 pull-up en SCL, 64 SDA/SCL a 0 V |
| 2 | Dirección del INA219 (0 = no encontrado) |
| 3 | Pulsos por vuelta (0 = sin configurar) |
| 4–7 | Pulsos Hall uint32 LE |
| 8–11 | Pulsos infrarrojo uint32 LE |
| 12 | Dispositivos I2C encontrados |
| 13–19 | Sus direcciones (hasta 7) |

Comandos ASCII: `MODE:DEMO`, `MODE:REAL`, `MODE:MIXED`, `SPEED:0` a `SPEED:1200`,
`TURNS:200/400/600/655`, `PPR:0` a `PPR:64`, `SRC:HALL`, `SRC:IR`,
`RESET:PULSES` y `SCAN` (un único número por comando). Se confirma con `OK <orden>`
o `ERR <motivo>`. La web espera confirmación, no permite órdenes concurrentes.
No hay autenticación BLE: ensayo local supervisado, una conexión, sin información
personal ni órdenes a motor. No usar como control de seguridad.

## Verificación de software

Desde la raíz: `node --test tests/monitor-protocol.test.mjs tests/monitor-ui.test.mjs`.
Compilar: `pio run -d firmware/generador_ble`.
La compilación y los tests no prueban por sí solos radio, alimentación o sensores.
Para confirmar funcionamiento físico completar la prueba de aceptación anterior.

### Comprobaciones de la versión 1.1.0 (08/10/2026)

- 26 tests de protocolo e interfaz pasaron con Node, incluidos diagnóstico,
  órdenes nuevas, panel de sensores y compatibilidad con firmware anterior.
- Compilación PlatformIO correcta, sin avisos: 540.689 bytes de programa,
  30.464 bytes de RAM.
- **Sin probar en hardware**: ninguna placa estaba conectada al compilar. Pendiente
  comprobar en la placa real arranque, BLE, búsqueda del INA219 y contadores.

### Comprobaciones realizadas el 29/09/2026

- 16 tests de protocolo y lógica de interfaz pasaron con Node.
- Compilación PlatformIO correcta: 526.753 bytes de programa, 29.712 bytes de RAM.
- Detectado CH343 en COM3 tras cambiar el cable USB.
- esptool confirmó ESP32-S3 revisión 0.2, flash de 16 MB y PSRAM integrada de 8 MB.
- Firmware cargado en COM3 con verificación de hash correcta.
- Lecturas repetidas por UART: `mode=0 turns=655 rpm=0.0 V=0.000 mA=0.000 status=0`.
- Monitor abierto y revisado en Chrome local. Se corrigió la extensión del módulo
  JavaScript para evitar el MIME `text/plain` del servidor Windows para `.mjs`.
- No apareció adaptador Bluetooth en la consulta de dispositivos presentes de
  Windows; la conexión BLE de extremo a extremo y Android siguen sin comprobar.
- Web todavía no publicada. Sensores reales no conectados ni validados.

Después de abrir VS Code se observó que el ejecutable Python base de PlatformIO
dejó de estar disponible y aparecieron archivos `.DELETE` en su instalación.
No se ha reparado ni eliminado nada de ese entorno. Confirmar que la extensión
termina de instalar/inicializar PlatformIO antes de la siguiente compilación.

Referencias: [NimBLE](https://h2zero.github.io/NimBLE-Arduino/md__new__user__guide.html),
[PlatformIO S3](https://docs.platformio.org/en/latest/boards/espressif32/esp32-s3-devkitc-1.html),
[Web Bluetooth](https://developer.chrome.com/docs/capabilities/bluetooth).
