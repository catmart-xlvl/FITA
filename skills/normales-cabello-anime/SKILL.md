---
name: normales-cabello-anime
description: Preparar normales estilizadas de producción del cabello después de refinar los rasgos faciales. Ajustar volúmenes al peinado real, conservar UV y pintura y verificar respuesta a luz y deformación antes de entregar a FITA. No crea rigs ni SDF faciales.
---

# Normales del cabello para acabado anime

Ejecutar después de `refinamiento-rasgos-faciales-anime` y antes de normales-rostro-anime y la entrega conjunta. Es una etapa de producción, sin selector antes/después para el usuario. La pintura experimental de prendas no pertenece a esta etapa.

1. Leer las rutas exactas de `UBICACIONES.json` y `SKILLS_REQUERIDAS.txt`. Trabajar con `result/head.glb` del workspace, ya pintado y con los rasgos integrados. Conservar copia. Ejecutar `node PREPARAR_NORMALES_CABELLO.mjs inspect` para identificar mallas, primitivas, hashes y deformaciones. No modificar el almacén de activos directamente.
2. Inspeccionar frente, espalda y ambos perfiles en Blender aislado. Identificar casquete, flequillo, melena, coletas, trenzas y mechones desconectados que compartan volumen visual. No deducir sus regiones solo por el signo de X ni imponer dos coletas. Registrar en `hair-normal-review.json` por qué se eligió cada volumen.
3. Ajustar proxies al centro real de cada masa: elipsoide para casquete; tubos de ejes curvos muestreados para coletas o melena; varios volúmenes para peinados asimétricos. Las dimensiones y los ejes se miden en coordenadas locales de la malla, en pose de reposo. No reutilizar medidas de otro personaje. Asignar pesos suaves por región; excluir cara, accesorios y prendas. Cubrir todos los vértices de cada primitiva seleccionada. Las copias de una costura UV deben recibir el mismo campo y pesos, sin soldarlas.
4. Leer [contrato.md](references/contrato.md). Crear el parche de volúmenes y la revisión. El helper calcula y guarda `NORMAL` y reortogonaliza `TANGENT`; no usa normal maps. Conservar topología, posiciones, islas, píxeles, materiales, pesos, huesos y clips. Las normales de morph targets necesitan perfiles específicos de esas formas; nunca dejar deltas anteriores sobre una base nueva.
5. Comprobar la iluminación según el apartado siguiente. Probar deformaciones según el último apartado. No marcar revisado por el simple éxito del cálculo. Si un vértice cae en el eje/centro y el campo queda indefinido, ajustar el proxy o los pesos; no generar ceros ni NaN.
6. Después de `RETOCAR_TEXTURAS.mjs build` y de `INTEGRAR_ROSTRO.mjs`, ejecutar `node PREPARAR_NORMALES_CABELLO.mjs`. Reabrir el GLB resultante y verificarlo. Continuar con normales-rostro-anime antes de empaquetar y entregar con los helpers existentes: no se pide otro ZIP al usuario. No repetir build después de integrar el cabello. Si no existe cabello, registrar `no-hair` y una justificación verificable.

## Corrección de luz invertida entre regiones

- Primero comprobar que los ejes de los tubos atraviesan el interior real del volumen. Un eje situado delante de su superficie frontal produce normales hacia atrás. Corregir el eje, no invertir una coleta entera para disimularlo.
- Mantener posiciones, proxies y normales en el mismo espacio local. Al pasar a vista usar la transformación de normales del motor; nunca aplicar una matriz de posiciones a las normales. Revisar escalas no uniformes y reflejadas por separado.
- No invertir cada normal para que coincida con la normal geométrica de origen. En tarjetas finas con caras y costuras duplicadas eso rompe la continuidad del campo.
- En el shader de cabello de doble cara, usar el campo de volumen sin la inversión automática por `faceDirection`. Esta excepción es solo para el cabello preparado, no para todas las superficies del personaje.
- Usar la normal **después** de morphing, skinning y transformación a vista (`vNormal` en el visor). No enviar un atributo fijo multiplicado únicamente por `normalMatrix`: la luz quedaría ligada a la pose de reposo.
- Probar luz desde izquierda, derecha, delante y detrás, con cámara frontal y oblicua. Girar también la cabeza: cada zona debe responder a la misma dirección real de luz. No exigir que un peinado asimétrico tenga sombras idénticas en ambos lados. Base Color debe permanecer intacto.

## Preparación para animación

Guardar normales en pose de reposo. Dejar que el rig y los morph targets las deformen; no recalcular el campo con proxies estáticos en cada fotograma. Preservar índices de vértices, joints, weights, bind matrices y animaciones. Las raíces siguen la cabeza; largos y coletas podrán seguir cadenas secundarias al riguear.

Si ya existe rig, probar giro de cabeza y flexión de las regiones largas en una copia. Si todavía no existe, crear un rig temporal únicamente en una copia de comprobación: giro de cabeza y flexión de una región larga, con pesos que mezclen dos huesos. Revisar normales y costuras en reposo, pose intermedia y pose extrema; descartar el rig temporal antes de entregar. No confundir esta prueba con completar el rig del personaje.

Registrar capturas y poses en `animation.evidence`. Después del rigueo real se debe repetir la prueba con sus pesos finales. Al exportar a otro motor, comprobar que importa las normales personalizadas y reproduce la respuesta de doble cara; no declarar compatibilidad de un shader de destino sin esa comprobación.
