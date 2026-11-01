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
├─ server.js                 Servidor local/Railway: estáticos + API + monitoreo cada hora
├─ netlify/functions/        api.mjs (la API) y monitor.mjs (función programada cada hora)
├─ src/
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
   ├─ index.html · styles.css  Estructura, plantillas y diseño (claro y oscuro)
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

Almacenamiento (Netlify Blobs, almacén `mejor-precio`): `lista`, `serie/<id>` (historial, última revisión, avisos ya enviados y resumen del mercado de cada producto), `alertas/<id>` (30 más recientes por producto) y `alertas/_sistema` (tiendas caídas, resumen semanal). Cada producto tiene sus propias claves para que una búsqueda a mano y la revisión programada no se pisen; dentro de un mismo proceso, `actualizar()` de `almacen.js` además pone en fila las escrituras de una misma clave. Los documentos viejos `estado` y `alertas` se reparten solos la primera vez. Otras claves: `config`, `ajustes`, `push`, `push-pendientes`, `salud`, `semanal`, `movimientos`, `proveedores`, `consulta/<id>` e `intentos`.

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

**Pendiente (necesita credenciales de TRIVO POS):** costos reales de compra, existencias, ventas por producto y aplicar los precios aprobados. La API privada de TRIVO tiene `/api/inventory/resale-products/`, `/api/inventory/product-stock/`, `/api/reports/sales-by-product/`, `/api/purchasing/orders/` y `PATCH /api/catalog/products/<id>/`, con sesión por usuario y contraseña (`/api/auth/login/`, CSRF). Se usarían las variables `TRIVO_USUARIO` y `TRIVO_CLAVE`.
