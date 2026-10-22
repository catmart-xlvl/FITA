# Pintura sobre volumen y cobertura

## Sombras, luces pintadas y patrones

- Mantener la paleta, los valores y los degradados útiles del concepto. Afinar el límite entre sombra y color base con zonas suaves y acentos finos donde el diseño los tenga. No convertir todas las sombras en líneas negras ni aumentar contraste/saturación para aparentar un acabado mejor.
- La selección debe seguir la superficie 3D, no solo los píxeles visibles en una cámara. Pintar los lados y la profundidad del mismo pliegue usando máscaras de superficie o un pincel que siga la malla. Respetar superficies próximas pero desconectadas; no pintar otra prenda por cercanía espacial.
- En Example, la sombra existente en el centro del escote debe continuar hacia el interior de ese pliegue. Tomar un rojo piel más oscuro de las sombras del cuello/clavículas como referencia, sin negro duro ni nuevas sombras en el resto del pecho. Revisar ambos tres cuartos y perfiles, sin cambiar escote ni anatomía. Una máscara limitada por profundidad frontal puede dejar el interior sin pintar aunque el frente parezca correcto.
- Mantener los reflejos pintados que definen mechones y pliegues, ajustando forma y transiciones según el concepto. No confundirlos con reflejos del material ni hornear una iluminación direccional adicional. Si la entrada pide albedo sin iluminación, conservar esa condición.
- En telas, comprobar número, anchura, dirección, separación y continuidad de rayas, costuras y motivos alrededor del volumen. Seguir el trazado entre islas UV y frente/laterales/espalda; conservar asimetrías del diseño. Se puede repintar una región defectuosa sobre el atlas existente, sin regenerar toda la textura ni rehacer UV por defecto.

## Labios y registro con la geometría

Localizar abertura de boca, comisuras y superficies reales de labio superior/inferior. Comparar la pintura con esos límites usando Base Color y una vista que permita leer la geometría. Si el color o brillo del labio inferior está proyectado sobre el superior, corregir la pintura y su registro, no mover la boca para acomodar el error. Limpiar el trazo anterior y reconstruir localmente color, borde y sombreado sobre el labio correcto, preservando forma e identidad. Verificar frente, ambos tres cuartos y perfiles: sin segunda boca pintada, trazo flotante en piel ni brillo cruzando la abertura. No crear dientes, cavidad ni geometría oral en este paso.


### Comprobación obligatoria del registro labial

Antes de pintar, identificar sobre la geometría vigente el centro de la abertura y ambas comisuras. Guardar esos landmarks del caso, sin usar una altura fija, una línea frontal aproximada ni coordenadas de otro personaje. Comparar el mismo encuadre en Base Color y geometría neutra/wireframe: el trazo debe coincidir con la abertura, y el color/brillo inferior permanecer en el labio inferior. Retirar por completo la boca falsa pintada encima. Revisar también el fondo y los laterales visibles del interior existente, sin crear geometría oral.

Comprobar la correspondencia UV antes de pintar y conservar las UV de Tripo. Si dos superficies diferentes comparten texels, proteger esa región y documentar la limitación concreta; continuar solo con zonas seguras. No rehacer UV ni rehornear el rostro como requisito. No esconder un solapamiento pintando otra línea.

Revisar frente, ambos tres cuartos y ambos perfiles de cerca y en el personaje completo. Volver a abrir el archivo y comprobar el GLB que recibirá FITA. Una revisión global de cabeza, un conteo de caras o escribir «labios corregidos» no reemplaza esta comparación. No entregar con trazo flotante, doble boca, brillo cruzado o manchas laterales.

Los nuevos paquetes FITA exigen `report.lipReview`: `status:checked`, `reason`, `landmarks` (centro y comisuras en coordenadas del modelo), `views:[front,threequarter-left,threequarter-right,profile-left,profile-right]`, `modes:[base-color,geometry]`, `creaseAligned:true`, `oldTraceRemoved:true`, `lowerLipRegistered:true`, `uvOverlapChecked:true`. Usar `not-applicable` solo si el personaje realmente no tiene boca, con motivo concreto. El importador exige este registro; su presencia no sustituye la inspección visual del agente.

## Prendas originales y cobertura temporal

Usar el concepto, las referencias y `coverage.json` conjuntamente. Una prenda visible del diseño nunca se marca como temporal. No asumir desnudez bajo ropa que oculta la anatomía.

La limpieza superior incluye los restos visibles en profundidad bajo el borde del escote. Revisar de frente y con **picado frontal suave** para descubrir franjas que quedan ocultas en la cámara horizontal; también ambos tres cuartos. Comparar con el concepto original y clonar solo piel adyacente sobre cobertura añadida documentada que invada la piel expuesta prevista. Conservar borde de la prenda exterior, tirantes y cualquier prenda original. No ampliar el escote ni modificar anatomía. Registrar esta vista y comprobar el resultado sin iluminación; una limpieza frontal plana no da por terminada la revisión de cobertura.

En FITA, cuando el manifiesto registra cobertura temporal en `chest`, el informe de acabado debe incluir `front-high` en `parts.body.views`, tanto si se limpia como si se conserva con justificación. El importador exige esa vista. Si se usa `review_placement.py` para una corrección posterior, `settings.coverageReview={center:[x,y,z],span:...,tilt:...}` genera el acercamiento `coverage_front_high.png`; elegir centro y encuadre del escote actual y un picado moderado, no una vista cenital. Las imágenes y sus parámetros son evidencia del caso y no se reutilizan como medidas para otro personaje.

| Caso | Decisión |
| --- | --- |
| Sostén, bikini u otra prenda visible en el concepto | Conservar forma, color y cobertura originales. |
| Cobertura superior añadida y documentada, que invade piel expuesta por el escote del concepto | Limpiar solo esa pintura añadida, clonando piel adyacente y sus gradientes. Mantener la prenda exterior, sin pezones, areolas ni detalle íntimo. No descubrir más de lo mostrado por el diseño. |
| Cobertura provisional inferior añadida sobre piel que el concepto deja expuesta | Retirarla obligatoriamente por pintura donde la malla sea piel, incluidos caderas, muslos y laterales. Mantener la prenda original y su cobertura íntima. |
| Falda que oculta la ropa interior | Conservar por defecto la cobertura existente. Si sobresale indebidamente y el personaje es inequívocamente adulto, se puede ajustar a una tanga opaca discreta manteniendo cobertura íntima delantera e inferior. No hacerlo por defecto si no hay un problema visible. |
| Ropa interior inferior que sí es parte visible del concepto | Conservarla, sin sustituirla por tanga. |
| Edad ambigua, personaje infantil, cobertura de origen incierto o evidencia insuficiente | Conservar cobertura y señalar el pendiente; no reducirla. |

Una referencia inicial puede incluir cobertura temporal opaca cuando haga falta. En el acabado, la reducción localizada de cobertura inferior no autoriza desnudar ni detallar genitales. Revisar de frente, atrás, ambos lados y ángulos bajos para asegurar continuidad opaca. Aplicar obligatoriamente [la revisión de cobertura temporal](cobertura-temporal.md), con decisiones por región y evidencia antes/después. No declarar neutralizada la ropa original ni omitir la piel expuesta por una etiqueta amplia pelvis. Esto es revisión artística local, no un mecanismo para evadir los filtros de un servicio.

## Acabado limpio y reparación local

En FITA las referencias de textura para todos los grupos usan bases más planas, sombras amplias definidas y highlights pintados selectivos; conservar la paleta, motivos y detalles útiles. Reducir microvariación cromática, suciedad y proyecciones de otra pieza solo donde se detecten. No posterizar, aumentar contraste ni difuminar globalmente los atlas existentes.

No pintar cada triángulo de un color. Delimitar el error sobre la superficie correcta, tomar color y gradiente del mismo material contiguo, extender la corrección a través de las costuras UV cuando corresponda y fundir su borde con una máscara suave. Conservar sombras intencionales y el orden de oclusión; eliminar líneas falsas proyectadas en correas o cinturones que pasan por encima de otra pieza. Un borde de sombra anime puede ser definido mientras la unión de la reparación sigue siendo imperceptible. Revisar antes/después con idénticas vistas y Base Color, también desde los laterales y pliegues interiores.

## Profundidad pintada según superficie

En Base Color la profundidad debe leerse en la propia pintura. Un mismo material mantiene su paleta, pero no un único valor en todas sus caras: frente, cantos, retornos superiores/inferiores e interiores pueden tener sombras o luces distintas. Determinarlo por orientación real, oclusión y referencia, no por qué cara mira a la cámara ni por una regla fija de oscurecer siempre lo superior. Mantener esa decisión al girar el modelo.

Priorizar contaminación de proyección: cuero de cinturón sobre pantalón o piel, metal de hebilla duplicado sobre cuero, tela sobre piel, sombras falsas cruzando una pieza superpuesta. Restaurar el material receptor con muestras limpias de orientación comparable; conservar el objeto real y las sombras de contacto justificadas. Los límites se revisan por ambos lados y en el interior del pliegue.

Repintar sombras sucias como formas finas, legibles y continuas, por ejemplo una clavícula definida en vez de una mancha difusa. Conservar sombras correctas. La máscara de reparación se funde con el entorno; la forma de la sombra puede tener un borde definido. No convertir esa distinción en parches por triángulos, negro en cada concavidad o un filtro global de contraste. Aplicar [helpers de repintado](helpers-repintado.md) y verificar las regiones reales desde varios ángulos.
