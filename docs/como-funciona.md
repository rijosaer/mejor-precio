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
├─ server.js               Servidor local/Railway: estáticos + API + sesión
├─ netlify/functions/api.mjs  Misma API para Netlify
├─ api.js                  Enrutador de la API (entrar, tiendas, buscar)
├─ comparador.js           Orquesta las seis lectoras en paralelo
├─ tiendas/                Una lectora por tienda (bevgo, dislicores, exito, makro, olimpica, aguapure)
└─ public/
   ├─ index.html           Estructura y plantillas de fila/grupo
   ├─ styles.css           Todo el diseño
   ├─ app.js               Interfaz: resultados, paneles, ajustes
   ├─ datos.js             Toda la lógica de cliente (historial, alertas, margen, logística)
   ├─ sw.js                Service worker: la app funciona sin conexión
   └─ fuentes/             Tipografía autoalojada
```

**Importante:** todo lo de los puntos 2, 3 y 4 vive **solo en tu navegador**, en `localStorage`. Por eso funciona igual en local, en Railway y en Netlify sin tocar el servidor, y por eso tus alertas y tu historial no se comparten con nadie más.

### Claves de `localStorage`

| Clave | Contenido |
|---|---|
| `mp-historico` | `{ clave: [ {t, p, d}, … ] }` |
| `mp-alertas` | `[ { clave, nombre, tienda, precio, antes, t } ]` |
| `mp-ajustes` | `{ margen: {…}, logistica: {…}, cashback: {…} }` |
| `mp-venta` | Valores del panel de margen, por producto |
| `mp-recientes` | Últimas 8 búsquedas (los chips) |
| `mp-orden` | `precio` o `total` |
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
5. **Automatizado:** `npm test` cubre `datos.js` (historial, alertas, margen, distancias).

---

## 7. Monitoreo automático, avisos, catálogo y código de barras

**Archivos:** `src/monitor.js`, `src/almacen.js`, `netlify/functions/monitor.mjs`, `public/reglas.js`

### Monitoreo de Mi lista

La lista se guarda en el servidor (`PUT /api/lista`). La función programada corre cada hora y revisa hasta 6 productos que lleven 6 horas o más sin revisarse (de 3 en 3; la función tiene 30 s). Una búsqueda manual de un producto de la lista cuenta como revisión. Por cada producto se guardan hasta 12 resultados por tienda, con un punto cada 3 horas como máximo: `t` fecha, `p` precio, `d` disponible y, si la tienda los da, `s` stock, `a` precio tachado y `n` nota de la oferta. Al abrir la app, `GET /api/monitoreo?desde=<última sincronización>` trae los puntos y avisos nuevos y `fusionarServidor` los suma al historial del navegador.

Almacenamiento (Netlify Blobs, almacén `mejor-precio`): `lista`, `estado` (última revisión por producto), `alertas` (60 más recientes) y `serie/<id>` (historial, avisos ya enviados y resumen del mercado de cada producto).

### Avisos

| Tipo | Cuándo |
|---|---|
| `dulce` | Baja más de 3 % bajo el mínimo de lo registrado hace más de 7 días (3 registros mínimo). |
| `umbral` | El más barato **con todas las palabras de la búsqueda** (tamaño incluido) llega al «Avísame bajo $». Vuelve a avisar solo si baja más. |
| `agota` | Quedan 5 unidades o menos, o al ritmo de venta de los últimos 14 días alcanzan para 3 días o menos. Una vez por reposición. Solo Makro publica su stock real (Bevgo, cuando queda poco). |
| `agotado` / `volvio` | Cambia la disponibilidad entre dos lecturas. |
| `oferta` | Aparece un precio tachado o una nota de oferta que antes no estaba. |
| `sinstock` | Al menos 3 tiendas respondieron y ninguna tiene disponible el producto exacto. |

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

**¿Se pierde mi historial si borro los datos del navegador?** Sí. No está en ningún servidor. Si cambias de dispositivo empiezas de cero.

**¿Puedo añadir otra tienda?** Crea `src/tiendas/mi-tienda.js` con `tienda` y `buscar`, y agrégala al arreglo `TIENDAS` de `src/comparador.js`, a `app.js` y a la cabecera de `index.html`.
