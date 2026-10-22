# Evidencia de colocación

## Lados y comparación

Left/right son los lados anatómicos del personaje, no del observador. Con personaje mirando a -Y y Z arriba: cámara frontal en -Y, izquierda en +X, derecha en -X, espalda en +Y. Si la escena usa otros ejes, conviértelos explícitamente. Nunca espejes un perfil para hacerlo coincidir: el pelo, orejas y accesorios pueden ser asimétricos. Identifica el lado por la cámara y por al menos un rasgo asimétrico cuando exista.

Compara a escala corporal común, sin distorsionar las imágenes. Registra ratios, no píxeles aislados: barbilla-coronilla/altura corporal, ancho craneal/hombros, avance nariz-cuello/altura corporal. Incluye puntos observados y su incertidumbre. No impongas un ratio universal de anatomía realista a un diseño anime.

En cada perfil evalúa nariz Y barbilla/oído/base craneal respecto al torso. En la unión observa tangencia y continuidad del cuello con la base craneal; no basta con que las cajas de objetos se toquen. Confirma ausencia de pared recta bajo la mandíbula, hueco visible o escalón, sin forzar coincidencia exacta con una ilustración.

## Registro

Tras abrir los renders finales escribe `placement-review.json`:

```json
{
  "schema": "placement-visual-review/v1",
  "sceneSha256": "hash de review-evidence.json",
  "comparisons": {
    "front": {"reference": "reference_front.png", "findings": "medidas observadas, cambios y límites", "acceptable": true},
    "left": {"reference": "reference_left.png", "findings": "lado verificado, nariz/barbilla/oído/cuello", "acceptable": true},
    "right": {"reference": "reference_right.png", "findings": "lado verificado, nariz/barbilla/oído/cuello", "acceptable": true}
  },
  "neck": {
    "front": {"image": "neck_front.png", "findings": "continuidad observada", "acceptable": true},
    "left": {"image": "neck_left.png", "findings": "unión visible, sin pared bajo mandíbula", "acceptable": true},
    "right": {"image": "neck_right.png", "findings": "unión visible, sin hueco", "acceptable": true}
  },
  "unresolved": [],
  "artistApprovalPending": true
}
```

Los textos del ejemplo indican el contenido que debes observar, no hallazgos que puedas copiar como evidencia. `acceptable` es tu evaluación técnica/visual, no aprobación del artista. Si una unión está oculta, registra `acceptable:false`, documenta el motivo y produce otra inspección. No pongas `true` para desbloquear el verificador.

`review-evidence.json` incluye `scene: {file, sha256}`, `renders` y `references` con rutas relativas y hashes. `review_placement.py` genera la evidencia de escena, vistas y referencias. Para añadir acercamientos tras su generación, usa `check_review.py <carpeta> --capture-necks`; lee y verifica la escena actual contra el hash antes de registrar las tres imágenes. No captura ni aprueba hallazgos. Después rellena el registro visual y ejecuta sin opciones para validar. Si cambia el .blend o cualquier imagen, vuelve a renderizar y revisar.

Guarda los dos registros junto al máster. El importador puede admitir paquetes antiguos por compatibilidad; eso no exime a un trabajo nuevo de revisar ambos perfiles. Los ZIP de resultado de colocación incluyen solo los archivos enumerados en sus instrucciones; conserva los registros auxiliares en la carpeta de trabajo y copia los hallazgos al report.json.
