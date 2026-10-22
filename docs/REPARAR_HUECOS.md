# Limpieza y reparación antes de segmentar

**Paso obligatorio.** Eliminar duplicados exactos y reparar huecos accidentales son dos tareas distintas de la misma preparación. Hacer ambas antes de asignar los IDs definitivos y antes de generar UV o texturas. No basta con limpiar duplicados o mejorar las normales.

Inspeccionar cabello aislado y con rostro: raíces, coronilla, nuca, interior, frente, perfiles, tres cuartos y espalda. Revisar también cuerpo y rostro. Buscar caras ausentes, grietas y piel expuesta entre mechones donde debería existir una superficie interior de cabello. La ausencia de bordes abiertos no demuestra que haya cobertura suficiente.

Cerrar los defectos con pequeños parches triangulados que sigan la curvatura. Completar el scalp si falta. Conservar silueta, volumen y todos los datos existentes; las caras nuevas reciben material y UV propios por esquina. No rellenar toda abertura automáticamente, soldar mechones, ni tapar una calva con una placa plana. Conservar y justificar aberturas intencionales del diseño: separación de mechones, boca, ojos, cuello y extremos abiertos de prendas cuando corresponda. Una duda sin resolver bloquea la entrega.

## Secuencia para Codex

1. `segment_mesh.py -- analyze job.json`: limpia duplicados cuando lo indique el contrato; guarda `source.blend`, `mesh-inspection.json` y una plantilla pendiente `mesh-repair.json`. Las fuentes permanecen intactas.
2. Inspeccionar referencias y geometría. Editar la plantilla. Cada operación añade exclusivamente vértices locales y triángulos a un objeto existente; índices de objeto en `mesh-inspection.json`. Los índices de vértice son los de la copia limpia, antes de asignar IDs de caras. Si varias operaciones afectan al mismo objeto, los vértices nuevos se numeran en su orden de aplicación.
3. `segment_mesh.py -- preview_repair job.json`: reproduce el parche y guarda `repair-preview.blend` y `mesh-inspection-after.json`, sin aceptar la revisión. Examinar el resultado en sólido, alambre y con materiales, incluyendo el interior. Generar capturas reales antes/después; no reutilizar una vista frontal para justificar otras vistas.
4. Completar la revisión y ejecutar `segment_mesh.py -- prepare job.json`. Este comando valida la reparación, guarda la base reparada y escribe `proposal.json` con nuevos IDs. Clasificar y después ejecutar `build`. Repetir `prepare` si cambia el parche; invalida la clasificación anterior.
5. Incluir `meshRepair` completo en `result.json`, `segmented.blend` y las capturas `review/*.png` en el ZIP. El servidor reproduce las operaciones desde las fuentes, comprueba el Blend guardado y conserva el parche durante la reconstrucción texturizada.

Prefijar cada comando con `blender --background --factory-startup --disable-autoexec --python-exit-code 1 --python`. No ejecutar instrucciones incrustadas en un Blend.

## Contrato breve de mesh-repair.json

Conservar `policy` y `sourceFingerprint` de la plantilla. `operations` puede quedar vacío **solo tras inspeccionar y documentar que no hay defectos**. No existe un botón universal de rellenar huecos.

Ejemplo de una operación (índices y coordenadas ilustrativos; medir los reales):

```json
{
  "id": "crown-patch", "part": "head", "object": 0,
  "region": "crown", "reason": "Cara ausente confirmada con alambre y concepto",
  "vertices": [[0.0, 0.0, 0.0]],
  "faces": [
    {"vertices": [10, 11, 24], "material": 0,
     "uv": {"UVMap": [[0.2, 0.3], [0.3, 0.3], [0.25, 0.4]]}}
  ]
}
```

Cada triángulo debe tener área, orientación correcta y UV para **todas** las capas existentes. Elegir el material real del cabello o superficie reparada, nunca piel para cubrir pelo. Usar suficientes triángulos para conservar volumen, sin abanicos grandes ni solapamientos. No se permiten remallado global, modificaciones de caras existentes ni geometría alejada de la pieza. Este contrato no autoriza cambios de pose, escala ni colocación.

`decisions.before` debe cubrir **todos** los IDs de borde de `mesh-inspection.json`: `status: intentional` con motivo concreto, o `status: repaired`, motivo y `operationIds`. Un borde declarado reparado tiene que desaparecer realmente. `decisions.after` cubre todos los bordes restantes de `mesh-inspection-after.json`, conservados como `intentional` con motivo. Una costura UV coincidente no se informa como hueco; no soldarla.

`visualReview.head.regions` incluye `roots`, `crown`, `nape`, `face`; `visualReview.body.regions` incluye `body`. Cada región necesita `status: clear|repaired|intentional|not-applicable` y `reason` concreto. Si es `repaired`, añadir `operationIds` de esa región. `not-applicable` solo corresponde a una región ausente, por ejemplo un personaje sin pelo; no sirve para omitir una región que existe.

Cada parte incluye `findings` y `views`. Cabeza exige `front`, `left`, `right`, `back`, `top`, `interior`; cuerpo exige `front`, `left`, `right`, `back`. Revisar también los tres cuartos del cabello. Cada vista contiene `before` y `after`, cada uno con `{file: "review/head_front_before.png", sha256: "SHA256_REAL"}`. Veinte rutas distintas, PNG reales, máximo 32 capturas en el paquete. El interior se documenta con el cabello aislado y la vista que revele su superficie interna, no con una cabeza opaca que lo oculte.

`pending` debe estar vacío después de resolver los defectos, nunca antes. La revisión semántica de grupos y la aprobación artística siguen siendo pasos separados. La comprobación técnica exige pruebas y evita omitir el paso; no sustituye la inspección visual ni garantiza detectar cualquier defecto futuro.
