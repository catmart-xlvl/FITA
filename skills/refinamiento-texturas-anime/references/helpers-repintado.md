# Helpers oficiales de repintado local

Prioridad: **proyección ajena → sombras incorrectas → continuidad y márgenes**. El agente identifica los fallos comparando concepto, Base Color y geometría desde varios ángulos; el helper no reconoce automáticamente ropa o piel. Trabajar sobre el atlas vigente sin rehacer UV ni generar otra textura.

## Preparación

1. Ejecutar `node RETOCAR_TEXTURAS.mjs extract`. Leer `atlas-index.json`. Solo Base Color editable; conservar fuentes. Si ya hay pintura válida en `edited/`, guardar una copia inmutable en `paint-input/` y usarla como entrada del plan para no perderla. Nunca usar `edited/` como entrada directa ni aplicar repetidamente un ajuste aditivo.
2. Ejecutar `python PINTAR_TEXTURAS.py surface body 0` para el atlas realmente identificado, no copiar esos índices. El helper lee la geometría/UV actual de `models/`, considera transformaciones, canal UV y transformación de textura y escribe `paint-surfaces/<parte>_<índice>.json/.npz`, ocupación y guía de orientación. UV glTF e imágenes: origen arriba a la izquierda. No invertir V otra vez.
3. Si faltan NumPy, Pillow o SciPy, ejecutar `python PINTAR_TEXTURAS.py setup`: instala dependencias únicamente en `.paint-libs` del workspace. `paint-runtime.json` puede localizar las dependencias de la aplicación ya instaladas. No se usa Tripo ni ImageGen.

## Plan revisado

Crear `paint-plan.json` con `schema:fita-local-paint-plan/v1`, `reviewedRegions:true`, `atlases:[...]`. Cada atlas identifica `part`, `index`, `input` (ruta relativa inmutable), `inputHash` SHA-256 real, `paddingPx` medido y `operations`.

Cada operación contiene:

- `id`, `purpose`: `projection-error`, `dirty-shadow`, `contact-shadow`, `temporary-coverage` o `seam-color`.
- `surface:{node,mesh,primitive,faces:[...]}`: índices de la fuente actual y caras revisadas de ESA primitiva. Los números se consultan en la geometría y en el JSON de superficies; no son IDs históricos de segmentación. La selección debe cubrir la misma pieza/material, sus lados y las costuras correspondientes, protegiendo patrones, piel y herrajes vecinos. Revisar en Blender las regiones fusionadas: un componente conectado puede contener varios materiales del diseño.
- `mask`: PNG gris del tamaño exacto del atlas; blanco es reparación completa y negro protección. Puede cubrir varias islas del mismo volumen. `featherPx`: transición de la reparación, elegida según resolución. No confundir esa transición con la definición del borde de una sombra anime.
- `method:clone` y `donorMask`: muestras limpias del MISMO material y de las orientaciones necesarias. El helper busca muestras próximas en 3D, exige orientación compatible (`donorNormalCosine`, por defecto 0.7) y resuelve un relleno armónico del residual conservando el gradiente de esas muestras. Si faltan muestras de una cara superior/interior, seleccionarlas explícitamente o diseñar allí la sombra; no clonar el tono frontal sobre toda la pieza. Conservar las sombras útiles del entorno.
- Para una sombra mal pintada, limpiar primero la mancha y usar otra operación `method:shade` sobre su región revisada. Elegir `lightDirection:[x,y,z]` en espacio glTF de escena, `shadowColor`, `baseColor`, `highlightColor` RGB 0–255 de esa familia de material, `shadowThreshold` y `highlightThreshold` entre 0 y 1 y `bandSoftness` entre 0 y 0.5. El campo interpola normales y produce bandas continuas, sin colores por triángulo. La luz artística es coherente con el concepto; una superficie orientada arriba no es siempre más oscura: decidir por orientación, oclusión y diseño. Pintar aparte sombras de contacto/concavidad revisadas; el producto escalar no calcula oclusión ni interpreta una clavícula.

No convertir todo el cinturón, piel o tela a un color uniforme. Bordes superiores, retornos, cantos e interiores pueden necesitar otros valores de la misma paleta para que la profundidad se lea **en Base Color**, sin depender de la luz del visor. No proyectar la silueta de un cinturón o hebilla sobre el pantalón ni conservar falsas líneas que atraviesan una pieza superpuesta. Limitar esas reparaciones a las superficies receptoras equivocadas; conservar el objeto que realmente corresponde.

## Aplicación y comprobación

Ejecutar `python PINTAR_TEXTURAS.py apply paint-plan.json`. El helper verifica el hash de fuente y entrada, bloquea pintar texels UV compartidos por superficies distintas y conserva alpha, tamaño y píxeles fuera de pincel/margen. Si hay solapamientos de Tripo, revisar solo la región afectada; no iniciar un unwrap ni una reconstrucción facial. Una región compartida que no se pueda corregir sin afectar otra queda pendiente y se explica.

El relleno de margen usa ocupación de **todas** las primitivas de ese atlas y solo texels libres, por borde válido más cercano. No invade islas, difumina el atlas ni altera alpha. `paddingPx:0` permite comprobar un atlas sin extenderlo; elegir el margen por resolución y espacio real, nunca asumir que 32 px siempre bastan. Un atlas sin operaciones puede usar el mismo plan exclusivamente para padding.

Se guardan atlas en `edited/`, máscaras y `output/local-paint-audit.json`. Repetir el MISMO plan y entrada es determinista. Para continuar una pintura anterior, copiar el resultado a una nueva entrada inmutable y actualizar su hash; el helper bloquea sobrescribir trabajo manual ajeno al plan. Verificar las imágenes sobre la malla, en Base Color y luz neutra, desde frente, oblicuas, perfiles y zonas superiores/interiores. Comparar reparación y paleta, no solo cantidad de píxeles cambiados. Revisar cerca y lejos con mipmaps; trasladar la evidencia a jointReview, uvReview y el informe de cambios.

Después usar `RETOCAR_TEXTURAS.mjs build`, integrar rasgos y normales y entregar con los helpers existentes. El helper de pintura no modifica el GLB ni aprueba el acabado. Las selecciones siguen siendo específicas del personaje; **el algoritmo se reutiliza, las máscaras y medidas no**.
