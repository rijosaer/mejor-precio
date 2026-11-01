# Mejor Precio

App web instalable en el teléfono que busca un producto en **Bevgo, Dislicores, Éxito, Makro, Olímpica y Agua Pure** y muestra cuál lo tiene más barato, agrupado por presentación (750 ml, 6 × 330 ml…). Es para uso privado de una o dos personas y se protege con una contraseña.

## Qué precio muestra cada tienda

| Tienda | Fuente | Precio |
| --- | --- | --- |
| Bevgo | API pública de la tienda (WooCommerce) | Tienda en línea |
| Dislicores | Búsqueda predictiva + ficha de producto (Shopify) | Tienda en línea |
| Éxito | Búsqueda pública (VTEX) | Precio nacional en línea (la consulta por región de Valledupar no devuelve licores) |
| Makro | Página de búsqueda con la tienda elegida por cookies | Tienda Makro Valledupar (id 194, código 22Val) |
| Olímpica | Búsqueda pública (VTEX) | Precio nacional en línea |
| Agua Pure | Carta digital pública de TRIVO POS (trivo-pos.com/m/agua-pure), completa en un solo JSON | Domicilio en Valledupar; con promoción, el precio rebajado. Las «Caja de … + Hielo» se cuentan como 24 latas |

No incluye costos de envío. Los resultados se guardan 10 minutos para no repetir consultas.

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
netlify deploy --prod            # otra vez, para que la función tome las variables
```

Diferencias con el servidor propio: cada búsqueda tiene 10 segundos (cada tienda, 9) y la caché de 10 minutos y el límite de intentos de contraseña solo valen dentro de cada instancia de la función.

## Publicar en Railway

1. Sube esta carpeta a un repositorio de GitHub.
2. En Railway: **New Project → Deploy from GitHub repo** y elige el repositorio. Railway detecta Node y usa `npm start`.
3. En **Variables** agrega `APP_PASSWORD` y `SESSION_SECRET`.
4. En **Settings → Networking** genera un dominio público.
5. Abre ese enlace en el teléfono, entra con la contraseña y en el menú del navegador elige **Agregar a pantalla de inicio** (Android) o **Compartir → Agregar a inicio** (iPhone).

## Si una tienda deja de funcionar

Cada tienda está en su propio archivo en `src/tiendas/`. Si una cambia su página, solo falla esa: la app muestra el error en su pastilla y las demás siguen funcionando.

- **«La tienda frenó las consultas»**: Bevgo usa una protección anti-robots que se activa con muchas consultas seguidas. Se quita sola en unos minutos.
- **Makro «cambió de formato»**: Makro carga los productos dentro del HTML de su página de búsqueda (`src/tiendas/makro.js`). Si rediseñan el sitio hay que ajustar la lectura.
- **Cambiar la tienda de Makro**: usa las variables `MAKRO_STORE_ID` y `MAKRO_STORE_REF`.

## Estructura

```
server.js              servidor: contraseña, búsqueda y archivos de la app
src/comparador.js      consulta las 5 tiendas en paralelo, filtra y guarda en caché
src/normalizar.js      lee tamaños (ml), unidades del empaque y compara nombres
src/tiendas/*.js       un lector por tienda (precio, stock y código de barras)
src/monitor.js         Mi lista en el servidor, revisión programada, avisos y resumen del mercado
src/almacen.js         Netlify Blobs en Netlify; archivos JSON en datos/ con server.js
netlify/functions/     api.mjs (la API) y monitor.mjs (función programada cada hora)
public/                la app (HTML, CSS, JS, manifiesto e íconos)
public/reglas.js       reglas compartidas navegador/servidor: historial, punto dulce, stock, cambios
public/datos.js        histórico de precios, alertas, ajustes, margen, logística y precio sugerido
tests/                 pruebas de lectura de nombres y de la lógica del navegador
scripts/probar.js      prueba de las 5 tiendas desde la terminal
```
