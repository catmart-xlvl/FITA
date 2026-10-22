# Sombra ocular superior (Eye Shadow)

Parte del refinamiento facial, después de preparar esclerótica, iris, pupila y brillos, antes de las normales. Es una lámina que oscurece la franja superior del ojo; no es maquillaje sobre la piel, pestaña ni sombra facial SDF.

## Guía de construcción

La referencia manual de ReferenceAvatar, analizada el 19-10-2026, contiene un objeto con **dos componentes desconectados**, uno por ojo: **16 vértices, 7 quads y 14 triángulos por componente**, con dos hileras de ocho vértices. Son tiras curvas de una sola cara, sin grosor ni modificadores. Cada hilera une los extremos interior y exterior del ojo con seis estaciones intermedias. El borde superior queda oculto bajo el párpado/pestañas; el inferior define el límite suave y continuo de la sombra sobre el ojo. Consultar `eye-shadow-reference.json` junto a esta guía para el esquema medido.

Usar esa sencillez como punto de partida; **no copiar sus coordenadas, transformación, proporciones o asimetrías**. Adaptar ambos bordes al ojo del personaje vigente y su curvatura en profundidad. Los siete quads son una guía de densidad, no un cupo fijo ni prueba de calidad. Añadir solo los segmentos que una curva realmente necesite; límite técnico del helper: 128 triángulos por pieza. No aplicar Solidify, subdivisiones densas ni cerrar la lámina como un sólido. No suavizar la sombra moviendo la cara del personaje.

Apoyar la superficie justo delante de iris/esclerótica, conservando el reposo bajo el párpado. Medir la separación sobre las superficies reales a escala final: no reutilizar una distancia absoluta de ReferenceAvatar. Si el iris tiene más relieve, adaptar también el centro de la franja; no puentear el ojo con un plano que flote o se entierre. Se admiten parches desconectados cuando las capas oculares lo exijan. Cerrar los recorridos en los extremos de forma suave, sin dientes ni esquinas accidentales.

## Material y UV

Negro `#000000`, opacidad inicial **0,25** elegida como punto de partida editable; ajustarla al diseño después de revisar, sin convertirla en una mancha opaca. Material sin iluminación (`KHR_materials_unlit`), `alphaMode:BLEND`, cero metal y rugosidad uno. UV propias únicamente de esta lámina; no rehacer el atlas facial. En el helper, `white:true` reutiliza el PNG blanco opaco de `whiteTexture` y el factor negro con alpha produce el sombreado. Es opcional graduar la opacidad hacia abajo en una revisión futura del contrato; el helper actual usa opacidad uniforme. No modificarlo declarando una textura libre que el contrato no admite.

La vista previa de FITA respeta el alpha en Original, Base Color y MToon, dibuja cada lámina una sola vez y no escribe profundidad. Los brillos blancos deben seguir visibles; comprobar su profundidad y el orden real, no resolverlo con una sobreexposición global. Evitar sombras duplicadas superpuestas.

## Integración y verificación

- Crear `WB_EyeShadow_L` y `WB_EyeShadow_R`, role `eyeshadow`, eye `L`/`R`, posiciones/normales/UV/índices triangulados y `opacity:0.25` en el parche facial. Usar el espacio local glTF del parche; convertir explícitamente la transformación del objeto de trabajo. Las mallas y materiales originales permanecen protegidos.
- Si las sombras ya son válidas, conservarlas y comprobarlas. Si el rostro ya está preparado y solo faltan sombras, el helper admite un parche aditivo: `removals:[]`, exactamente ambas sombras y `regions:[{min:[...],max:[...]}]` ajustadas a los ojos dentro del dominio de `face`/`head-face`; exige iris y pupila existentes `WB_Iris_L/R`, `WB_Pupil_L/R`. No reconstruir esos rasgos para poder integrar sombras.
- Con el pelo oculto, revisar frente, ambos tres cuartos y perfiles, cerca y a distancia, en Original/Base Color/MToon. Bordes continuos, sin flotar, intersecciones visibles, bandas dobles, parpadeo ni brillos borrados. Restaurar pelo y revisar el conjunto. Conservar capturas y reabrir el GLB.
- En paquetes nuevos, `eyeShadowReview` requiere `status:checked`, `reason`, las cinco `views`, los tres `modes` y `eyes:[{eye:L/R,surfaceFitted:true,noFloating:true,noClipping:true,glintsVisible:true,smoothContour:true}]`. Solo declarar lo comprobado. `not-applicable` exige un motivo de diseño concreto, no falta de tiempo. El servidor comprueba piezas/materiales; la revisión anatómica sigue a cargo del artista.

El objeto manual de ReferenceAvatar permanece intacto como fuente del artista. Es una guía de construcción; ni los conteos ni sus capturas certifican encaje perfecto para otros personajes. La coordinación de deformación con párpados, mirada y cara se comprueba en el rig posterior, sin crear controles ahora. Conservar la malla y el alpha durante transferencia de pesos; en expresiones declarar role `eyeshadow`, bindings explícitos de blink y normales de cada morph. La exportación a VRChat conserva esos bindings/materiales y los revisa en destino. Una sombra bilateral manual puede seguir como un solo objeto con `eye:both`; no separarla por rutina.
