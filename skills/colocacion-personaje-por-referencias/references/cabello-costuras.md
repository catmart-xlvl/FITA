# Costuras UV y mechones separados

Antes de apartar cabello que atraviesa una prenda, distinguir estos casos:

- **Borde geométrico duplicado por UV/normales:** sus vértices son distintos, pero ambos extremos del borde coinciden. Revisar `uv_seam_pairs(points, edges, indices)` del helper incluido y pasar los pares confirmados como `seam_pairs`. Son enlaces virtuales para el cálculo de influencia; no soldar, eliminar vértices ni cambiar caras, UV o materiales. Un único punto coincidente no justifica conectar superficies.
- **Mechón realmente desconectado dentro de la misma malla:** no alcanza la influencia de otro componente. Si también penetra, incluir su región y semillas propias, con movimiento revisado. No añadir un puente virtual por cercanía. Puede necesitar otra operación si su dirección o radio difieren.
- **Mechón en otro objeto:** ejecutar una corrección en ese objeto, conservando identidad y coordenadas. No combinar objetos ni renombrar piel como cabello para pasar el importador.

Para el ZIP de colocación manual aprobada, usar primero `manual_hair_clearance.rotate_hair` antes de aplicar estatura global. Pasar `indices`, `seeds`, `radius`, `pivot`, `axis`, `angle` en radianes, `protected_indices` y los `seam_pairs` revisados. Pivote/eje/radio se expresan en espacio mundial anterior a la escala final. Proteger explícitamente todas las piezas centrales y el flequillo. Una coleta separada puede rotar rígidamente alrededor de su sujeción; la transición conectada solo se usa si la unión lo necesita. Revisar raíz, perfil y espalda tras cada incremento pequeño. El helper rechaza rotaciones mayores de cinco grados por paso, apertura de costuras e incrementos de estiramiento/compresión mayores del diez por ciento. No ampliar tolerancias para aceptar una deformación visible. La importación comprueba también la deformación acumulada.

`clear_hair` y `hair_connected.deform_connected_hair` permanecen para operaciones antiguas y pequeños ajustes locales justificados. Un radio conectado no identifica por sí mismo qué es coleta: una selección amplia puede incluir el pelo central aunque la operación sea reproducible. Restaurar la malla fuente si el resultado quedó doblado; no corregir una curva deformada acumulando más movimientos.

Revisar la selección completa: raíces, flequillo, rostro y mechones que no penetran quedan protegidos. Ampliar la región hasta que el desplazamiento termine en cero; no recortar una influencia activa. Los pares duplicados deben moverse de forma coherente, incluso cuando una copia está al otro lado de una costura UV. Si el helper avisa que el movimiento abriría una costura, corregir selección/enlaces; no omitir la validación ni soldar la malla como atajo.

El helper guarda semillas, región, radio y `seamPairs` en `workbench_hair_clearance`; las rotaciones añaden `method:rotation`, pivote, eje, ángulo y `protectedIndices`. El importador verifica los enlaces contra la geometría aprobada y reproduce cada operación; rechaza enlaces lejanos, apertura de bordes, estiramiento excesivo y cambios ajenos a la región permitida. Conservar ese registro. No copiar metadatos de otra malla ni de otro personaje.

Verificar frente, ambos perfiles, tres cuartos y espalda, incluyendo acercamientos con texturas y alambre superpuesto: sin grietas, bordes duros ni cabello arrastrado junto al rostro. Comprobar UV/texturas y guardar/reabrir. La validación numérica no certifica por sí sola que haya desaparecido toda penetración.

El resultado comunicado de 623 vértices y aproximadamente 3,7 cm es una medida de aquella prueba, no una receta. Radio/desplazamiento se expresan en unidades mundiales antes de la escala final; informar separadamente la medida final si se aplica estatura.
