# Preparación de sombreado

Orden obligatorio: pintura de texturas → rasgos faciales → normales del cabello → normales del rostro → comprobación y entrega conjunta.

## Normales de producción

Aplicar `skills/normales-cabello-anime/SKILL.md`, localizada mediante SKILLS_REQUERIDAS.txt. Codex inspecciona el peinado y ajusta volúmenes y pesos específicos; no se presupone una esfera ni dos coletas. El helper PREPARAR_NORMALES_CABELLO.mjs se ejecuta después del integrador facial y guarda NORMAL y TANGENT en el modelo. Su contrato protege posiciones, índices, UV, pintura, materiales, esqueleto y pesos. El importador reproduce y valida el cálculo. El informe exige revisión de luz, costuras y deformación; no se presenta el resultado mientras esté pendiente.

El visor reconoce workbenchHairNormals.version=1 y activa la respuesta del campo automáticamente. No ofrece aplicar normales, intensidad ni comparación antes/después. Los activos históricos con un perfil aprobado se reconocen por hash exacto de geometría y reciben su campo al cargar; esa compatibilidad no sustituye el nuevo paso de exportación para nuevos acabados. No reutilizar perfiles históricos para otra geometría.

## Prevención de luz invertida o fija

Las instrucciones completas y verificaciones están en la habilidad. Ajustar los ejes dentro de la masa real de cabello; usar un único espacio local; evitar inversiones por vértice contra la normal geométrica y evitar la inversión por faceDirection del campo de volumen en tarjetas de doble cara. Leer vNormal después de morphing, skinning y normalMatrix, no un atributo estático sin deformar. Probar cuatro direcciones de luz, giro de cabeza y flexión de regiones largas. Conservar normales personalizadas al exportar; revisar nuevamente con el rig final y el shader de destino.

## SDF facial: pendiente

Reservado dentro de la preparación de sombreado. No se genera ni activa todavía; mantener el albedo aprobado. La integración y compatibilidad con el destino se validarán por separado.

## Normales simplificadas del rostro: etapa de producción

Aplicar `skills/normales-rostro-anime/SKILL.md`. En los paquetes nuevos versión 8 es obligatorio revisar y transferir las normales de la piel frontal y de todos los componentes faciales externos desde una misma máscara curva simple adaptada a frente, mejillas, mentón y mandíbula. Importar `face-normal-mask/face-normal-mask.glb` o `.blend`, la mitad de esfera suave ya preparada, y ajustar solo posición, escala y rotación con `AJUSTAR_MASCARA_ROSTRO.py`; no crear otro proxy desde cero. El recurso canónico está en `resources/face-normals/`. La máscara no es parte del personaje; no copiar medidas de otro rostro. Mezclar suavemente en el contorno y extender el mismo campo a las piezas faciales externas (párpados, pestañas, cejas, esclerótica, iris, pupilas y brillos), conservando su geometría y su pintura. Comprobar cobertura completa del mentón y mezcla suave en la mandíbula; proteger interior de boca, orejas, nuca, cabello y accesorios. No exportar la máscara, modificar posiciones/UV/pintura ni crear un rig. No confundir este campo de normales con un SDF facial.

Guardar `face-normal-review.json` con `status:prepared`, `reason`, `patch` de esquema `workbench-face-normals/v1`, vistas front/left/right/back, luz left/right/front/back, `baseColorPreserved:true`, `protectedFeaturesPreserved:true`, `proxyExported:false` y `seamsChecked:true`, solo después de revisar el resultado. Se admiten targets separados por pieza facial y primitiva. Si sus transformaciones difieren, convertir la misma máscara al espacio local de cada pieza; no reutilizar sin transformar los números locales de otro objeto. Cada target identifica mesh/primitive, positionHash, proxy `{type:ellipsoid,center,radii,rotation}` (quaternion xyzw unitario opcional) y pesos continuos por vértice; cero conserva la normal original. Los duplicados UV reciben el mismo campo. La primera versión protege morphs rechazándolos hasta disponer de perfiles específicos.

Preparar y comprobar un candidato. Ejecutar `PREPARAR_NORMALES_ROSTRO.mjs` después de pintura, rasgos y normales del cabello; el importador reproduce los tres parches y rechaza cambios adicionales. Conservar el informe en la entrega conjunta. Los paquetes nuevos incluyen faceNormals.required y bloquean la omisión; los paquetes versión 7 ya emitidos mantienen su manifiesto y pueden incorporar el parche verificado sin alterar sus fuentes ni autorización. not-applicable requiere ausencia comprobable de superficie facial. La máscara se conserva únicamente en la copia de trabajo; el GLB final contiene solo sus normales/tangentes.


## Pruebas independientes

La pintura provisional de prendas permanece en `.runtime/garment-paint-trial/INSTRUCCIONES_PROVISIONALES.md`, con Antes/Después limitado al activo original verificado. No es obligatoria ni se propaga a otros personajes. El brillo artístico del cabello ya es una opción oficial de previsualización MToon, con intensidad inicial moderada de 0.15 y control del usuario. No modifica mapas, exportaciones ni Base Color; no confundirlo con las normales de producción guardadas en el GLB.
