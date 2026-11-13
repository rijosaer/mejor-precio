# Cómo funciona Mejor Precio

Guía de la lógica de la aplicación. Está pensada para que cualquier persona del equipo (o cualquiera que abra el proyecto) entienda qué hace cada módulo, dónde vive el código y cómo probarlo sin esperar una semana.

---

## 1. El comparador (servidor)

**Archivos:** `src/comparador.js`, `src/tiendas/*.js`, `src/api.js`

El servidor no guarda base de datos. Cuando el navegador pide `/api/buscar?q=…`, el comparador lanza las seis lectoras en paralelo, cada una busca el texto en su tienda, normaliza los resultados y los devuelve:

| Tienda | Archivo | Cómo consulta |
|---|---|---|
| Bevgo | `src/tiendas/bevgo.js` | API de su tienda en línea |
| Dislicores | `src/tiendas/dislicores.js` | API de su tienda en línea |
| Éxito | `src/tiendas/exito.js` | Buscador público |
| Makro | `src/tiendas/makro.js` | Buscador público |
| Olímpica | `src/tiendas/olimpica.js` | API VTEX de inteligente búsqueda |
| Agua Pure | `src/tiendas/aguapure.js` | Carta pública de TRIVO POS (`/api/public/menu/agua-pure/`); trae todo y se filtra aquí |

Cada tienda devuelve `{ id, nombre, ok, productos, ms }`. Si una falla, `ok` es `false` y se muestra el error en su pastilla; las demás siguen. La respuesta completa es:

```json
{
  "consulta": "aguardiente antioqueño 750",
  "consultadoEn": "2026-10-18T18:02:00.000Z",
  "tiendas": [ { "id": "makro", "nombre": "Makro", "ok": true, "productos": [
    { "nombre": "…", "precio": 58900, "precioAntes": null, "ml": 750,
      "unidades": 1, "disponible": true, "url": "https://…", "imagen": "…" }
  ] } ]
}
```

El servidor solo admite la sesión por cookie (`mp`), que se crea en `POST /api/entrar` con la contraseña de `APP_PASSWORD`. Sin ella, `/api/buscar` responde `401 {"error":"Inicia sesión"}`.

---

## 2. Historial de precios y alertas

**Archivo:** `public/datos.js` · **Interfaz:** botón *Historial* de cada fila y el banner de avisos.

Cada vez que haces una búsqueda, `registrar(datos)` recorre todos los productos de todas las tiendas que respondieron y guarda un punto en el historial:

```
clave  →  [ { t: fecha, p: precio, d: disponible }, … ]
```

La **clave** identifica al producto de forma única: `tiendaId|url` (o el nombre sin tildes si no hay URL). Ejemplo: `makro|aguardiente-antioqueno-750ml`.

### Reglas

| Constante | Valor | Qué hace |
|---|---|---|
| `AGRUPA` | 30 minutos | Dos búsquedas seguidas **actualizan** el último punto en vez de duplicarlo. |
| `VENTANA_MINIMO` | 7 días | Para disparar una alerta se miran solo los puntos con más de 7 días de antigüedad. |
| `PUNTOS_MINIMOS` | 3 | Hacen falta tres puntos viejos para poder comparar. |
| `BAJA_MINIMA` | 3 % | La caída debe superar el 3 % para que valga la pena avisar. |
| `DIAS_RETENIDOS` | 365 | Se borra todo lo más viejo que un año. Pasados 90 días queda un punto por semana (el más barato). |
| `MAX_PUNTOS` | 200 | Máximo de puntos por producto. |
| `MAX_CLAVES` | 600 | Máximo de productos distintos recordados. |
| `MAX_ALERTAS` | 30 | Máximo de avisos guardados. |

### Las dos señales

**Chip en la fila** (`estadoPrecio`): compara el precio actual contra el punto anterior (el más reciente con más de 30 minutos).
- `precio < mínimo de todos los puntos` → chip verde **Mínimo histórico**.
- `bajó` → chip **Bajó $X**. `subió` → chip rojo **Subió $X**.

**Alerta de "punto dulce"** (`registrar`): se dispara **solo durante una búsqueda** (por eso no aparece al recargar la página, sino en la siguiente consulta) cuando el precio actual baja más de 3 % por debajo del mínimo de los últimos 7 días. Se acumulan hasta 30 y aparecen en el banner amarillo arriba de los resultados, con botón *Descartar*.

> En resumen: con dos búsquedas segundas no pasa nada (el historial las agrupa). Para ver los chips hace falta que hayan pasado **30 minutos**; para ver una alerta, que hayan pasado **7 días** con al menos tres consultas.

---

## 3. Margen neto

**Archivo:** `public/datos.js` (`margen`, `devolucion`) · **Interfaz:** botón *Margen* de cada fila.

Es la calculadora de "si lo vendo en el marketplace, ¿me queda?". Los valores por defecto se guardan en Ajustes y puedes cambiarlos en cada fila:

```
comisión   = venta × comisiónPct/100 + comisiónFija
impuestos  = venta × ivaPct/100
costo      = compra + envío + comisión + impuestos
neto       = venta − costo
porcentaje = neto / venta × 100
```

Si has puesto un porcentaje de cashback para esa tienda en Ajustes, se suma al final: `neto + devolución`. Los campos que escribes en una fila se guardan por producto (`mp-venta`) y se restauran la próxima vez que abras ese panel.

---

## 4. Logística y cashback

**Archivo:** `public/datos.js` (`trasladoInfo`, `coordenadasDe`, `distanciaKm`) · **Interfaz:** sección Logística de Ajustes y el selector *Ordenar por*.

Para cada tienda pegas el enlace de Google Maps (o escribes `lat, lng`). `coordenadasDe` entiende los tres formatos habituales de los enlaces de Maps. Con la fórmula de Haversine se calcula la distancia y se duplica (ida y vuelta):

```
km_total  = haversine(tu ubicación, tienda) × 2
costo     = km_total × porKm
total     = precio + costo
```

Si activas *Sumar el costo de traslado al comparar*, el selector de orden habilita la opción **precio + traslado** y cada fila muestra un chip `12,4 km · +$9.920 de traslado`. Las tiendas sin coordenadas se cuentan con costo cero.

El cashback es un porcentaje por tienda (por ejemplo 2 % en Rappi) que se suma al margen neto, no al precio de compra.

---

## 5. Dónde vive cada cosa

```
mejor-precio/
├─ server.js                 Servidor local/Railway: tienda en «/», panel en /panel, API y monitoreo cada hora
├─ netlify/functions/        tienda.mjs (página principal), api.mjs (la API) y monitor.mjs (cada hora)
├─ src/
│  ├─ tienda.js              Tienda pública: carta de TRIVO → HTML con SEO, robots.txt y sitemap.xml
│  ├─ caja.js                Pedidos de la tienda pública → TRIVO (medios de pago, domicilio, ubicación, estado)
│  ├─ api.js                 Rutas /api/*: sesión, búsqueda, lista, push, inventario, proveedores…
│  ├─ comparador.js          Consulta las tiendas en paralelo, caché por tienda, estadísticas
│  ├─ normalizar.js          Tamaños, unidades, grados, coincidencia de palabras, variantes, firma
│  ├─ tiendas/               Una lectora por tienda (+ vtex.js para Carulla y Jumbo)
│  ├─ proveedores.js         Proveedores propios (sin página web)
│  ├─ monitor.js             Mi lista, revisión programada, avisos, salud de tiendas, resumen semanal
│  ├─ config.js              Frecuencia, tiendas y silencio del monitoreo; ajustes compartidos
│  ├─ push.js                Notificaciones push (Web Push)
│  ├─ inventario.js          Compras, ventas y conteos
│  └─ almacen.js             Netlify Blobs o archivos en datos/; `actualizar` sin pisarse
└─ public/
   ├─ tienda.css · tienda.js  Diseño, buscador y carrito/pedido de la tienda pública (página principal)
   ├─ panel.html · styles.css  El panel (/panel): estructura, plantillas y diseño (claro y oscuro)
   ├─ app.js                 Arranque, navegación, búsqueda y autocompletar
   ├─ resultados.js          Grupos, filas con foto, ficha, filtros, avisos, precio por litro
   ├─ lista.js · catalogo.js · pedido.js · ventas.js · proveedores.js · ajustes.js · estado.js
   ├─ escaner.js             Código de barras (detector del navegador o ZXing en vendor/)
   ├─ sync.js                Lo que se copia del servidor (lista, ajustes, movimientos, tiendas)
   ├─ datos.js · reglas.js   Historial, alertas, margen, logística, envíos, precio sugerido
   ├─ optimizar.js · csv.js · inventario.js   Funciones puras (con tests)
   ├─ util.js                Utilidades comunes
   └─ sw.js                  Service worker: funciona sin conexión y recibe notificaciones
```

El historial, los avisos y los ajustes viven en el navegador (`localStorage`), pero ya no solo ahí: el servidor guarda el historial de cada búsqueda (`consulta/<id>`) y lo devuelve con los resultados, Mi lista y su monitoreo, una copia de los ajustes (gana el más reciente), el inventario y los proveedores. Así las dos personas ven lo mismo y nada se pierde al borrar los datos del teléfono. Además, **Ajustes → Respaldo** baja todo lo del navegador en un archivo.

### Claves de `localStorage`

| Clave | Contenido |
|---|---|
| `mp-historico` | `{ clave: [ {t, p, d}, … ] }` |
| `mp-alertas` | `[ { clave, nombre, tienda, precio, antes, t } ]` |
| `mp-ajustes` | `{ margen: {…}, logistica: {…}, cashback: {…} }` |
| `mp-venta` | Valores del panel de margen, por producto |
| `mp-recientes` | Últimas 8 búsquedas (los chips) |
| `mp-orden` | `precio`, `total` (precio + envío o traslado) o `litro` |
| `mp-filtros` | `{ soloOfertas, min, max, ocultas: [tiendas] }` |
| `mp-variantes` | `true` para mostrar también las variantes que no se escribieron |
| `mp-pedido` | Productos de Mi pedido con sus ofertas por tienda |
| `mp-nombres` | Nombres vistos para autocompletar |
| `mp-movimientos` · `mp-proveedores` · `mp-tiendas` · `mp-config` | Copias de lo que vive en el servidor |
| `mp-solo-disponibles` | `true` / `false` |

---

## 6. Cómo probar cada módulo

1. **Comparador:** `npm start` → `http://localhost:3000` con la contraseña de `APP_PASSWORD` y busca `aguardiente antioqueño 750`. Deben encenderse seis pastillas.
2. **Historial y chips:** espera 30 minutos y repite la búsqueda, o inyecta historial de mentiras desde la consola del navegador (F12):

```js
(() => {
  const D = 864e5, ahora = Date.now();
  const h = JSON.parse(localStorage.getItem('mp-historico') || '{}');
  const k = Object.keys(h)[0];
  if (!k) return console.error('Primero haz una búsqueda');
  const actual = h[k][h[k].length - 1].p, alto = actual * 1.12;
  h[k] = [{t:ahora-14*D,p:alto,d:true},{t:ahora-11*D,p:alto,d:true},{t:ahora-9*D,p:alto,d:true},
          {t:ahora-6*D,p:actual*1.06,d:true},{t:ahora-2*D,p:actual*1.04,d:true}, ...h[k]];
  localStorage.setItem('mp-historico', JSON.stringify(h));
  console.log('Listo, recarga la página:', k);
})();
```

Al recargar verás el chip de la fila y la gráfica. Si vuelves a buscar, se genera la alerta de punto dulce.
3. **Margen:** botón *Margen* → escribe un precio de venta y mira las tres líneas de salida.
4. **Logística:** Ajustes → Logística → pega tu ubicación y la de Makro (o dos enlaces de Maps) → *Guardar* → activa *precio + traslado* en el orden.
5. **Sin internet:** `npm run prueba-local` levanta la app con respuestas de ejemplo de cada tienda (`tests/fixtures/`) en `http://localhost:3000`, contraseña `prueba`.
6. **Automatizado:** `npm test` cubre la lectura de cada tienda con respuestas guardadas, la precisión de la búsqueda, la API (sesión, límites, proveedores, inventario), el monitoreo, el pedido, el CSV y la lógica del navegador. GitHub Actions lo corre en cada push (`.github/workflows/pruebas.yml`).

---

## 7. Monitoreo automático, avisos, catálogo y código de barras

**Archivos:** `src/monitor.js`, `src/almacen.js`, `netlify/functions/monitor.mjs`, `public/reglas.js`

### Monitoreo de Mi lista

La lista se guarda en el servidor (`PUT /api/lista`). La función programada corre cada hora y revisa hasta 6 productos que lleven 6 horas o más sin revisarse (de 3 en 3; la función tiene 30 s). Una búsqueda manual de un producto de la lista cuenta como revisión. Por cada producto se guardan hasta 12 resultados por tienda, con un punto cada 3 horas como máximo: `t` fecha, `p` precio, `d` disponible y, si la tienda los da, `s` stock, `a` precio tachado y `n` nota de la oferta. Al abrir la app, `GET /api/monitoreo?desde=<última sincronización>` trae los puntos y avisos nuevos y `fusionarServidor` los suma al historial del navegador.

Almacenamiento (Netlify Blobs, almacén `mejor-precio`): `lista`, `serie/<id>` (historial, última revisión, avisos ya enviados y resumen del mercado de cada producto), `alertas/<id>` (30 más recientes por producto) y `alertas/_sistema` (tiendas caídas, resumen semanal). Cada producto tiene sus propias claves para que una búsqueda a mano y la revisión programada no se pisen; dentro de un mismo proceso, `actualizar()` de `almacen.js` además pone en fila las escrituras de una misma clave. Los documentos viejos `estado` y `alertas` se reparten solos la primera vez. Otras claves: `config`, `ajustes`, `push`, `push-pendientes`, `salud`, `semanal`, `movimientos`, `proveedores`, `consulta/<id>`, `intentos`, `whatsapp`, `whatsapp-opciones`, `whatsapp-entrantes`, `avisos-enviados` y `avisos-historial`.

La frecuencia (3, 6, 12 o 24 horas) y las tiendas que se revisan se eligen en **Ajustes**.

### Avisos

| Tipo | Cuándo |
|---|---|
| `dulce` | Baja más de 3 % bajo el mínimo de lo registrado hace más de 7 días (3 registros mínimo). |
| `umbral` | El más barato **con todas las palabras de la búsqueda** (tamaño incluido) llega al «Avísame bajo $». Vuelve a avisar solo si baja más. |
| `agota` | Quedan 5 unidades o menos, o al ritmo de venta de los últimos 14 días alcanzan para 3 días o menos. Una vez por reposición. Solo Makro publica su stock real (Bevgo, cuando queda poco). |
| `agotado` / `volvio` | Cambia la disponibilidad entre dos lecturas. |
| `oferta` | Aparece un precio tachado o una nota de oferta que antes no estaba. |
| `sinstock` | Al menos 3 tiendas respondieron y ninguna tiene disponible el producto exacto. |
| `tienda` | La búsqueda de control diaria («aguila») falla o no devuelve productos en una tienda dos días seguidos. |
| `semanal` | Los lunes desde las 8 a. m.: qué productos de la lista bajaron o subieron frente a hace una semana. |

Con las claves VAPID configuradas, los avisos llegan como notificación push. Con más de 3 a la vez llega una sola que los resume; en el horario de silencio se guardan y salen en la siguiente revisión.

Los de stock y condiciones se calculan para los 3 resultados más relevantes de cada tienda. Un aviso descartado no vuelve hasta que el precio baje más (punto dulce) o haya un evento nuevo. Los costos de envío, los tiempos de entrega y los cupones de cada tienda no se pueden vigilar: no salen en las búsquedas públicas, solo al pagar.

### Catálogo (repricing)

`precioSugerido` en `public/datos.js`. El costo real de compra es `precio + traslado − cashback` de la tienda más conveniente del resumen del mercado.

```
piso    = (costo + envío + comisión fija) / (1 − comisión% − impuestos%)
margen  = (costo + envío + comisión fija) / (1 − comisión% − impuestos% − margen%)
mercado = mediana de las tiendas × (1 − bajo%)   (nunca por debajo del piso)
```

Se redondea hacia arriba a la centena. Un cambio menor al 1 % del precio actual se marca como «mantener». Si ninguna tienda tiene el producto, el estado es «pausar». El CSV usa punto y coma y BOM para que Excel en español lo abra en columnas.

### Código de barras

Si la búsqueda es un número de 8 a 14 dígitos, Dislicores, Éxito y Olímpica buscan ese código y se quedan solo los productos con ese EAN. Con el nombre más completo de esos productos (las tiendas abrevian) se busca en Bevgo y Makro, exigiendo el mismo tamaño y empaque; esas filas dicen «coincide por nombre y tamaño». Los EAN de las tiendas tienen errores (vendedores del marketplace de Olímpica), por eso el resultado se sigue agrupando por presentación.

---

## 8. Preguntas frecuentes

**¿Por qué no me sale ningún chip la primera vez?** Porque no hay puntos anteriores. El chip compara contra la búsqueda anterior y las dos primeras se agrupan en un solo punto.

**¿Por qué la alerta no aparece al abrir la página?** Porque se genera al registrar una búsqueda. Se muestra en la búsqueda siguiente.

**¿Se pierde mi historial si borro los datos del navegador?** Ya no del todo: el servidor guarda el historial de cada búsqueda y de Mi lista, y lo devuelve al volver a buscar. Para lo demás (márgenes, pedido, avisos descartados) usa **Ajustes → Respaldo**.

**¿Puedo añadir otra tienda?** Si es VTEX (como Carulla o Jumbo), basta con `tiendaVtex({ id, nombre, web })` de `src/tiendas/vtex.js`. Si no, crea `src/tiendas/mi-tienda.js` con `tienda` y `buscar`, agrégala al arreglo `TIENDAS` de `src/comparador.js` y suma una respuesta de ejemplo en `tests/fixtures/` con su test en `tests/tiendas.test.js`. Si la tienda no tiene página, créala como **proveedor propio**.

---

## 9. Búsqueda precisa

**Archivo:** `src/normalizar.js` · **Tests:** `tests/precision.test.js`

- **Palabra por palabra.** «ron» ya no encuentra «toronja». Una palabra coincide si es igual, es su plural, una es abreviatura de la otra («aguardient», «antioq», «cristal» → «cristalino»), es sinónimo (`SINONIMOS`) o, con 6 letras o más, solo cambia una letra o dos letras se cruzaron («buchanas», «jhonnie»).
- **Marcas obligatorias.** Todas las palabras propias (marca, variante, color, tamaño) tienen que estar. Las de categoría (`GENERICAS`: whisky, ron, aguardiente, cerveza…) son opcionales porque muchas tiendas no las escriben. Por eso «johnnie walker black» ya no trae el Red Label.
- **Variantes no pedidas.** Zero, sin azúcar, light, tapa azul, sabores, reserva, añejo… (`VARIANTES`). Si hay productos sin variante, los que la tienen se marcan `otraVariante` y se ocultan con la nota «N productos son otras variantes · Mostrarlas». La tapa roja es el Antioqueño de siempre y no cuenta. El monitoreo no usa variantes para el precio objetivo.
- **¿Quisiste decir?** Si una palabra no aparece en ningún nombre, se propone la más parecida entre lo que devolvieron los buscadores de las tiendas (que toleran errores).
- **Mismo producto.** Se unen los que comparten código de barras o **firma** (palabras propias del nombre + ml + unidades + grados): «Mismo producto en N tiendas».
- **Grados** (29°, 40 % vol) en la fila y en la firma.
- **Fotos**: cada tienda trae su foto; para la lista se pide una miniatura (VTEX en la ruta, Shopify con `width`). Tocar la foto abre la ficha con la imagen grande, la presentación en cada tienda y el historial.

## 10. Proveedores propios

**Archivos:** `src/proveedores.js`, `public/proveedores.js`, `public/csv.js`

Distribuidores sin página web. Se crean en **Proveedores**: a mano, importando un CSV (Excel o Google Sheets → Descargar como CSV; columnas `nombre` y `precio`, y si quieres `ml`, `unidades`, `ean`, `disponible`), o pegando la lista de WhatsApp («Antioqueño 750 ml $41.500», una línea por producto) o celdas copiadas de Excel. Cada proveedor activo entra a la búsqueda como una tienda más (`prov-<id>`): mismo filtro de palabras, historial, avisos, Mi lista, Catálogo y Pedido. Su lista nunca sale de la caché, así que un cambio de precio se ve en la búsqueda siguiente. Hasta 20 proveedores de 1.500 productos.

## 11. Mi pedido

**Archivos:** `public/pedido.js`, `public/optimizar.js` · **Tests:** `tests/pedido.test.js`

«Agregar al pedido» guarda la presentación con el precio de cada tienda. La app prueba todas las combinaciones de tiendas (hasta 12) y en cada una manda cada producto a la más barata; suma el envío de cada tienda usada (Ajustes → Envío por tienda: costo, gratis desde, pedido mínimo; o «Lo recojo» con el traslado por km) y descarta las combinaciones que no alcanzan un pedido mínimo. Gana la de menor total y se compara contra comprar todo en una sola tienda.

## 12. Inventario y ventas

**Archivos:** `src/inventario.js`, `public/inventario.js`, `public/ventas.js`

En Catálogo, cada producto que vendes tiene «Compré», «Vendí» y «Contar». El inventario no se guarda: se calcula de los movimientos (`inventarioDe`), con costo promedio ponderado de las compras. Cada venta guarda el costo promedio de ese momento, así la ganancia del mes no cambia si después compras más caro. «Avisar con (u.)» marca los productos con pocas unidades. **Ventas** muestra ingresos y ganancia por mes, los que más rotan en 30 días y el valor del inventario; todo se exporta en CSV.

## 13. Notificaciones push

1. `npm run claves-push` imprime las claves.
2. Ponlas en el servidor: `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` y `VAPID_SUBJECT` (`mailto:tu@correo.com`).
3. En cada teléfono: **Ajustes → Notificaciones → Activar**. En iPhone, primero instala la app en la pantalla de inicio (iOS 16.4 o más).

## 14. Seguridad

- La firma de la cookie incluye un resumen de `APP_PASSWORD`: **cambiar la contraseña cierra todas las sesiones**.
- 10 intentos fallidos cada 15 minutos por IP, contados también en Netlify Blobs (vale para todas las instancias).
- Las rutas que cambian datos exigen `content-type: application/json`, que un formulario de otro sitio no puede mandar.
- El service worker solo guarda respuestas correctas: un error nunca reemplaza la copia buena.

## 15. Mi tienda

**Archivos:** `src/mitienda.js`, `public/mitienda.js`, `public/precios.js` · **Tests:** `tests/mitienda.test.js`

La tienda propia se elige en **Ajustes → Mi tienda** (por defecto Agua Pure; también puede ser un proveedor propio). En las búsquedas no compite: sale como «Tu precio» en cada grupo, y el catálogo de reventa y Mi pedido no la cuentan como lugar de compra.

Para cada producto de la carta (`catalogo()` de `src/tiendas/aguapure.js`) se arma una búsqueda sin las palabras de presentación («cerveza aguila 330») y se consulta el resto de las tiendas. La **referencia** es lo más barato a lo que llega un cliente: el mismo paquete en otra tienda o, si sale menos, el mejor precio por unidad del mismo tamaño multiplicado por las unidades. Las cajas «+ Hielo (3 kilos)» se comparan sin lo que cobras por 3 kg de hielo.

```
objetivo  = referencia × (1 + sobreMinimo % + recargoFria % si es «Fría»)
piso      = costo × (1 + margenMin %)            (si anotaste el costo)
sugerido  = máx(objetivo, piso) + hielo, redondeado
acción    = subir / bajar si el cambio es ≥ tolerancia %; si no, mantener
```

Los resultados se guardan en `mitienda/<id>` y los costos en `mitienda-costos`. El monitoreo de cada hora vuelve a comparar los productos con más de 20 horas.

### TRIVO POS con sesión (solo lectura)

**Archivos:** `src/trivo.js`, `emparejarTrivo` / `sincronizarTrivo` en `src/mitienda.js` · **Tests:** `tests/trivo.test.js`

Con `TRIVO_USUARIO` y `TRIVO_CLAVE` en el servidor, `src/trivo.js` entra (`GET /api/auth/csrf/` → cookie `csrftoken`; `POST /api/auth/login/` con `{username, password}` y `X-CSRFToken` → cookies `access_token` y `refresh_token`) y **solo lee**:

| Ruta | Qué se usa |
| --- | --- |
| `/api/inventory/resale-products/` | `purchase_cost` (costo de compra), `sale_price`, `quantity`, `min_quantity`, `is_low`, `unit_code`; lo mismo por variante en `variants[]` |
| `/api/inventory/product-stock/` | `quantity` por bodega y variante (paginado); se suman las bodegas |
| `/api/reports/sales-by-product/?date_from=&date_to=` | `quantity_sold`, `total_revenue`, `orders_count` por producto (todas las variantes juntas), últimos 30 días en hora de Colombia |

Emparejamiento con la carta (los id de la carta son los de TRIVO, `producto` o `producto-variante`):

- **directo:** el producto o su variante está en «Compra y reventa»: su costo y sus existencias.
- **calculado:** los paquetes (x 6, x 24) y las cajas «+ Hielo» son combos sin costo propio. Se busca la lata suelta (`und`) del mismo tamaño cuya marca contiene a la otra («Club Colombia» ↔ «Club Colombia Dorada»; si hay dos, gana el nombre exacto): costo = unidades × costo de la lata (la variante «Caliente» si tiene) + el hielo de 3 kg en las cajas. Las existencias son las latas y para cuántos paquetes alcanzan.

`POST /api/mi-tienda/trivo` (botón «Leer TRIVO», y el monitoreo cada hora) guarda esos costos en `mitienda-costos` (reemplazan los anotados a mano de esos productos; los demás se quedan) y existencias y ventas en `mitienda-trivo`. Así el precio sugerido usa el costo real y no baja del margen mínimo.

### Precios por compras: tu margen, con tu aprobación

**Archivos:** `cambiarPrecio` y `comprasRecientes` en `src/trivo.js`; `cambiosPorCompra`, `proponerPrecios`, `aplicarPropuesta`, `deshacerCambio` en `src/mitienda.js`; `precioConMargen` en `public/precios.js`.

1. **Detección.** TRIVO no tiene webhooks, así que el monitoreo lee TRIVO cada hora (y el botón «Leer TRIVO» al momento). Una compra es un movimiento `type=purchase` de `/api/inventory/movements/` (lo crean tanto la orden de compra recibida como la compra manual) con id mayor que `ultimaCompra`; también cuenta un `purchase_cost` distinto del de la lectura anterior. Una compra de la lata toca también sus paquetes (x 6, x 24, caja con hielo).
2. **Precio.** Como en la ficha de TRIVO: margen sobre el precio de venta, `precio = costo ÷ (1 − margen %)`. Las «Fría» llevan el recargo de las frías de la regla; si el producto tiene una promo de valor fijo, se suma para que lo que paga el cliente deje el margen. Redondeo **siempre hacia arriba a la centena** (3.215 → 3.300; 3.200 se queda). El margen es el general (20 % por defecto) o el del producto (`mitienda-margen`). Se aplica tu margen aunque el mercado esté más barato.
3. **Aprobación.** Las propuestas quedan en `mitienda-propuestas` y llega un aviso push. Nada cambia en TRIVO hasta tocar «Aplicar» (o «Aplicar todos», con confirmación; un cambio de 30 % o más pide confirmar).
4. **Aplicar.** `cambiarPrecio` lee el producto, comprueba que el precio en TRIVO siga siendo el de la propuesta (si alguien lo cambió, no lo pisa), manda `PATCH /api/catalog/products/<id>/` con `{base_price}` o `PATCH …/variants/<vid>/` con `{price}` y vuelve a leer para confirmar. Es la única escritura en TRIVO. Queda en `mitienda-historial-precios` con el antes y el después, y «Deshacer» vuelve al anterior con la misma comprobación.

Rutas: `PUT /api/mi-tienda/margen`, `POST /api/mi-tienda/propuestas` (calcular todos), `DELETE /api/mi-tienda/propuestas?id=`, `POST /api/mi-tienda/aplicar`, `POST /api/mi-tienda/deshacer`.
## 16. Avisos por WhatsApp al dueño

**Archivos:** `src/whatsapp.js`, `src/respuestas.js`, `notificarAvisos` y `armarMensaje` en `src/push.js`, `avisosDeAtencion` y `recordarPropuestas` en `src/mitienda.js`, `src/hoy.js` · **Tests:** `tests/whatsapp.test.js`, `tests/trivo.test.js`, `tests/hoy.test.js`

Todos los avisos que salen como notificación push salen también por WhatsApp, del número de la empresa al WhatsApp personal del dueño, con la **API oficial de Meta (WhatsApp Cloud API)**. Mejor Precio lo hace por su cuenta; no usa el WhatsApp de TRIVO.

- **Un solo mensaje por revisión**, por secciones y en orden de urgencia (bajo el costo, por aprobar, por pedir, inventario en negativo, ofertas, tiendas, conexiones), cada una con su enlace a la app (`URL` de Netlify o `APP_URL`). Las ofertas de paquetes dicen el precio por unidad y a cuánto la vendes tú.
- **Horario de silencio:** lo urgente (vender bajo el costo) sale igual, marcado «urgente»; lo demás sale junto en la primera revisión de la mañana como «lo de la noche».
- **Sin repetir:** el mismo aviso (tipo, producto y precio) no vuelve a salir en 24 horas (`avisos-enviados`). Las compras, recordatorios y resúmenes sí salen siempre.
- **Si falla el envío** (sin cupo, teléfono desvinculado…) el error queda en `whatsapp.error`, se ve en «Hoy» y en Ajustes, y los avisos vuelven a `push-pendientes` para el próximo intento (si no hay push).
- **Historial:** cada envío y cada respuesta del dueño queda en `avisos-historial` (60 últimos); «Hoy → Avisos enviados» lo muestra con lo que pasó con cada precio (aplicado, por WhatsApp o en la app; descartado; pendiente).
- **Qué avisa:** bajas de precio, precio objetivo, ofertas, se agota / se agotó / volvió (Mi lista); tiendas que no responden y resumen semanal; compra en TRIVO con precios por aprobar y recordatorio diario si siguen esperando (más de 20 h); producto bajo el mínimo de existencias en TRIVO; precio por debajo del costo; TRIVO que deja de responder o vuelve. Los de TRIVO se avisan una vez, cuando aparecen.
- **Texto o plantilla:** primero se manda un texto normal (gratis si el dueño escribió al número de la empresa en las últimas 24 horas). Si WhatsApp responde que pasó esa ventana (error 131047), se manda la plantilla aprobada con todo el texto en su variable `{{1}}` (sin saltos de línea; la plantilla sí tiene costo por mensaje según las tarifas de Meta).

### Cómo conectarlo sin cuenta de Meta (Green-API, con QR)

1. Crea una cuenta en [green-api.com](https://green-api.com) y, en la consola, una instancia del plan **Developer** (gratis: hasta 3 chats al mes; aquí se usa uno, el del dueño).
2. En el servidor pon `GREENAPI_ID` (*idInstance*) y `GREENAPI_TOKEN` (*apiTokenInstance*); si la consola muestra un *apiUrl* distinto de `https://api.green-api.com`, ponlo en `GREENAPI_URL`. Vuelve a publicar.
3. En la app, **Ajustes → Notificaciones → WhatsApp del dueño** aparece el QR (se renueva solo cada 20 s): escanéalo con el WhatsApp de la empresa (WhatsApp → Dispositivos vinculados → Vincular un dispositivo), como en WhatsApp Web. Al vincularse cambia a «WhatsApp de la empresa vinculado»; la sesión la guarda Green-API. Desde ahí también se puede desvincular. (El QR también se puede escanear en la consola de Green-API.)
4. Escribe el número del dueño y toca «Enviar una prueba».

Rutas: `GET /api/whatsapp/vinculo` (estado y QR), `POST /api/whatsapp/desvincular`.

### Aprobar precios respondiendo el WhatsApp (solo Green-API)

Con Green-API cada precio por aprobar (compras en TRIVO, recordatorio diario y productos bajo el costo, que quedan como propuesta con tu margen) llega numerado. El dueño responde:

| Respuesta | Qué hace |
|---|---|
| `1` · `1 3` · `sí 1, 3 y 4` | Pone esos precios en TRIVO (igual que «Aplicar» en Mi tienda: no pisa un precio que cambió en TRIVO, queda en el historial y se puede deshacer) |
| `todos` | Todos los del último mensaje |
| `no 2` · `descartar 2` | Descarta esa propuesta |
| `precios` | Lista de nuevo los pendientes, numerados |
| `ayuda` | Qué se puede responder |

- Se activa en **Ajustes → Notificaciones → WhatsApp del dueño → Activar respuestas** (`POST /api/whatsapp/respuestas`): configura en Green-API el webhook `https://<app>/api/whatsapp/entrante` con `Authorization: Bearer <token>`, donde el token se deriva de `GREENAPI_TOKEN` (no hace falta otra variable). Solo cambia el webhook y los mensajes entrantes; Green-API tarda hasta 5 minutos en aplicarlo.
- Solo cuentan los mensajes del chat del dueño; lo que escriban clientes o grupos al WhatsApp de la empresa, y cualquier texto que no sea una orden, se ignora sin responder.
- Green-API reintenta cada minuto si no recibe respuesta: cada mensaje se atiende una sola vez (`whatsapp-entrantes`) y uno de más de 2 horas no se aplica.
- Los números de un mensaje valen 3 días (`whatsapp-opciones`); después, la respuesta trae la lista actualizada.

No hay plantillas ni ventana de 24 horas: siempre se manda texto. Es una conexión tipo WhatsApp Web, no la API oficial: WhatsApp puede bloquear números que la usan de forma rara (con pocos mensajes a un solo número el riesgo es bajo). Si el teléfono de la empresa cierra la sesión vinculada, hay que volver a escanear el QR.

### Cómo conectarlo con la API oficial de Meta

1. En [Meta for Developers](https://developers.facebook.com/) crea una app de tipo **Business** y agrégale **WhatsApp**. Agrega el número de la empresa (si ya usa la app WhatsApp Business, Meta permite conectarlo sin perder la app; si no, el número debe quedar solo para la API).
2. En **Meta Business Suite → Usuarios del sistema** crea un usuario del sistema con permiso `whatsapp_business_messaging` y genera un **token permanente**.
3. En **WhatsApp Manager → Plantillas** crea una plantilla de categoría **Utilidad**, idioma **Español**, nombre `aviso_mejor_precio`, con el cuerpo `{{1}}` (puede llevar texto fijo antes, por ejemplo «Mejor Precio: {{1}}»). Espera a que Meta la apruebe.
4. En el servidor pon `WHATSAPP_TOKEN` (el token) y `WHATSAPP_PHONE_ID` (el *Phone number ID* del número de la empresa, en WhatsApp → Configuración de la API). Opcionales: `WHATSAPP_PLANTILLA`, `WHATSAPP_IDIOMA` (por defecto `es`), `WHATSAPP_DESTINO`.
5. En la app, **Ajustes → Notificaciones → WhatsApp del dueño**: escribe el número (300 123 4567 se guarda como 573001234567) y toca «Enviar una prueba».
6. El dueño puede escribirle «hola» al número de la empresa: durante 24 horas los avisos salen como texto normal.

Rutas: `GET/PUT /api/whatsapp` (número y encendido), `POST /api/whatsapp/probar`.

## 17. Tienda pública (página principal) y panel

Desde la versión 2.7 la dirección principal es la **tienda pública, sin clave**, y esta app es el **panel administrativo en `/panel`** (misma clave, misma sesión).

**Versión 2 de la tienda (app 3.0):** la tienda se ve como la de quien vende, no como la carta de TRIVO.

- **Marca:** nombre, iniciales, color, tiempo de entrega y frase corta se ponen en el panel (Ajustes → Tienda en línea; `src/marca.js`, blob `tienda-marca`, ruta `/api/tienda-marca` con clave). Por defecto: «Mejor Precio», «MP», verde `#07794C`. El color se oscurece solo si hace falta para que el texto blanco encima se lea (4,5:1). La página no permite estilos en línea, así que los colores llegan en `/marca.css` y el ícono de la pestaña (las iniciales) en `/marca.svg`. No se nombra a TRIVO ni se usan el logo, la portada ni el Instagram de la carta.
- **Páginas:** inicio (`/`), todos los productos (`/productos`, con `?buscar=` para el buscador sin JavaScript), una por categoría (`/categoria/<id>`, con pestañas Unidad / Six pack / Caja, «Menor precio» y «En oferta») y una por producto. Todas van en el mapa del sitio.
- **Inicio:** encabezado con el color de la tienda (iniciales, nombre, «Abierto hasta las 9:00 p. m.» o «Cerrado · abre mañana a las 8:00 a. m.», a dónde se entrega y el buscador), tarjeta con domicilio (el de la sucursal en TRIVO), pedido mínimo y la nota de horario, un carrusel con hasta 5 promociones de hoy (las que TRIVO tiene activas: la de mayor descuento de cada categoría, luego la segunda…, para que no salgan seguidas cinco iguales; con el nombre que les puso el negocio, por ejemplo «Envío gratis»; pasa solo cada 6 s, se detiene si lo tocan, lo miran con el mouse o lo recorren con el teclado, tiene pausa y no se mueve solo con «reducir movimiento»; fondo del color de la tienda y la foto sobre blanco; «Ver todas las promociones» lleva a `/productos?oferta=1`), las categorías, «Recomendados» (lo destacado, promociones y lo primero de cada categoría, con foto) y una fila de 6 por categoría.
- **Producto:** si en la misma categoría están la lata, el six pack y la caja de la misma cerveza, se pasa de una a otra («Presentación»; solo se dice cuánto se ahorra si de verdad sale más barato). Las variantes de TRIVO se escogen como «Temperatura» (Caliente / Fría). Cantidad y «Agregar · $precio» van en una barra fija abajo. «Va bien con» sugiere lo primero de otras categorías (el hielo primero).
- **Tu pedido:** una sola hoja con productos, entrega (con los datos guardados se ve el resumen y «Cambiar»), pago, domicilio y total. **Mis pedidos:** estado paso a paso con la hora en que se vio cada cambio, detalle y botón para escribirle a la tienda; cuando el pedido termina (y hasta 60 días después, aunque ya no se siga) sale «Pedir otra vez»: vuelve a poner lo mismo en el carrito (por id y presentación; los pedidos viejos, por nombre) con los precios de hoy y avisa lo que ya no está.
- **Domicilio gratis:** si en TRIVO hay una promoción de tipo «domicilio gratis» con pedido mínimo, la cotización trae `free_delivery: { applies, missing, promotion_name }` (así la lee la carta de TRIVO). La tienda la pide con el subtotal (aunque no haya dirección): el inicio y cada producto dicen «gratis desde $X» y el pedido muestra «Te faltan $X para el domicilio gratis» con una barra, o «¡Tu domicilio es gratis!». Sin esa promoción en TRIVO no sale nada. **Sin mapa ni datos del domiciliario:** TRIVO no los da.
- **Abierto o cerrado:** lo dice TRIVO (`is_open`); con el horario de cada día (`"0"` = lunes) se calcula hasta qué hora o cuándo abre. El navegador lo vuelve a pedir al cargar (`GET /api/tienda/caja`).

- **De dónde salen los productos:** de la carta pública de TRIVO (`/api/public/menu/agua-pure/`), con su orden de secciones y sin lo que se ocultó en TRIVO. Dentro de cada sección van primero las unidades, luego los six pack y al final las cajas (x 24), cada grupo con su subtítulo cuando la sección los mezcla; dentro de cada grupo, lo destacado primero y luego por marca y tamaño (3 kg antes que 10 kg). Los nombres se ven sin el relleno para el buscador de TRIVO («valledupar», «agua pure»). Para cambiar un precio, una foto o el orden: se cambia en TRIVO y la tienda lo muestra en unos 5 minutos.
- **Presentaciones:** si un producto tiene presentaciones en TRIVO (variantes, por ejemplo la Aguila lata «Caliente» y «Fría»), la tarjeta dice «Desde» y las nombra, el botón es «Escoger» y abre la lista con el precio de cada una. En la página del producto se escogen con botones de opción y el precio cambia al escoger. Google recibe un `AggregateOffer` con el precio más bajo y el más alto.
- **El pedido se hace aquí y entra a TRIVO (versión 2.8):** «Agregar» mete el producto al pedido de la página (se guarda en el navegador). «Ver mi pedido» muestra las cantidades, el subtotal y lo que falta para el mínimo. Después pide nombre, celular, dirección (con «Usar mi ubicación» por GPS), indicaciones y el medio de pago (los mismos de la carta, con la cuenta para transferir), y calcula el domicilio. «Hacer pedido» lo manda a TRIVO por `src/caja.js`, que revisa el pedido contra la carta de hoy (los precios no los pone el navegador) y lo envía a la misma entrada que usa la carta de TRIVO (`/api/public/menu/agua-pure/order/`). El pedido entra a TRIVO igual que uno de la carta, con la nota «Pedido hecho en la página web». El cliente ve el número («Domicilio #12 · Pedido del día #34») y en qué va (lo consulta a TRIVO cada 15 s), y si pagó por transferencia tiene el botón para mandar el comprobante por WhatsApp.
  - Esa entrada no es una API publicada por TRIVO para terceros: si la cambian, el pedido falla y la página ofrece mandarlo completo por WhatsApp (productos, dirección, ubicación y pago). Si la tienda está cerrada, TRIVO lo rechaza y el cliente lo ve; el pedido queda guardado para cuando abran.
  - El navegador no puede hablar con TRIVO directo (TRIVO no permite otros dominios), por eso todo pasa por `/api/tienda/*` (sin clave): `GET caja` (medios de pago y si está abierto), `POST domicilio`, `POST ubicacion`, `POST pedido` y `GET pedido/<uuid>`. Cada IP puede mandar 6 pedidos cada 15 minutos. El pedido lleva una clave única (`idempotency_key`): si se reintenta después de un error de red, TRIVO no lo duplica.
  - **Solo domicilios en la ciudad de la tienda:** si el cliente usa el GPS, el punto se revisa con TRIVO (`reverse-geocode`) contra la ciudad de la sucursal en TRIVO (hoy Valledupar). «Perímetro Urbano Valledupar» y los corregimientos («Valledupar») pasan; otro municipio (La Paz, Codazzi, San Diego…) no: la página lo avisa al marcar la ubicación y el servidor rechaza el pedido (`fuera_de_zona`) sin mandarlo a TRIVO. Si la ubicación no se puede confirmar, tampoco sale (`sin_ubicacion`). Sin GPS (solo la dirección escrita) el pedido sale: la dirección escrita no se puede ubicar con certeza.
  - Después del pedido se ve el detalle completo: productos con presentación y valor, domicilio, total, a quién y a dónde se entrega, pago y hora; cuando TRIVO devuelve su «cuenta» del pedido, los productos y el total salen de ahí. El mensaje de WhatsApp a la tienda lleva el mismo detalle.
  - Sin JavaScript, «+» abre la página del producto y allí «Agregar» pide por WhatsApp.
- **Una página por producto** (`/producto/<nombre>-<id de TRIVO>`), para que Google indexe cada uno por separado: título «<producto> a domicilio en Valledupar | <nombre de la tienda>», descripción con precio, foto grande, migas (Inicio › sección › producto), presentaciones, cantidad, «Agregar al pedido», «¿Tienes dudas?» por WhatsApp y otros productos de la sección (primero los de la misma presentación). Si el nombre cambia en TRIVO, la dirección vieja redirige (301) a la nueva; si el producto sale de la carta, da 404 y Google lo quita.
- **Google:** el HTML se arma en el servidor (`src/tienda.js`) con título y descripción de Valledupar, `canonical` y Open Graph. Datos estructurados: en la principal `LiquorStore` (dirección, teléfono, horario, medios de pago) e `ItemList` con el enlace a cada producto; en cada producto `Product` con `Offer` (precio en COP, disponibilidad) y `BreadcrumbList`. `/robots.txt` deja ver la tienda y no `/panel` ni `/api/`; `/sitemap.xml` lista la principal y cada producto con su foto. Falta un paso manual: dar de alta el sitio en Google Search Console y enviar el sitemap.
- **Velocidad y caídas:** la CDN de Netlify guarda la página 5 minutos y la sigue sirviendo mientras refresca. La última carta buena queda en Blobs (`tienda-carta`): si TRIVO no responde, la página sale con esos precios y un aviso. Si nunca cargó, responde 503 con un aviso corto.
- **Panel:** `/panel` no se indexa (`noindex` y `X-Robots-Tag`). La app instalada y los enlaces viejos de los avisos (`/#mitienda`, `/?q=…`) pasan solos a `/panel`; los avisos nuevos ya enlazan a `/panel`.
