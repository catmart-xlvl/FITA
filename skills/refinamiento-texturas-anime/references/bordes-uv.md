# Bordes negros de islas UV

## Lo que funcionó en Example

El pintado terminaba en el borde útil de la isla. Al filtrar la textura, el visor mezclaba esos píxeles con el fondo oscuro del margen y aparecían líneas negras. Se extendió la correspondencia de superficie y la máscara de pintura **10 píxeles hacia el margen de un atlas 4096 × 4096**, aplicando allí el mismo color retocado. No se cambió la malla ni se rehízo el unwrap.

## Aplicación reutilizable

1. Confirmar el síntoma en Base Color. Si depende de la iluminación, revisar normales, tangentes, solapamientos o material antes de pintar. Si el negro está dentro de una superficie utilizada, es un fallo de pintura que también necesita corrección interior.
2. Rasterizar la ocupación UV de los triángulos y, cuando el pintado depende de la forma, su correspondencia con posiciones de superficie. Respetar material, isla y orientación del eje V. Proteger todas las otras islas ocupadas.
3. Corregir ambos lados de la costura sobre la malla. La dilatación no arregla colores distintos o patrones desalineados dentro de las islas.
4. Extender el color final desde el borde hacia los texels libres del margen, junto con la máscara/correspondencia que guía el retoque. No dilatar únicamente la máscara conservando píxeles negros como fuente. No difuminar negro hacia el interior. No cambiar alpha.
5. Escoger el margen según resolución, distancia de visualización, mipmaps y espacio disponible. Diez píxeles a 4K fue la solución observada, no una garantía universal; a menor resolución o con islas muy juntas medir el margen disponible. No invadir otra isla, mezclar prendas vecinas ni propagar de un extremo del atlas al opuesto por un `roll` circular sin límites. Cuando dos expansiones compitan, asignar el texel al borde válido más cercano sin sobreescribir superficies ocupadas.
6. Guardar sin recompresión destructiva innecesaria. Verificar sobre el modelo desde frente, ambos perfiles y tres cuartos, cerca y lejos, con el filtrado real del visor. Confirmar continuidad de patrones y sombras, no solo ausencia de negro en una captura frontal. Si el margen disponible no alcanza, registrar la limitación; no reempaquetar UV automáticamente bajo el contrato de atlas protegido.

Conservar máscara de cambios y comparación antes/después. El arreglo debe afectar la región retocada y su margen; el resto del mapa permanece intacto.

## Rostro fragmentado y ruido solo a distancia (INV-001)

Es otro fallo, distinto al margen de pintura anterior. Si las líneas de mejilla/frente desaparecen al acercar la cámara, los mipmaps pueden mezclar piel con islas oscuras próximas aunque los bordes inmediatos tengan buen color. FITA utiliza mipmaps y filtrado trilineal en sus copias de visualización. Revisa margen y separación con mipmaps en FITA y Blender; no cambies la exposición ni la paleta para ocultarlo.

FITA conserva las UV producidas por Tripo. La transferencia copia UV por esquina y materiales/texturas sobre la geometría aprobada, sin unwrap ni rehorneado facial adicional. Usar PINTAR_TEXTURAS.py y helpers-repintado.md para ocupación, reparación local y relleno de margen, manteniendo alpha, resolución y atlas. Los controles de calidad no exigen una sola isla facial ni cero solapamientos globales para continuar con regiones seguras.

Un solapamiento real impide pintar de forma independiente esos mismos texels: aislar la región, comprobar si la corrección sería compatible para todas sus superficies y registrar el caso si no lo es. No iniciar reparación UV, remallado ni regeneración para disimularlo. Los helpers de reconstrucción UV y la ruta repair-face-uv permanecen únicamente como herramientas históricas de mantenimiento por una petición separada; no forman parte del workflow actual ni deben ejecutarse al retocar.

## Verificación obligatoria antes de entregar

- Revisar todos los atlas Base Color editables, incluidos cabello y cuerpo, no solamente el rostro. Registrar parte, índice de imagen, margen efectivo en píxeles y si se amplió o ya era suficiente. No declarar suficiente un relleno por observar únicamente el porcentaje de ocupación Smart UV.
- Formar la máscara de ocupación con todos los triángulos UV que usan ese atlas y el canal UV correcto. Respetar transformaciones de textura y materiales; si no se pueden resolver, detener el relleno de ese mapa y registrar el pendiente. No confundir fondo negro con una isla negra válida.
- Propagar RGB del borde válido hacia texeles libres, sin pintar encima de ninguna otra isla. Usar vecino más cercano, sin desenfoque ni wrap alrededor del lienzo. Mantener alpha exactamente; un atlas compartido con mapas protegidos requiere tratamiento separado autorizado.
- Un margen de 16–32 px a 4K puede ser un punto de prueba, nunca una garantía. El filtrado a niveles mip muy bajos puede mezclar incluso islas bien separadas. Medir el espacio real y comprobar en el destino: acercamiento, personaje completo y distancia de uso. No reducir a 2K ni reunir atlas/materiales.
- Si no hay espacio suficiente, no ocultarlo desactivando mipmaps, aumentando exposición o recoloreando piel. Registrar el problema y usar el contrato de reparación UV/rehorneado validado antes de continuar. No cambiar UV durante un retoque protegido.
- En report.json completar uvReview según references/revision-conjunta.md; reviewed no sustituye esta evidencia.
