# Coherencia del acabado y revisión a distancia

Cabeza, cuerpo y cabello deben compartir intención de pintura, guiada por el concepto aprobado. Esto no impone el mismo material ni el mismo brillo: el pelo puede ser más brillante que la piel. No unir atlas, no reducir resolución y no aumentar contraste como receta.

Compartir también la familia de sombras de los materiales de piel de rostro y cuerpo: tinte, transición e intensidad con una luz común. Conservar sus albedos, atlas e islas independientes. Una diferencia de normales puede cambiar la zona sombreada aunque la paleta sea la misma; no igualar iluminación pintando encima. Etiquetar materiales exclusivamente de piel con extras.workbenchSurfaceRole=skin, y exclusivamente de cabello con hair cuando el contrato de exportación permita metadatos. No etiquetar ropa mezclada como piel: requiere una máscara revisada. El visor aplica una máscara cromática solo a dominios mixtos explícitamente revisados; no es un detector universal de piel. Comprobar que no afecte ropa, labios, cejas ni accesorios. Los cambios del visor no equivalen a cambios guardados en el GLB.

1. Abrir ambos modelos y referencias vigentes. Comparar en una composición común o en encuadres equivalentes, sin alterar su colocación aprobada. Usar la misma exposición, balance de blancos y fondo. Alternar Base Color sin luz y una luz neutra común; no comparar capturas con iluminaciones distintas.
2. Muestrear regiones comparables de piel: zona de mejilla sin rubor, mandíbula/cuello, hombro o antebrazo sin sombra pintada. Registrar qué se comparó y diferencias observadas. No igualar promedios de imágenes completas ni aplicar una corrección global a materiales de ojos, prendas o pelo. La piel de sombra y la iluminada no deben forzarse al mismo RGB.
3. Elegir el tono de referencia del concepto, no asumir que el rostro o cuerpo generado es el correcto. Corregir solo máscaras de piel afectadas, conservar rubor, maquillaje y gradientes intencionales. Igualar matiz/valor base y familia de sombras cuando la diferencia venga de referencias inconsistentes. Revisar la transición mandíbula/cuello sin cambiar geometría.
4. Comparar cabeza, cuerpo y cabello como conjunto: dureza y espesor de los bordes pintados, transiciones, familia cromática de sombras y reflejos, nivel de detalle. Mantener diferencias de material justificadas. Revisar frente, ambos perfiles y espalda; conservar el estilo del concepto. Si falta cabello, indicarlo en paintConsistency, no inventarlo.
5. Aplicar el relleno de bordes indicado en bordes-uv.md. Revisar con mipmaps en acercamiento, personaje completo y lejos, en Base Color e iluminación neutra. Los bordes negros deben desaparecer a la distancia real de uso, sin cambiar paleta para esconderlos. Revisar también aliasing y detalles oscuros vecinos.
6. Completar ambas revisiones del informe antes de la entrega única. El importador comprueba que están documentadas y que cubren todos los atlas originales editables; eso no equivale a una aprobación artística automática. Las capturas/evidencias quedan en el workspace local para el usuario.

Formato de report.json (sustituir descripciones y valores por observaciones reales):

```json
{
  "jointReview": {
    "status": "checked",
    "parts": ["head", "body", "hair"],
    "modes": ["base-color", "neutral-light"],
    "views": ["front", "left", "right", "back"],
    "skinComparison": "Regiones comparadas, discrepancias y correcciones o motivo de conservarlas",
    "paintConsistency": "Comparación de sombras, reflejos y pincelada entre las tres zonas"
  },
  "uvReview": {
    "status": "checked",
    "mipmaps": true,
    "distances": ["close", "full-character", "distant"],
    "modes": ["base-color", "neutral-light"],
    "findings": "Resultado observado y rutas de capturas locales comparables",
    "atlases": [
      {"part": "head", "index": 0, "paddingPx": 16, "status": "extended", "reason": "Margen medido y comprobación del resultado"}
    ]
  }
}
```

La lista atlases debe contener cada imagen Base Color editable de atlas-index.json una sola vez (parte e índice exactos), con status extended o verified-existing. El ejemplo no es una medición. paddingPx debe reflejar margen real; cero solo es válido si el contenido lo justifica (p. ej., color uniforme sin bordes contrastantes). Nunca inventar pruebas ni marcar completado con pendientes.
