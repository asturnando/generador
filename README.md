<div align="center">

# ⚡ Generador electromagnético experimental

### Manual visual de montaje, instrumentación y pruebas

**Motor 775 · Rotor con imanes · Bobina · Rectificador · INA219 · ESP32-S3 · Medición de RPM**

[![Estado](https://img.shields.io/badge/estado-en%20construcción-0c5ea8?style=for-the-badge)](#-estado-del-proyecto)
[![ESP32-S3](https://img.shields.io/badge/ESP32--S3-medición-082e6b?style=for-the-badge)](#-qué-vamos-a-construir)
[![GitHub Pages](https://img.shields.io/badge/GitHub%20Pages-manual%20web-1f883d?style=for-the-badge&logo=github)](https://asturnando.github.io/generador/)

</div>

---

## 🎯 Qué es este proyecto

Este repositorio contiene el **manual vivo de construcción de una maqueta de generación electromagnética**.

El objetivo no es simplemente conseguir que se encienda algo, sino construir un banco de pruebas que permita estudiar de forma ordenada cómo cambian las medidas eléctricas al variar:

- el **número de imanes** del rotor;
- el **número de espiras** de la bobina;
- la **velocidad de giro**;
- y la configuración utilizada durante cada ensayo.

La maqueta será documentada paso a paso, con fotografías de los componentes reales, dibujos, esquemas de conexión, listas de comprobación y solución de fallos.

> La idea es que alguien que nunca haya montado un circuito pueda seguir el manual sin tener que adivinar qué significa «conectar la fuente al PWM».

---

## 🧩 Qué vamos a construir

```mermaid
flowchart LR
    A[Red eléctrica] --> B[Fuente 12 V]
    B --> C[PWM]
    C --> D[Motor 775]
    D --> E[Rotor con imanes]
    E --> F[Bobina]
    F --> G[Puente rectificador 1N5818]
    G --> H[INA219 + carga]
    H --> I[ESP32-S3]
    I --> J[Software / ordenador]
    E --> K[Sensor de RPM]
    K --> I
```

El sistema se divide en dos partes muy claras:

### 🔵 Circuito que mueve el experimento

`Red → Fuente 12 V → PWM → Motor 775 → Rotor`

Su función es proporcionar un giro **controlado y repetible**.

### 🟢 Circuito que genera y mide

`Rotor → Bobina → Rectificador → INA219 → ESP32-S3`

Aquí es donde mediremos:

- **voltaje**;
- **corriente**;
- **potencia**;
- **RPM**;
- y posteriormente podremos registrar los ensayos en el ordenador.

---

## 🧲 Variables experimentales

La idea inicial es comparar configuraciones manteniendo el resto de condiciones lo más constantes posible.

| Variable | Configuraciones previstas |
|---|---|
| Imanes | 4 · 6 · 8 |
| Imanes principales | Neodimio redondo 15 × 2 mm |
| Espiras | 200 · 400 · 600 · 800 |
| Velocidad | Baja · media · alta |
| Medidas | V · A · W · RPM |

También disponemos de imanes rectangulares para pruebas auxiliares y un sensor Hall KY-003 como alternativa al sensor óptico de RPM.

---

## 🧰 Componentes principales

- Motor DC **775** con soporte y adaptador.
- Fuente conmutada **12 V / 10 A / 120 W**.
- Controlador **PWM 10–60 V / 20 A**.
- ESP32-S3 de **44 pines** con USB-C.
- Sensor de corriente y voltaje **INA219**.
- Sensor óptico **TCRT5000** para RPM.
- Sensor Hall **KY-003** como plan B.
- Protoboard de **830 puntos**.
- Diodos Schottky **1N5818** para construir el puente rectificador.
- Resistencias de potencia **100 Ω / 5 W**.
- Alambre de cobre esmaltado **AWG28**.
- 30 imanes redondos de neodimio **15 × 2 mm**.
- Imanes rectangulares adicionales.
- Cableado, terminales, tornillería y adhesivo candidato —incluido epoxi si resulta compatible—, todos pendientes de validar para su función real.

---

## 📚 Estructura del manual

El manual no se va a comprimir artificialmente. Cada operación tendrá el espacio que necesite.

| Capítulo | Contenido | Estado |
|---|---|---|
| **0** | Preparación, inventario, tablero, herramientas y seguridad | 🟢 Disponible |
| **1** | Cable de red → fuente → salida segura de 12 V | 🟢 Disponible |
| **2** | Fuente → protección/corte DC → PWM → motor 775 → primera rotación sin rotor | 🟢 Disponible |
| **3** | Rotor, patrones 4/6/8, retención, equilibrado y protección | 🟢 Disponible |
| **4** | Construcción de la bobina y derivaciones | 🟢 Guía ampliada paso a paso |
| **5** | Puente rectificador en protoboard | 🟡 Borrador para validar |
| **6** | Soldadura y conexión del INA219 | 🟡 Borrador para validar |
| **7** | Sensor de RPM: TCRT5000 o KY-003 | 🟡 Borrador para validar |
| **8** | Software, calibración y registro de datos | 🟡 Borrador para validar |
| **9** | Plan de ensayos y análisis de resultados | 🟡 Borrador para validar |
| **10** | Fallos frecuentes y diagnóstico | 🟡 Borrador para validar |
| **11** | Presentación y defensa del proyecto | 🟡 Borrador para validar |

---

## 🌐 Manual web

La versión visual del manual se publicará mediante **GitHub Pages**:

### 👉 https://asturnando.github.io/generador/

El objetivo de la web es que pueda consultarse fácilmente desde móvil, tablet u ordenador mientras se monta la maqueta.

Las listas de comprobación, fotografías, esquemas y capítulos irán actualizándose a medida que avance el proyecto.

### Funciones disponibles en los capítulos 0–11

- Inventario visual en fichas grandes de dos columnas y una columna en móvil.
- Fotografías ampliables y optimizadas como WebP, sin imágenes incrustadas en base64.
- Listas independientes de comprobación con contador de progreso y persistencia en `localStorage`.
- Campos de observaciones que también se conservan al cerrar el navegador.
- Botón de borrado con confirmación previa.
- Índice rápido, navegación a la portada e impresión / guardado en PDF.
- Estilos específicos para móvil, tablet, escritorio e impresión.
- Calculadora de RPM basada en pulsos, intervalo y PPR medidos.
- Firmware descargable para escaneo I2C, prueba manual de RPM y registro integrado.
- Plantilla CSV para 36 configuraciones y sus repeticiones.
- Calculadora y plantilla SVG 1:1 para cortar las dos tapas y las cuatro barras desmontables del útil de bobina.
- Calculadora y plano SVG 1:1 para cortar la placa, la base y los dos cartabones del soporte ajustable de la bobina.

### Fotografías y trazabilidad

Las imágenes principales se seleccionaron del paquete de fotografías aportado para el proyecto. Se conservaron los originales fuera del sitio y se generaron copias WebP con nombres descriptivos dentro de `assets/img/`.

La ESP32-S3 utiliza una fotografía real de referencia procedente de la [documentación oficial de Espressif](https://docs.espressif.com/projects/esp-dev-kits/en/latest/esp32s3/esp32-s3-devkitc-1/user_guide_v1.1.html). No se considera prueba de la revisión, memoria o pinout de la placa disponible.

Los cuatro huecos restantes incluyen referencias fotográficas generadas y rotuladas como tales: kit de resistencias, cables Dupont, LEDs e imanes redondos. Sirven para reconocer el tipo de componente, pero no sustituyen la comprobación ni la fotografía de las piezas reales. Esos `dato por verificar` se conservan.

El Capítulo 1 combina las fotografías aportadas del alargador, la fuente, sus bornes, el selector y las horquillas con cuatro referencias generadas: preparación de la mesa, aspecto de los tres conductores, terminaciones crimpadas y concepto de envolvente. Todas están rotuladas como referencias y no se presentan como prueba del montaje real.

El Capítulo 2 utiliza las fotografías aportadas del PWM, motor 775, soporte, medidas anunciadas y cable AWG18. Añade tres referencias generadas y rotuladas —distribución del banco sin cablear, motor sujeto con el eje encerrado y PWM protegido— para explicar principios mecánicos sin presentarlos como montajes reales ni inventar el orden de los bornes.

El proyecto se realizará en **Colombia**. El Capítulo 1 utiliza como referencia una toma doméstica de **120 V AC, 60 Hz**, clavija tipo B con tierra y el código de conductores del [RETIE vigente](https://www.minenergia.gov.co/documents/15921/Libro-3-Resolucion-40284-23-06-2026.pdf) para ese sistema: negro para fase, blanco para neutro y verde para protección. La [Superintendencia de Industria y Comercio](https://www.sic.gov.co/informacion-de-Interes-sobre-congreso-internacional-derecho-de-los-mercados) también identifica 120 V, 60 Hz y clavijas tipo A/B como referencias de uso en Colombia. Las imágenes generadas se corrigieron para mostrar tipo B con tierra y no una clavija europea.

Las imágenes disponibles de la fuente proceden del material/anuncio y no identifican de forma suficiente fabricante o modelo. Por ello el manual conserva como `dato por verificar` bloqueantes la placa real, el manual exacto, la terminación permitida, la longitud de pelado, el par de apriete, la ventilación y el tiempo de descarga. No se autoriza el primer encendido hasta resolverlos.

Las imágenes del PWM tampoco permiten leer con fiabilidad qué bornes son entrada y salida. El Capítulo 2 conserva como `dato por verificar` bloqueantes esa asignación, las corrientes reales del controlador y el motor, el comportamiento de arranque, la protección y el corte DC, la validez del AWG18 y los terminales. La primera prueba se limita al motor desnudo, fijado y con el eje completamente resguardado; el rotor sigue fuera.

El Capítulo 3 documenta la decisión del proyecto de construir el rotor sobre un CD real con configuraciones de 4, 6 y 8 imanes. Incluye un generador de plantillas SVG a escala 1:1 que exige introducir las medidas físicas del CD, el centro y los imanes; no precarga cotas ni representa soportes que no existen. Los huecos del rotor, el montaje final y el resguardo se reservan para fotografías reales tomadas durante la construcción. El adhesivo queda pendiente de validar específicamente para el sustrato real del CD y el revestimiento de los imanes; la prueba motorizada sigue bloqueada hasta cerrar RPM máxima, retención, equilibrado y contención.

Los Capítulos 4–7 reutilizan las fotografías aportadas del cobre AWG28, protoboard, diodos 1N5818, resistencia de potencia, INA219, TCRT5000 y KY-003. Los dibujos de bobina y conexiones son esquemas HTML/SVG deterministas. Molde, soportes, distancias, pinout, niveles y fijaciones permanecen como `dato por verificar` hasta verificarlos en las piezas físicas.

El Capítulo 4 incorpora referencias fotográficas generadas y rotuladas como tales para explicar el útil, su despiece en cuatro barras, el montaje, la extracción, el gesto real del bobinado manual, la forma del bucle continuo en U, un acabado manual aceptablemente irregular y el manejo básico de un multímetro. No representan la bobina construida, no demuestran el conteo y las pantallas del medidor son valores ilustrativos. La primera referencia del molde se conserva por trazabilidad, pero ya no se usa en el capítulo porque parecía una placa con hueco y no mostraba un canal construible. La guía corregida usa dos tapas sólidas y cuatro barras interiores que se extraen hacia el hueco central.

El bobinado ya no se presenta como una sucesión de vueltas perfectas. Antes de abrir el carrete exige ensayar 50 vueltas con hilo desechable, parar y reanudar sin perder el paquete. Durante la pieza real una persona gira el útil y otra guía el hilo; se trabaja en grupos de cinco dentro de bloques de 25, se recolocan solo los grupos nuevos y se admiten desniveles y cruces amplios. Bucles flojos, montones que desbordan, dobleces, raspaduras o una cuenta perdida obligan a parar.

Las referencias iniciales de comienzo y acabado excesivamente ordenados se conservan como archivos para no borrar trazabilidad, pero dejan de utilizarse como objetivo en el capítulo. Las nuevas referencias muestran el útil cerrado durante el giro y un paquete deliberadamente irregular; aun así continúan rotuladas como imágenes generadas y nunca sustituyen la evidencia de la bobina real.

La página `plantilla-util-bobina.html` calcula el despiece SVG 1:1 sin precargar ninguna medida. La página `plantilla-soporte-bobina.html` calcula la placa vertical, la base y dos cartabones a partir del contorno de la bobina terminada y del espacio real disponible. Los orificios de las bridas se transfieren presentando la bobina física para que ninguno atraviese el cobre. Marca, modelo y frontal del multímetro real deben copiarse de su carcasa y manual; por eso las imágenes del medidor enseñan símbolos y bornes genéricos.

Las derivaciones T200, T400 y T600 se documentan como bucles continuos en U: el hilo no se corta durante el bobinado. El método para retirar esmalte y añadir los terminales se mantiene como `dato por verificar` hasta identificar el aislamiento del carrete y validarlo en un retal; no se prescribe llama, temperatura o crimp genérico.

El Capítulo 8 incorpora firmware con configuración bloqueada por defecto: pines `-1`, dirección I2C `0x00` y PPR `0`. No comienza a medir hasta sustituirlos por datos trazables de los capítulos 6 y 7. El Capítulo 9 añade una plantilla CSV y señala una decisión abierta: comparar 4, 6 y 8 imanes con adhesión permanente exige decidir entre tres CDs equivalentes o un sistema desmontable aprobado; no se despegarán imanes entre ensayos.

Los Capítulos 10 y 11 completan diagnóstico, trazabilidad, selección de evidencias reales y defensa. No contienen resultados simulados: tablas y gráficos finales permanecen como `dato por verificar` hasta disponer de datos experimentales.

La imagen del paquete que estaba rotulada como «imanes redondos» sigue descartada porque muestra anillos/adaptadores con orificio, no los discos macizos de 15 × 2 mm descritos en el proyecto.

---

## ✅ Filosofía de montaje

Cada etapa seguirá siempre la misma estructura:

1. **Qué pieza tenemos delante.**
2. **Para qué sirve.**
3. **Qué necesitamos antes de empezar.**
4. **Montaje paso a paso.**
5. **Fotografía o esquema de la conexión.**
6. **Qué debemos comprobar antes de continuar.**
7. **Fallos habituales y cómo solucionarlos.**

No se pasa al siguiente capítulo hasta que el bloque anterior funciona correctamente.

---

## ⚠️ Seguridad

Este proyecto combina electrónica de baja tensión con una **fuente conectada a la red eléctrica** y un rotor mecánico.

Por eso:

- la conexión de red se realiza siempre con la fuente **desenchufada**;
- fase, neutro y tierra deben quedar correctamente identificados y protegidos;
- la posición del selector, si existe, se comprueba en la fuente física y en su manual para el rango que incluya los **120 V, 60 Hz de Colombia**;
- se utiliza una toma tipo B compatible y con tierra funcional, sin adaptadores que eliminen la protección;
- una persona adulta o competente revisa la parte conectada a red antes del primer encendido;
- la hoja de sierra incluida con el kit del motor **no se utilizará**;
- el rotor será un CD real; sus medidas, patrón, retención e interfaz se validarán con el CD, los imanes y el adaptador físicos;
- el rotor definitivo contará con protección;
- las primeras pruebas partirán del menor objetivo de RPM aprobado y siempre con velocidad numérica medida;
- antes de conectar el ESP32 se comprobarán tensiones y polaridades.

---

## 🧪 Qué queremos demostrar

El proyecto no pretende «crear energía de la nada».

El motor actúa como **banco de pruebas** y sustituye a una fuente mecánica variable como el viento. Esto permite comparar configuraciones de generador manteniendo una velocidad de giro conocida y repetible.

La pregunta experimental es, esencialmente:

> **¿Cómo influyen el número de imanes, las espiras de la bobina y la velocidad de giro en la potencia eléctrica obtenida?**

---

## 📁 Estructura del repositorio

```text
generador/
├── index.html                 # Portada e índice de capítulos
├── capitulo-0.html            # Preparación e inventario visual
├── capitulo-1.html            # Cable de red, fuente protegida y prueba de 12 V
├── capitulo-2.html            # Protección DC, PWM, motor y primera rotación sin rotor
├── capitulo-3.html            # Rotor, imanes, retención, equilibrado y resguardo
├── capitulo-4.html            # Bobina AWG28 y derivaciones
├── capitulo-5.html            # Puente 1N5818 y carga
├── capitulo-6.html            # INA219 y ESP32-S3
├── capitulo-7.html            # Sensor y cálculo de RPM
├── capitulo-8.html            # Software, calibración y CSV
├── capitulo-9.html            # Matriz y protocolo experimental
├── capitulo-10.html           # Diagnóstico por subsistemas
├── capitulo-11.html           # Presentación y defensa
├── plantilla-rotor.html       # Generador SVG imprimible 1:1 para 4, 6 u 8 imanes
├── plantilla-util-bobina.html # Generador SVG imprimible 1:1 del útil desmontable
├── plantilla-soporte-bobina.html # Plano SVG 1:1 del soporte ajustable
├── datos/
│   └── plantilla-ensayos.csv  # Registro tabular de la campaña
├── firmware/                  # Escáner I2C, RPM y registrador integrado
├── README.md                  # Este documento
└── assets/
    ├── css/
    │   └── manual.css         # Identidad visual, responsive e impresión
    ├── js/
    │   ├── checklist.js       # Persistencia, progreso y borrado
    │   ├── coil-jig-template.js # Cálculo y SVG 1:1 del útil de bobina
    │   ├── coil-support-template.js # Plano SVG 1:1 del soporte ajustable
    │   └── navigation.js      # Impresión e índice rápido
    └── img/                   # Fotografías WebP con nombres descriptivos
```

El sitio no requiere compilación, dependencias de ejecución ni framework: GitHub Pages puede servir estos archivos directamente.

---

## 🚧 Estado del proyecto

**Recorrido completo en borrador y en construcción física activa.**

Los componentes están llegando y el manual se escribe al mismo tiempo que se valida el montaje real. Por eso puede haber cambios en conexiones, soportes o procedimientos cuando se inspeccionen físicamente las piezas.

Eso no es un problema: forma parte del propio proceso experimental.

---

<div align="center">

### ⚡ Construir · medir · comparar · corregir · repetir

**Proyecto de generador electromagnético experimental**

</div>
