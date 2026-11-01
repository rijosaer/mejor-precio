# Mejor Precio

App web instalable en el teléfono que busca un producto en **Bevgo, Dislicores, Éxito, Makro, Olímpica, Agua Pure, D1 y tus proveedores propios** (más Carulla y Jumbo si las activas) y muestra cuál lo tiene más barato, agrupado por presentación (750 ml, 6 × 330 ml…). Es para uso privado de una o dos personas y se protege con una contraseña.

## Qué precio muestra cada tienda

| Tienda | Fuente | Precio |
| --- | --- | --- |
| Bevgo | API pública de la tienda (WooCommerce) | Tienda en línea |
| Dislicores | Búsqueda predictiva + ficha de producto (Shopify) | Tienda en línea |
| Éxito | Búsqueda pública (VTEX) | Precio nacional en línea (la consulta por región de Valledupar no devuelve licores) |
| Makro | Página de búsqueda con la tienda elegida por cookies | Tienda Makro Valledupar (id 194, código 22Val) |
| Olímpica | Búsqueda pública (VTEX) | Precio nacional en línea |
| Agua Pure | Carta digital pública de TRIVO POS (trivo-pos.com/m/agua-pure), completa en un solo JSON | Domicilio en Valledupar; con promoción, el precio rebajado. Las «Caja de … + Hielo» se cuentan como 24 latas |

| D1 | Búsqueda pública (VTEX) de su tienda a domicilio | Precio nacional (el mismo en sus tiendas de Valledupar), con código de barras |
| Carulla y Jumbo | Búsqueda pública (VTEX); Jumbo en jumbocolombia.com | Precio nacional en línea. Vienen **apagadas**: actívalas en Ajustes → Tiendas |
| Proveedores propios | Los precios que tú anotas, importas de un CSV o pegas de WhatsApp | Lo que te cobra tu proveedor |

El envío se suma si lo configuras en Ajustes → Envío por tienda. Lo que responde cada tienda se guarda 10 minutos (por tienda: si una falla, solo esa se vuelve a consultar).

## Qué más hace

Los ajustes, el historial y los avisos se guardan en el navegador (`localStorage`). **Mi lista** y su monitoreo viven además en el servidor (Netlify Blobs; archivos en `datos/` con `server.js`): una función programada revisa cada hora los productos que llevan 6 horas sin revisarse, aunque nadie abra la app, y al abrirla el navegador baja lo nuevo. La explicación completa de cada módulo, sus constantes, sus fórmulas y cómo probarlo está en [`docs/como-funciona.md`](docs/como-funciona.md).

- **Histórico de precios**: cada búsqueda registra el precio de cada producto. En la fila, **Historial** muestra la gráfica de 1, 3, 6 o 12 meses con mínimo, máximo, promedio y un veredicto («mínimo del período» o «precio inflado»), y etiquetas «Bajó $X», «Subió $X» o «Mínimo histórico». Se guarda un año: día por día los últimos 90 días y un punto por semana antes.
- **Ofertas y liquidaciones**: si la tienda tacha un precio, la fila muestra «Oferta −X %» (desde 5 %) o «Liquidación −X %» (desde 25 %).
- **Avisos**: punto dulce (baja más de 3 % bajo el mínimo de los últimos 7 días), precio objetivo («Avísame bajo $» en Mi lista, solo con la misma presentación), últimas unidades o «se agota en ~N días» (con el stock real que publica Makro Valledupar), se agotó, volvió a haber, empezó una oferta, y «ninguna tienda lo tiene». Los de Mi lista llegan aunque no hayas buscado; «Ver» abre la búsqueda.
- **Catálogo de reventa**: marca en **Catálogo** los productos de la lista que vendes, con tu precio y una regla (margen objetivo o seguir al mercado con piso sin pérdida). La app sugiere el precio, dice cuáles subir, bajar o pausar porque nadie los tiene, aplica los sugeridos y exporta un CSV para tu tienda.
- **Código de barras**: escribe o escanea (Chrome en Android) un EAN. Dislicores, Éxito y Olímpica lo buscan exacto; en Bevgo y Makro, que no lo publican, se busca por el nombre y el mismo tamaño. En las búsquedas normales, «Mismo código en N tiendas» confirma que es el mismo producto.
- **Margen neto**: en la fila, **Margen** calcula `precio de venta − (compra + envío + comisión de pago + impuestos)` y avisa si da pérdida. Los valores por defecto se configuran en **Ajustes** y cada producto recuerda lo que escribiste.
- **Logística**: en **Ajustes** marcas tu ubicación y la de cada tienda (enlace de Google Maps o `lat, lng`). Puedes ordenar los resultados por «precio + traslado», contando ida y vuelta con un costo por kilómetro. Las tiendas sin coordenadas cuentan con costo cero.
- **Puntos y cashback**: porcentaje por tienda que se suma al margen de la calculadora.
- **Mi tienda** (Agua Pure): cada producto de tu carta en TRIVO POS contra el más barato de las demás tiendas (el mismo paquete o juntando paquetes más chicos; las cajas con hielo sin el valor del hielo), con el precio sugerido según tu regla (cuánto sobre el más barato, recargo de las frías, margen mínimo sobre el costo, redondeo) y exportación en CSV. En las búsquedas tu tienda sale aparte como «Tu precio». Se actualiza sola, unos productos cada hora. Con `TRIVO_USUARIO` y `TRIVO_CLAVE` lee de TRIVO (solo lectura) los costos reales —los paquetes y cajas, calculados desde la lata—, las existencias y las ventas de 30 días. Cuando cargas una compra en TRIVO propone el precio con tu margen esperado (como lo calcula TRIVO, redondeado hacia arriba a la centena) y lo cambia en TRIVO solo cuando lo apruebas; cada cambio se puede deshacer.
- **Listas predeterminadas**: en Mi lista, 14 cervezas y 10 licores armados con búsquedas reales (cada uno en el tamaño que más tiendas comparan, entre 4 y 8 tiendas). Las cervezas también están como botones debajo del buscador.
- **Búsqueda precisa**: palabra por palabra («ron» no trae «toronja»), la marca es obligatoria («johnnie walker black» no trae el Red Label), tolera abreviaturas y errores de una letra, oculta las variantes que no escribiste (zero, sin azúcar, tapa azul, sabores) y propone «¿Quisiste decir…?».
- **Fotos y ficha**: cada fila trae la foto del producto; al tocarla se abre la ficha con la imagen grande, la presentación en cada tienda, el historial y el «mejor momento para comprar».
- **Precio por litro**: en cada fila y grupo, orden por precio por litro y aviso de qué presentación sale más barata.
- **Filtros y compartir**: solo ofertas, rango de precio y tiendas visibles; compartir el resultado, la propuesta o el plan de compra por WhatsApp.
- **Proveedores propios**: distribuidores sin página web, creados a mano o importados (CSV de Excel, celdas copiadas o la lista que mandan por WhatsApp). Entran a la comparación como una tienda más.
- **Mi pedido**: varios productos con su cantidad; la app arma el plan de compra más barato entre tiendas, contando envío, envío gratis y pedido mínimo.
- **Inventario y ventas**: «Compré», «Vendí» y «Contar» en Catálogo; ganancia por mes, productos que más rotan y aviso de pocas unidades.
- **Notificaciones push** con horario de silencio, resumen semanal los lunes y aviso si una tienda deja de responder (**Estado de las tiendas**).
- **Ajustes compartidos** entre las dos personas, tiendas activas, presentaciones favoritas, orden inicial, umbrales de oferta, frecuencia del monitoreo, tema claro/oscuro, tamaño de letra y respaldo en archivo.
- **Escáner** en Android (detector del navegador) y en iPhone (ZXing incluido en `public/vendor/`).

## Cómo buscar

- Escribe la marca y el tamaño: `aguardiente antioqueño 750`, `cerveza aguila`, `whisky johnnie walker black`.
- Todas las palabras deben aparecer en el nombre del producto. Los números van completos: `750` no encuentra `1750`.
- Si el tamaño no existe (el Black Label viene en 700 ml), la app ofrece buscar sin el tamaño.
- Cada grupo muestra el más barato por tienda. «Ver las N opciones» abre todas las variantes de esa presentación.

## Correr en el computador

Requiere Node.js 20 o superior. Instala la única dependencia con `npm install` (`@netlify/blobs`, que solo se usa en Netlify).

```bash
APP_PASSWORD=una-clave SESSION_SECRET=texto-largo-aleatorio npm start
# abre http://localhost:3000
```

En PowerShell:

```powershell
$env:APP_PASSWORD="una-clave"; $env:SESSION_SECRET="texto-largo-aleatorio"; npm start
```

Probar la app sin internet, con respuestas de ejemplo de cada tienda (contraseña `prueba`):

```bash
npm run prueba-local
```

Notificaciones push (opcional): crea las claves y ponlas en las variables `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` y `VAPID_SUBJECT`:

```bash
npm run claves-push
```

Probar las tiendas desde la terminal (sin abrir la app):

```bash
npm run probar -- "aguardiente antioqueño 750"
npm test
```

## Publicar en Netlify

En Netlify la carpeta `public/` es el sitio y la API (`/api/*`) corre como función (`netlify/functions/api.mjs`, que usa `src/api.js`). `server.js` no se usa allí.

```bash
npm install -g netlify-cli
netlify login
netlify deploy --prod            # la primera vez pide crear o elegir el sitio
netlify env:set APP_PASSWORD "la-clave"
netlify env:set SESSION_SECRET "texto-largo-aleatorio"
netlify env:set TRIVO_USUARIO "usuario-de-trivo"   # opcional: costos, existencias y ventas de Mi tienda
netlify env:set TRIVO_CLAVE "clave-de-trivo"
netlify deploy --prod            # otra vez, para que la función tome las variables
```

Diferencias con el servidor propio: cada búsqueda tiene 10 segundos (cada tienda, 9) y la caché de 10 minutos y el límite de intentos de contraseña solo valen dentro de cada instancia de la función.

## Publicar en Railway

1. Sube esta carpeta a un repositorio de GitHub.
2. En Railway: **New Project → Deploy from GitHub repo** y elige el repositorio. Railway detecta Node y usa `npm start`.
3. En **Variables** agrega `APP_PASSWORD` y `SESSION_SECRET` (y, para Mi tienda con TRIVO, `TRIVO_USUARIO` y `TRIVO_CLAVE`).
4. En **Settings → Networking** genera un dominio público.
5. Abre ese enlace en el teléfono, entra con la contraseña y en el menú del navegador elige **Agregar a pantalla de inicio** (Android) o **Compartir → Agregar a inicio** (iPhone).

## Publicar una actualización

Cada versión queda marcada en la app («Versión 2.0 · Novedades» al pie de la página). La primera vez que alguien entra en un dispositivo después de una actualización se abre **Nuevas actualizaciones**, con el **antes y el ahora** de cada función. Para publicar una:

1. En `public/novedades.js`, agrega la versión **al principio** de `VERSIONES`: número, fecha, título y sus cambios (`titulo`, `antes`, `ahora` y, si quieres un botón «Probarlo», `donde` con la vista: `proveedores`, `pedido`, `ventas`, `ajustes`, `lista`, `catalogo`).
2. En `public/sw.js`, cambia `VERSION` a `mp-<número>` (`npm test` falla si se te olvida).
3. Publica como siempre. Si la app estaba abierta, aparece «Hay una versión nueva · Actualizar».

## Si una tienda deja de funcionar

Cada tienda está en su propio archivo en `src/tiendas/`. Si una cambia su página, solo falla esa: la app muestra el error en su pastilla y las demás siguen funcionando.

- **«La tienda frenó las consultas»**: Bevgo usa una protección anti-robots que se activa con muchas consultas seguidas. Se quita sola en unos minutos.
- **Makro «cambió de formato»**: Makro carga los productos dentro del HTML de su página de búsqueda (`src/tiendas/makro.js`). Si rediseñan el sitio hay que ajustar la lectura.
- **Cambiar la tienda de Makro**: usa las variables `MAKRO_STORE_ID` y `MAKRO_STORE_REF`.

## Estructura

```
server.js              servidor: contraseña, API, archivos de la app y monitoreo cada hora
src/api.js             rutas /api/* (las comparte la función de Netlify)
src/comparador.js      consulta las tiendas en paralelo, caché por tienda y estadísticas
src/normalizar.js      tamaños, unidades, grados, coincidencia de palabras, variantes y firma
src/tiendas/*.js       un lector por tienda (vtex.js sirve para Carulla y Jumbo)
src/proveedores.js     proveedores propios sin página web
src/monitor.js         Mi lista, revisión programada, avisos, salud de tiendas y resumen semanal
src/config.js          frecuencia, tiendas y silencio del monitoreo; ajustes compartidos
src/push.js            notificaciones push
src/inventario.js      compras, ventas y conteos
src/almacen.js         Netlify Blobs en Netlify; archivos JSON en datos/ con server.js
netlify/functions/     api.mjs (la API) y monitor.mjs (función programada cada hora)
public/                la app: un módulo por vista (resultados, lista, catálogo, pedido, ventas,
                       proveedores, ajustes, estado) + datos.js, reglas.js y funciones puras
tests/                 lectura de cada tienda (fixtures), precisión, API, monitoreo, pedido, CSV
scripts/               probar.js (tiendas reales), servidor-prueba.js (sin internet), claves-push.js
```
