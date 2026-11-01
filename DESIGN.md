# Diseño de Mejor Precio

Registro del sistema visual. Modo de superficie: **Operar** — la persona viene a comparar y decidir rápido, no a admirar la pantalla. Cualquier cambio nuevo debe encajar aquí; si no encaja, se cambia este documento, no se fuerza el componente.

## Mundo visual: «anaquel»

El objeto de referencia es la **etiqueta de precio del anaquel** de una licorería: papel claro, tinta negra y una etiqueta amarilla que señala la decisión. De ahí salen tres reglas:

1. El amarillo **solo aparece donde hay una decisión**: el botón *Buscar*, la etiqueta del ganador, el botón de herramienta activo y el último punto de la gráfica. No decora.
2. El fondo es papel frío, no blanco puro: los grupos de resultados se leen como fichas apoyadas sobre el mostrador.
3. Los precios son la tipografía más grande de la pantalla. Nada compite con ellos.

## Color

| Token | Valor | Uso |
| --- | --- | --- |
| `--papel` | `#eef0f3` | Fondo de la app |
| `--superficie` | `#ffffff` | Tarjetas, controles |
| `--superficie-2` | `#f5f6f8` | Paneles insertos, chips neutros |
| `--tinta` | `#14171c` | Texto principal, línea de la gráfica |
| `--tinta-media` | `#3b414b` | Nombres de producto, etiquetas |
| `--tinta-suave` | `#5f6672` | Texto secundario (contraste ≥4.5:1 sobre papel) |
| `--linea` / `--linea-fuerte` | `#e3e6ea` / `#cfd4dc` | Bordes |
| `--etiqueta` | `#ffd028` | Amarillo de decisión |
| `--ahorro` / `--ahorro-fondo` | `#0b7a4b` / `#e7f4ec` | Bajó, mínimo histórico, neto positivo |
| `--perdida` / `--perdida-fondo` | `#b42318` / `#fbeceb` | Subió, tienda caída, pérdida |
| `--aviso` / `--aviso-fondo` | `#8a5200` / `#fdf4e3` | Alertas de punto dulce, traslado, agotado |

Un color por significado. Verde nunca decora: solo dice que el precio bajó o que el margen es positivo.

## Tipografía

**Archivo** (variable 400–800), autoalojada en `public/fuentes/archivo-latin.woff2`, 34 KB, `font-display: swap`. Sin peticiones externas: la política CSP solo permite recursos del propio dominio.

- Precio principal: 19 px / 700, `letter-spacing: -0.025em`, cifras tabulares.
- Título de presentación: 17 px / 700.
- Nombre de producto: 14.5 px / 500.
- Texto secundario: 12.5–13 px.
- Etiquetas de tienda y de estado: 11–12.5 px, versalitas con `letter-spacing` positivo.

Todas las cifras usan `font-variant-numeric: tabular-nums` para que las columnas de precio no bailen.

## Componentes

- **Barra**: pegajosa, blanco translúcido con `backdrop-filter`, borde inferior de 1 px. Marca a la izquierda, acciones a la derecha.
- **Buscador**: tarjeta elevada con el campo y el botón amarillo dentro; el foco se marca con un halo amarillo en vez de un borde azul del sistema.
- **Pastilla de tienda**: punto verde (ok), signo rojo (falló), punto pulsante (cargando).
- **Fila de resultado**: rejilla de tres columnas (tienda · producto · precio). La fila ganadora se marca con un fondo `#fffbee` y la etiqueta amarilla «MEJOR PRECIO»; nunca con un borde grueso de color.
- **Chips**: pastillas pequeñas de estado de precio y de traslado, con fondo teñido del color de su significado.
- **Panel desplegado** (`Historial`, `Margen`): caja inserta sobre la fila, con gráfica SVG o formulario.
- **Alertas**: franja ámbar con una fila por aviso y su botón *Descartar*.

## Movimiento

Un solo momento autorado: los grupos de resultados entran desde abajo con un desfase de 40 ms entre los primeros cuatro (`sube`, 400 ms, curva `cubic-bezier(0.16, 1, 0.3, 1)`). El resto de la interfaz solo tiene transiciones de 150 ms en color y borde. Todo se apaga bajo `prefers-reduced-motion: reduce`.

## Responsive

- 560 px o menos: la fila pasa a dos filas (tienda arriba, producto y precio abajo) y la lista de tiendas de la cabecera se oculta.
- 340 px o menos: el buscador se apila en columna.
- Los controles de texto usan 16 px para que iPhone no haga zoom al enfocar.

## Accesibilidad y acabado

- Foco visible de 2 px en tinta, con radio que sigue la forma del control.
- Selección de texto y cursor con el color de la marca.
- Barra de desplazamiento propia, delgada y neutra.
- Contraste del texto secundario verificado sobre el papel y sobre las superficies teñidas.
