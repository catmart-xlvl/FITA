# Contrato de normales de cabello

Los helpers viven en el workspace local del proyecto. El ZIP inicial solo contiene instrucciones y rutas. `PREPARAR_NORMALES_CABELLO.mjs inspect` imprime los índices e identificadores exactos. `hair-normal-review.json` contiene:

```json
{
  "status": "prepared",
  "reason": "Describir el peinado medido, regiones y elección de volúmenes",
  "views": ["front", "left", "right", "back"],
  "lightDirections": ["left", "right", "front", "back"],
  "seamsChecked": true,
  "baseColorPreserved": true,
  "animation": {
    "status": "temporary-deformation-test",
    "evidence": ["ruta local a captura o informe de la prueba real"]
  },
  "patch": {
    "schema": "workbench-hair-normals/v1",
    "targets": []
  }
}
```

No completar las afirmaciones antes de comprobarlas. `tested-rig` se usa cuando se probó el rig existente. `no-hair` requiere `reason` y no lleva `patch`; no permite omitir un cabello pendiente.

Cada target identifica `mesh`, `primitive` y `positionHash` del inventario. Incluye `volumes`, con uno o más objetos:

- Elipsoide: `{"type":"ellipsoid","center":[x,y,z],"radii":[rx,ry,rz],"weights":[...]}`.
- Tubo: `{"type":"tube","points":[[x,y,z],...],"weights":[...]}`. Su eje es una polilínea: muestrear una curva suave con suficientes puntos antes de entregarla, evitando segmentos degenerados.

Los pesos son valores entre 0 y 1, uno por vértice en el orden del accesor POSITION. Si se omiten, ese volumen pesa 1 en toda la primitiva. Mezclar volúmenes con pesos suaves medidos sobre la malla; nunca asignar todos los tubos a todo el cabello sin segmentar sus influencias. El helper normaliza la suma; ningún vértice puede quedar sin influencia. Un volumen puede tener peso cero donde su normal sería indefinida.

Declarar todas las primitivas de una malla de cabello. Si una malla mezcla cabello con otras superficies, conservarla y resolver primero una clasificación compatible; no aplicar el campo a la cara ni declarar como cabello una malla mixta. No usar selecciones por color ni por nombres solamente.

Para componentes geométricos disjuntos dentro de una primitiva mixta, el target admite `protectedVertices:[...]`: índices únicos del accesor POSITION que pertenecen a accesorios revisados. El helper conserva exactamente sus NORMAL y TANGENT originales; sus pesos de volumen pueden ser cero. Rechaza triángulos que mezclen vértices protegidos y cabello, así como morph targets en este modo. Añade únicamente la máscara declarada `_WORKBENCH_HAIR_MASK`, reproducida por el importador. El visor divide índices en copias de visualización: cabello con su campo y accesorios con materiales normales; no divide ni reexporta la malla entregada. Guardar la correspondencia geométrica, revisar ambos grupos y verificar normales protegidas; no usar esta opción para omitir cabello pendiente.

Si la primitiva contiene morph targets, proporcionar `morphProfiles`, en el mismo orden, cada uno con sus `volumes` y pesos ajustados a la forma deformada. El helper calcula deltas NORMAL respecto de la nueva base. Los morph tangents no se admiten aún: informar la limitación, no eliminarlos ni ignorarlos. Accessors sparse y extensiones comprimidas requieren una preparación específica que preserve el contrato; el helper los rechaza.

El integrador conserva una copia `result/head-before-hair.glb`, añade el informe a `report.json` y guarda normales/tangentes nuevas en el GLB. La aplicación reproduce el cálculo y compara el resultado completo con las texturas pintadas y el parche facial declarados. No admite alteraciones adicionales. El marcador de nodo `workbenchHairNormals.version=1` activa automáticamente el tratamiento de luz del cabello; el atributo NORMAL sigue siendo estándar para la deformación y exportación.
