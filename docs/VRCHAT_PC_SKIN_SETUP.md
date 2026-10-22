# Piel Poiyomi y controles predeterminados de FITA

Revisión: `2026-10-20-skin-v1`. Contrato obligatorio de preparación para **VRChat PC de todos los personajes de FITA**. Implementarlo en su proyecto Unity; el JSON y esta guía no ejecutan un importador. Leer también el perfil de referencia y la guía general. No cambiar una textura aprobada para simular un ajuste de iluminación.

## Apariencia adaptable

Conservar albedo, UV, labios, maquillaje y tono de piel del diseño aprobado. El resultado de ReferenceAvatar sirve como referencia de respuesta de iluminación, no como orden de volver blanca la piel de todos los personajes. Ajustar rostro completo, mentón, orejas, cuello y manos de forma coherente; incluir ambas caras cuando el sistema de parpadeo usa renderers alternativos.

Usar Poiyomi Toon gratuito compatible con el proyecto. Partir de la base de materiales del perfil y adaptar luminosidad mínima, límite máximo, influencia cromática de la luz, respuesta aditiva y especular a la piel concreta. Comparar la misma cámara en iluminación neutra, tenue, intensa coloreada y contraluz. Buscar estabilidad de identidad y detalle, evitando tanto oscurecimiento extremo como blancos quemados. No prometer independencia absoluta de la iluminación del mundo.

Ejemplo aprobado de ReferenceAvatar, **no valores obligatorios**: mínimo de luz `0.81`, cap `0.9`, límite aditivo `0.09`, influencia monocromática base/aditiva `1`, passthrough aditivo `0`. Fue ajustado para su piel muy clara. No copiar estos números a otra paleta sin revisión. Rim, SSS, reflejos y glitter de capturas externas son ensayos opcionales; no activarlos universalmente ni confundirlos con el especular. Mantener cabello dieléctrico y la respuesta propia de ropa y accesorios.

## Dos controles siempre presentes

| ID estable | Etiqueta en inglés / español | Tipo y valor inicial | Efecto |
|---|---|---|---|
| `FITA_SkinBrightness` | Skin Brightness / Brillo de piel | Float, Radial Puppet 0–1, `0.5` | Intensidad de iluminación de la piel |
| `FITA_SkinSpecular` | Skin Reflection / Reflejo de piel | Float, Radial Puppet 0–1, `0.5` | Intensidad del brillo especular de la piel |

Ambos parámetros deben tener `saved=true`, `networkSynced=true` y default `0.5` tanto en Animator como en Expression Parameters. El centro conserva el aspecto aprobado. Crear curvas independientes suaves, normalmente mediante Blend Trees 1D y muestras 0 / 0.5 / 1. Los extremos se adaptan al personaje: para brillo una referencia inicial es 55% / 100% / 120% del ajuste aprobado; para especular 0 / 100% / 200%. Comprobar que el extremo alto no queme la piel. No animar tinte, albedo, metálico, rugosidad ni la intensidad de reflexión del entorno al mover el control especular. Poiyomi usa `_MochieSpecularStrength` para esta intensidad; verificar el nombre en la versión instalada. Mantener activo el módulo especular de la piel y `_LightingCapEnabled=1` cuando se anime el cap; comprobar el efecto real de ambos controles, no solamente que sus curvas existan.

Usar el idioma explícito del personaje o la resolución de idioma del workflow facial (inglés por defecto); traducir solamente etiquetas. Mantener IDs, rutas y parámetros. Reservar 16 bits de Expression Parameters para estos dos Floats; calcular el presupuesto total según el SDK instalado. Conservar todos los controles previos. Si el menú raíz alcanzaría 8 entradas, colocar ambos en un submenú Skin / Piel. No sustituir capas FX, máscaras ni parámetros ajenos. Reutilizar los controles existentes de forma idempotente y resolver colisiones incompatibles sin borrarlos silenciosamente.

## Aislar la piel y conservar el bloqueo de Poiyomi

Inventariar materiales y renderers por semántica. No identificar piel por brillo de píxel ni aplicar ajustes globales a un atlas que también contiene ropa. Cuando comparten material, crear una copia de material para los polígonos de piel, manteniendo posiciones, UV, textura y pesos. Cubrir todas las instancias activas y alternativas de parpadeo. No dar por hecho que animar `material._Propiedad` distingue slots de un mismo renderer.

En Poiyomi/Thry usar propiedades **RA / Renamed Animated** con un sufijo exclusivo de este personaje y del grupo de piel. Para brillo animar `_LightingMinLightBrightness` y `_LightingCap`; para especular `_MochieSpecularStrength`. Conservar un sufijo válido existente; no copiar literalmente el sufijo de ReferenceAvatar ni duplicar propiedades RA. Desbloquear los materiales antes de cambiar tags, marcar las propiedades RA, bloquearlos y consultar el nombre renombrado real **antes** de crear curvas FX. Verificar que esas propiedades existen en el shader bloqueado. El bloqueo durante el build debe conservarlas. No usar rutas de animación de índice de material sin soporte.

Comprobar ambos controles en Play Mode con el SDK: 0 / 0.5 / 1, juntos y por separado, cara, cuello y ambas manos. Revisar ambas variantes de parpadeo, ropa, pelo, pestañas e iris. El especular responde a luz útil; una vista sin luz direccional puede no mostrar su efecto. Restaurar `0.5` y estados de prueba antes de guardar. Validar y hacer Build & Test; la aceptación del usuario en VRChat y la publicación son hitos separados.

## Evidencia de devolución

Registrar materiales de piel, renderers, propiedades RA reales, rangos adaptados, idioma, defaults, presupuesto y clips/controladores en `output/review/skin-controls.json`. Para nuevas exportaciones cuyo manifiesto contiene `skinControlsRevision`, un check `materials=passed` requiere `report.skinControls` con esta estructura; no basta entregar el texto de esta guía:

```json
{
  "schema": "fita-vrchat-skin-controls/v1",
  "revision": "2026-10-20-skin-v1",
  "sourceAlbedoPreserved": true,
  "nonSkinUnaffected": true,
  "skinMaterials": ["Assets/Character/Materials/Skin.mat"],
  "skinRenderers": ["Face", "Hands"],
  "controls": [
    {
      "parameter": "FITA_SkinBrightness",
      "parameterType": "Float",
      "menuControl": "RadialPuppet",
      "defaultValue": 0.5,
      "animatorDefault": 0.5,
      "saved": true,
      "networkSynced": true,
      "onlySkin": true,
      "lockedShaderVerified": true,
      "samples": [
        {"value": 0, "passed": true, "evidence": ["review/brightness-low.png"]},
        {"value": 0.5, "passed": true, "evidence": ["review/brightness-default.png"]},
        {"value": 1, "passed": true, "evidence": ["review/brightness-high.png"]}
      ]
    }
  ]
}
```

Añadir una segunda entrada obligatoria con `parameter: FITA_SkinSpecular` y sus tres muestras reales, con los mismos defaults y banderas. Incluir estos archivos también en `materials.evidence`; FITA valida rutas y conserva la evidencia con el informe. El validador comprueba lo reportado y los archivos, no demuestra por sí solo la ejecución de Unity ni la prueba del cliente. Mantener `materials` pendiente si falta configurar o comprobar un control; registrar limitaciones honestas si no existe una zona de piel aplicable. Los manifiestos anteriores mantienen su identidad sin reescritura retroactiva, aunque reciben la guía actualizada al descargar instrucciones.

Referencias primarias: [Poiyomi locking y RA](https://www.poiyomi.com/10.0/general/locking), [iluminación](https://www.poiyomi.com/10.0/shading/light-data), [reflejos y especular](https://www.poiyomi.com/10.0/shading/reflections-and-specular), [Expression Menu](https://creators.vrchat.com/avatars/expression-menu-and-controls/), [Playable Layers](https://creators.vrchat.com/avatars/playable-layers/).
