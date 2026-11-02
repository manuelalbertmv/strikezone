# StrikeZone — FPS 3D para navegador

Shooter en primera persona hecho con **Three.js + Vite**, sin assets externos: texturas, modelos y sonidos se generan por código al cargar. Defiende una zona industrial contra **6 oleadas** de enemigos con IA.

## Requisitos

- **Node.js 18 o superior** (probado con Node 22) y npm.
- Navegador moderno con WebGL 2: Chrome, Edge, Firefox o Safari actualizados.

## Instalación y ejecución local

```bash
cd strikezone
npm install        # instala three y vite
npm run dev        # servidor de desarrollo → http://localhost:5173
```

Para probar la versión optimizada de producción:

```bash
npm run build      # genera la carpeta dist/
npm run preview    # sirve dist/ en http://localhost:4173
```

> Abre el juego con `?debug` (por ejemplo `http://localhost:4173/?debug`) para exponer `window.__game` en la consola del navegador.

## Despliegue en internet

`npm run build` genera `dist/`, una web 100 % estática con rutas relativas (`base: './'`), así que funciona en la raíz del dominio o en una subcarpeta.

| Servicio | Pasos |
|---|---|
| **Netlify** | Arrastra la carpeta `dist/` a app.netlify.com/drop. O conecta el repo con *Build command* `npm run build` y *Publish directory* `dist`. |
| **Vercel** | `npx vercel` en la carpeta del proyecto (detecta Vite solo) o importa el repo desde vercel.com. |
| **GitHub Pages** | `npm run build` y publica el contenido de `dist/` en la rama `gh-pages` (p. ej. `npx gh-pages -d dist`). |
| **Cloudflare Pages** | Conecta el repo. Build: `npm run build`, salida: `dist`. |
| **Hosting propio** | Sube el contenido de `dist/` por FTP a la carpeta pública. |

El juego necesita HTTPS (o `localhost`) para que el navegador permita capturar el ratón con Pointer Lock. Todos los servicios anteriores lo dan por defecto.

## Controles

| Tecla | Acción |
|---|---|
| W A S D | Moverse |
| Ratón | Mirar / apuntar |
| Clic izquierdo | Disparar |
| Clic derecho | Apuntar con la mira (ADS) |
| R | Recargar |
| Shift | Correr |
| Espacio | Saltar |
| Ctrl o C | Agacharse (C evita el Ctrl+W del navegador) |
| 1 / 2 / 3, rueda, Q | Rifle / pistola / escopeta, ciclar, arma anterior |
| Esc o P | Pausa |

## Contenido del juego

- **Armas**: rifle M4 automático (30 balas), pistola P-9 semiautomática (12) y escopeta S12 de 9 perdigones con recarga cartucho a cartucho. Cada una tiene su propio daño, cadencia, alcance con caída de daño, dispersión dinámica, retroceso, sonido y animaciones (disparo, recarga, cambio, bombeo, casquillos). Los disparos a la cabeza hacen daño extra.
- **Enemigos** con IA por estados (persecución, ataque, flanqueo lateral, búsqueda de la última posición conocida), línea de visión, reacción a disparos y pathfinding **A\*** sobre una rejilla de navegación:
  - *Soldado*: dispara ráfagas a media distancia.
  - *Asaltante*: rápido, cuerpo a cuerpo.
  - *Pesado*: lento, mucha vida, ráfagas largas.
- **Oleadas**: 6 en total, más numerosas y duras en cada ronda, con pausas que reponen munición y salud.
- **Dificultad**: Fácil, Normal o Difícil. Cambia la vida, el daño, la puntería y el tiempo de reacción de los enemigos, el número de hostiles, la regeneración del jugador y el multiplicador de puntos.
- **Mapa**: complejo industrial de 90 × 90 m. Incluye:
  - almacén con estanterías;
  - oficinas con varias salas y pasillos;
  - ruinas y búnker;
  - plataforma central con escaleras;
  - carriles con camión, contenedores, tanques y barricadas;
  - aparcamiento, grúa y farolas;
  - **barriles explosivos** que pueden estallar en cadena;
  - **botiquines y munición** que reaparecen.
- **HUD**: mira dinámica, marcador de impacto, salud, munición, armas, indicador de recarga, radar, indicadores de daño direccionales, contador de bajas, puntos, registro de bajas, oleada y enemigos restantes.
- **Puntuación**: bonificación por disparo a la cabeza, rachas y oleadas superadas. El récord de cada dificultad se guarda en el navegador.
- **Opciones**: calidad gráfica (baja, media o alta), sensibilidad, campo de visión, volumen, música y contador de FPS.

## Arquitectura

```
src/
├── main.js                  Entrada: comprueba WebGL y crea el juego
├── config.js                Dificultades, calidad gráfica, oleadas, constantes del jugador
├── styles.css               HUD y menús
├── core/
│   ├── Game.js              Bucle con subpasos, estados (menú/partida/pausa/fin), combate, explosiones
│   ├── Input.js             Teclado, ratón, Pointer Lock con reintentos y modo alternativo
│   ├── Audio.js             Sonido sintetizado con Web Audio (disparos, pasos, IA, música)
│   ├── Settings.js          Ajustes persistentes (localStorage)
│   └── WaveDirector.js      Oleadas, aparición escalonada, progresión
├── physics/Collision.js     Colisiones AABB con rejilla espacial, escalones y raycast
├── world/
│   ├── Level.js             Construcción del mapa, iluminación, geometría fusionada
│   ├── Textures.js          Texturas procedurales en canvas
│   ├── NavGrid.js           Rejilla de navegación + A*
│   └── Pickups.js           Botiquines y munición
├── player/Player.js         Movimiento, salto, agacharse, sprint, cámara, salud
├── weapons/
│   ├── WeaponData.js        Estadísticas de las armas
│   ├── Viewmodels.js        Modelos 3D en primera persona
│   └── WeaponSystem.js      Disparo, dispersión, retroceso, recarga, ADS, animación
├── enemies/
│   ├── Enemy.js             Modelo, animación procedural e IA de cada enemigo
│   └── EnemyManager.js      Aparición, actualización, ruido y lista de impactos
├── fx/Effects.js            Partículas, chispas, trazadoras, impactos, explosiones
└── ui/
    ├── HUD.js               Interfaz durante la partida
    └── Menus.js             Menú principal, opciones, controles, pausa, fin
```

**Físicas.** En lugar de Rapier se usa un sistema de colisiones propio basado en cajas (AABB), equivalente para este tipo de juego. Hace movimiento con deslizamiento por paredes, subida de escalones, detección de suelo y techo, y raycast. El mapa está hecho de cajas, así que no hace falta un motor de cuerpos rígidos, y se evita cargar unos 2 MB de WebAssembly.

**Rendimiento.**
- La geometría estática se fusiona por material: unas 50 llamadas de dibujo para todo el mapa.
- Las partículas, impactos y trazadoras usan grupos de objetos reutilizables.
- Los shaders se precompilan al cargar, así que no hay tirones en el primer disparo ni en la primera aparición de enemigos.
- El ancho de sombra sigue al jugador.
- Hay tres niveles de calidad.
- La simulación usa subpasos, así que el juego mantiene la velocidad correcta aunque bajen los FPS.
- La búsqueda A\* usa un montículo sin asignaciones de memoria y un presupuesto de búsquedas por fotograma.

## Pruebas realizadas

El juego se probó automáticamente en Chromium (Playwright) con 40 comprobaciones. Todas pasan:

- arranque, menús y calidad gráfica;
- movimiento, salto, agacharse, sprint y cámara;
- colisión con muros y subida de escaleras;
- persecución de la IA;
- disparo, impactos, bajas, puntuación y HUD;
- recarga, cambio de arma, escopeta, pistola y ADS;
- explosión de barriles, daño direccional y botiquines;
- pausa y continuar con recaptura del ratón;
- reinicio, derrota, victoria y vuelta al menú;
- ausencia de errores de JavaScript.

Para ejecutarlas:

```bash
npm run build && npm run preview          # terminal 1
npm i -D playwright && npx playwright install chromium
node tests/e2e.cjs                        # terminal 2
```
