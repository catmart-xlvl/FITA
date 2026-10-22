# Separación fija entre pupila e iris

Aplicar a todos los proyectos al crear las piezas del ojo. **Objetivo fijo: 0,17 mm (0,00017 m) de holgura mínima entre la pupila y la superficie triangulada real del iris**, medida hacia fuera del ojo. Es un estándar de producción aprobado por el usuario a partir de este personaje, donde se midieron 0,17110 mm y 0,17123 mm. No es una garantía universal contra cualquier problema del visor.

## Aplicación directa

1. Convertir 0,00017 m a las unidades y escala física final del personaje, incluyendo transformaciones de objetos. En Blender, con unidades métricas, dividir por `scene.unit_settings.scale_length` para obtener unidades de escena; si aún habrá una escala final uniforme, compensarla también. No asumir que una unidad del archivo equivale a un metro.
2. Conservar forma, tamaño, centro, curvatura, UV y materiales de la pupila. Obtener la dirección exterior del iris actual, independiente de la cámara. Medir una vez la holgura mínima `g` sobre la superficie cubierta, incluidos vértices, bordes y centros de caras.
3. Aplicar **una sola traslación rígida** en esa dirección: `desplazamiento = max(0, objetivo - g)`. La medida fija es la separación final; no sumar 0,17 mm a una separación ya existente. No buscar porcentajes del diámetro, probar varias distancias ni reconstruir piezas válidas. Si ya cumple, no moverla. Conservar una separación previamente aprobada; una segunda ejecución no acumula movimientos.
4. Mantener el orden exterior **iris → pupila → brillos**. Adelantar únicamente los brillos que quedarían detrás de la pupila o coincidentes con ella; deben verse por encima de ambas capas sin flotar. No hornearlos en el iris.
5. Hacer una comprobación local del ojo: cerca/lejos y vista oblicua o de perfil, en Base Color y MToon cuando exista. Comprobar la holgura después de la traslación y registrar objetivo, unidades, dirección, holgura antes/después y desplazamiento por ojo en `pupilDepthReview`. Un retoque limitado a esta separación no exige reconstruir ni repintar el personaje, ni repetir revisiones generales ya aprobadas; conservar las comprobaciones de entrega que exija el importador.

Si se detecta una intersección real, corregir solo la pieza afectada manteniendo el objetivo fijo. Si hay parpadeo con la holgura correcta, revisar los planos cercano/lejano y la precisión de profundidad del visor; no aumentar repetidamente la separación para compensarlo.

Conservar párpados, pestañas, rostro y colocación. No crear rig para esta comprobación. Esta revisión estática no sustituye la validación posterior de deformaciones. El color oscuro uniforme de la pupila fue una edición de aquel proyecto, no una nueva regla general.
