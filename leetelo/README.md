# 📖 Léetelo WebApp — Lector de Libros EPUB, FB2 y CBZ

Aplicación web moderna, ligera y responsiva para leer libros en formatos **EPUB**, **FB2** y **CBZ**. Funciona directamente en **localhost** mediante Node.js y en cualquier dispositivo conectado a tu red local (móviles, tabletas, laptops).

---

## 🚀 Inicio Rápido en Localhost

### Opción 1: En Windows con un solo clic
Haz doble clic sobre el archivo:
> **`abrir-server.bat`** o ejecuta **`npm start`**

Inicia el servidor Node.js y abre automáticamente tu navegador web en `http://localhost:3000`.

### Opción 2: Con Node.js desde la terminal
```bash
npm start
```
*(Inicia el servidor en `http://localhost:3000` y abre el navegador automáticamente).*

---

## 📁 Guardado Físico de Libros en `/libros`

- Cada vez que arrastres o selecciones un libro (`.epub`, `.fb2`, `.cbz`) desde el navegador, este **se guardará físicamente de forma automática en la subcarpeta `/libros`** de tu proyecto.
- Los libros de la carpeta `/libros` están disponibles en cualquier dispositivo conectado a la webapp en la sección **«Libros guardados físicamente en /libros»**.
- También puedes copiar libros manualmente dentro de la carpeta `libros/` y aparecerán al instante.

---

## ⚙️ Ajustes de Personalización

Cualquier ajuste de lectura que configures en la webapp se guarda directamente en el navegador:
- **Temas:** Sepia (`#F4ECD8`), Crepúsculo (`#111923`) y Contraste (`#17181b`).
- **Tipografía y Tamaño:** Tamaño de fuente, familia tipográfica, sliders de interlineado y longitud de línea.
- **Modo de Lectura:** Paginado o Scroll continuo.
- **Paso de Página:** Ninguno, Fundido o Scroll suave con teclas.
- **Paginación en Scroll:** Indicador `#folio` ("Página X de Y") calculado con precisión para todo el libro.
- **Ajustes Específicos por Libro:** Guarda estilos individuales por libro si lo deseas.

---

## 📱 ¿Cómo abrirlo desde un teléfono móvil o tablet?

1. Conecta tu teléfono o tableta a la **misma red Wi-Fi** que tu computadora.
2. Abre el navegador móvil e ingresa la dirección IP de red mostrada en la consola al iniciar el servidor (por ejemplo, `http://192.168.X.X:3000`).
3. Totalmente optimizado y responsivo para pantallas táctiles, teléfonos y tabletas con modo PWA sin conexión.

---

## 📂 Estructura del Proyecto

```text
leetelo/
├── libros/              # Carpeta donde se guardan físicamente todos los libros importados
├── icons/               # Iconos de la aplicación y PWA
├── src/
│   ├── core/            # Motores de renderizado y parseo (EPUB, FB2, CBZ, IndexedDB, etc.)
│   ├── lib/             # Temas, iconos SVG, traducciones y shims del navegador
│   └── reader/          # Lógica de lectura, marcadores, subrayados y biblioteca
├── index.html           # Interfaz principal de la aplicación
├── server.js            # Servidor local Node.js
└── sw.js                # Service Worker para lectura PWA offline
```
├── index.html           # Punto de entrada web principal
├── app.webmanifest      # Manifiesto PWA para instalación en móviles y PC
├── sw.js                # Service Worker para lectura 100% fuera de línea
├── server.js            # Servidor HTTP autónomo de Node.js con endpoint de subida física
├── package.json         # Configuración y comandos npm
├── iniciar-webapp.bat   # Lanzador directo con 1 clic para Windows
└── README.md            # Documentación
```
