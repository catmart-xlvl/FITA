# Contrato de trabajo visual

El contrato es el registro de decisiones, no un cuestionario para el usuario. Puede ser JSON, YAML o una tabla mantenida junto a los resultados. Usar identificadores estables; completar solo información pertinente. Para cambiar de vista, geometría y relaciones son obligatorias. Para una edición de color, conservar cámara/geometría sin inventar medidas innecesarias.

## Campos y significado

| Campo | Contenido requerido |
|---|---|
| Identidad | Identificador del diseño, revisión, solicitud actual y referencias fuente. |
| Autoridad | Instrucciones y correcciones explícitas del usuario; referencias aportadas; decisiones aceptadas; supuestos elegidos. Resolver conflictos sin sobrescribir silenciosamente una decisión. |
| Escala | Unidad y ancla. Sin escala física conocida usar una dimensión normalizada, por ejemplo altura=1. Una altura física elegida es objetivo de diseño, no altura deducida de píxeles. |
| Coordenadas | Origen, ejes, lateralidad y qué significa frente del objeto. Separar derecha del personaje, derecha de pantalla y dirección de cámara. |
| Partes | Identificador, función, forma, centro, orientación, dimensiones pertinentes, material/color y rasgos protegidos. Separar forma de posición. |
| Apariencia | Medio y estilo, calidad de línea, método de sombreado, paleta, iluminación y fondo. En personajes: tono visible de piel, color de cabello e iris, expresión y acabado de prendas. Registrar explícitamente lo no visible; no sustituirlo por una suposición. |
| Relaciones | Identificadores conectados, puntos de unión, continuidad, superposición, contacto, dependencia de pose y oclusión esperada. |
| Cámara | Vista, proyección, encuadre, objetivo y orientación; valores fijos si se puede ejecutar una cámara. No asignar grados supuestamente medidos cuando solo hay estimación. |
| Procedencia | Para cada dato: observado, medido, estimado o elegido. Fuente o motivo. Dato incierto convertido en decisión queda elegido y fijo para la generación. |
| Invariantes | Rasgos que no deben cambiar, incluido número de piezas, lado anatómico, dirección de accesorios, patrón y contactos. |
| Comprobación | Criterio observable y método: inspección, superposición, medición 2D o geometría. Resultado: cumple, difiere o no comprobable. |
| Historial | Revisión anterior, cambio concreto, motivo, archivos generados y estado de aprobación. |

## Números que reducen ambigüedad

- Seleccionar un valor objetivo único por dimensión; no enviar una distribución de posibilidades al generador. Los márgenes de incertidumbre pertenecen a la procedencia, no son instrucciones para variar el diseño entre vistas.
- Mantener relaciones algebraicas consistentes: si la altura se fija en 1 y el ancho en 0.25, no describir posteriormente el ancho como un tercio de la altura. Usar una fuente única para valores derivados.
- Para formas volumétricas importantes especificar ancho, alto/longitud, profundidad, sección, curvatura y grosor cuando correspondan. «Delgado», «curvo» o «hueco» no sustituyen estos datos si su ambigüedad afecta al resultado.
- Para curvas críticas fijar puntos de control o describir segmentos y tangencias coherentes. Para huecos indicar contorno, si atraviesan la superficie, profundidad si son cavidades, grosor del borde y apariencia interior. No sustituir un hueco por una pieza negra añadida.
- Expresar tamaño de detalle relativo a su parte, no relativo al lienzo cuando se cambiará de encuadre. Evitar decimales sin utilidad y magnitudes que no controlen ninguna propiedad observable.
- Cubrir todas las regiones y materiales de la imagen con una paleta sRGB explícita HEX/RGB, no solo el cabello o los rasgos principales: piel, iris, pupila, esclerótica, cabello, prendas, ribetes, correas, accesorios, metales, contornos y fondo cuando estén presentes. Cada elemento del inventario debe remitir a una entrada de paleta; compartir una entrada solo cuando corresponda al mismo objetivo cromático. No dejar materiales visibles sin especificación cromática.
- Para cada material distinguir tono medio, sombra y luz cuando existan; una región plana solo necesita su color objetivo. En degradados fijar colores extremos, dirección y distribución. Mantener separados paleta de material e iluminación. No inventar variaciones donde no existen, ni copiar la posición de una sombra frontal a una vista posterior con geometría diferente.
- Si hay archivo fuente, preferir muestras de regiones pequeñas sin bordes y registrar ubicación y método; distinguir colores medidos en la imagen iluminada de un albedo físico desconocido. Si una región es demasiado pequeña o ambigua para muestrearla con fiabilidad, elegir un valor objetivo y registrar su origen estimado. Transmitir valores firmes y su función al generador, no alternativas entre las que pueda elegir. Comprobar los colores del resultado sin asumir que escribir HEX garantiza igualdad numérica. No limitarse a nombres amplios como «verde oliva», «piel clara» o «plateado».
- Definir tolerancias solo cuando exista medición comparable. No introducir un porcentaje de fidelidad arbitrario ni aceptar una semejanza estética como validación métrica.

## Ficha dimensional corporal y de prendas

Antes de generar un personaje o una vista nueva, fijar una ficha dimensional. El agente interpreta la referencia y elige valores únicos; el generador recibe esos objetivos ya resueltos, sin rangos entre los que deba decidir. Completar los campos relevantes al encuadre y al diseño, sin inventar detalles de zonas fuera del encargo.

- **Escala común:** usar la estatura conocida, una escala física elegida o una unidad normalizada claramente definida. Si el cuerpo está recortado, puede usarse la longitud coronilla-mentón como unidad. No extrapolar una estatura física como si se hubiera medido. No mezclar dimensiones con y sin cabello.
- **Cabeza y cuello:** altura, anchura y profundidad de cabeza; longitud y sección del cuello; puntos faciales y separación de ojos cuando sean visibles. Registrar por separado envolvente del peinado y volumen craneal.
- **Torso:** ancho de hombros, longitud cuello-cintura y cintura-cadera, anchura y profundidad de tórax, cintura y caderas. Añadir contornos corporales cuando condicionen ropa ajustada; deben ser coherentes con las secciones elegidas, no números independientes contradictorios.
- **Extremidades:** longitudes de brazo, antebrazo, mano, muslo y pierna cuando sean pertinentes; anchuras o secciones en articulaciones y zonas de ajuste; posición de manos y pies. Registrar asimetrías reales; no confundir acortamiento en perspectiva con una extremidad físicamente más corta.
- **Pose:** un nombre como «pose T», «pose A» o «relajada» solo es etiqueta, nunca la especificación suficiente. Definir ejes del personaje, postura neutra, grados, sentido positivo, jerarquía de articulaciones y referencia local/global; si se usan Euler, indicar orden. Registrar por lado hombro (elevación lateral, flexión/extensión y rotación axial), codo, antebrazo, muñeca, cadera, rodilla y tobillo cuando estén dentro del encargo. Fijar inclinación y giro de pelvis, torso, cuello y cabeza; separar mirada de orientación de cabeza. Conservar longitud de segmentos al articularlos. No confundir rotación del personaje con movimiento de cámara.
- **Contactos de pose:** registrar posiciones objetivo de manos/pies y anclas de objetos o ropa. En un agarre indicar superficie de contacto de pulgar y dedos y su flexión pertinente. Resolver la compatibilidad de objetivos y ángulos antes de enviar; no exigir simultáneamente un contacto y una pose angular que lo hagan imposible. Para geometría ejecutable calcular o resolver cinemática cuando proceda. Para generación de imágenes, elegir una descripción numérica coherente sin afirmar que el generador ejecuta un rig; verificar lateralidad, dirección, articulaciones y contactos en el resultado. No añadir ángulos de dedos ocultos sin utilidad para el encargo.
- **Prenda:** medidas propias, longitud desde un ancla corporal, holgura respecto al cuerpo, grosor del tejido, aberturas y costuras visibles, bordes, tirantes, herrajes y puntos de sujeción. No medir el volumen exterior de ropa holgada y llamarlo medida corporal.
- **Pliegues:** separar estructura de confección de arrugas por tensión o gravedad. Cuando se necesite una construcción completa, elegir y registrar un número total alrededor de la prenda, su distribución frontal/posterior/lateral y anclas; no multiplicar el total para que todos sean visibles desde cada cámara. El cambio de pose puede deformar los pliegues sin cambiar su número estructural.
- **Material y escena:** definir acabado mate/satinado/brillante, rigidez o caída de tela, dirección y suavidad de iluminación, cámara y encuadre. Mantener estos parámetros cuando se compare una corrección de color o geometría, salvo cambio solicitado.

Para cada magnitud guardar valor, unidad, anclas, procedencia (medido en 2D / estimado en 3D / elegido) y método. Un ancho proyectado no es automáticamente un ancho anatómico. Las dimensiones ocultas elegidas forman una hipótesis de construcción coherente y estable; no volver a estimarlas en cada vista. Antes de enviar, verificar cobertura de ficha, paleta, conexiones, cámara y exclusiones; resolver contradicciones y valores pendientes dentro del alcance. Registrar lo que la herramienta solo puede interpretar y comprobar después lo observable, sin atribuir exactitud geométrica a un prompt numérico.

## Cambio de cámara: invariantes espaciales

### Identidad, material y anclaje de cada pieza

Antes de fijar una categoría, comprobar contorno, continuidad, origen y superficie visibles. No convertir una etiqueta tentativa en geometría obligatoria: dos mechones largos no son cintas por parecerlo, ni una oreja estrecha demuestra que sea de elfo. Las correcciones del usuario sustituyen la interpretación anterior en el contrato y en todas las vistas afectadas. Registrar la interpretación elegida de lo ambiguo; consultar solo cuando la decisión material no pueda resolverse con el encargo.

Cada pieza relevante incluye material elegido (pelo, piel, tejido, cuero, metal, etc.), acabado, rigidez o caída, grosor pertinente, pieza de origen, ancla de unión, dirección inicial y recorrido. Diferenciar dónde nace de por dónde pasa: para una cola de anatomía humanoide convencional, elegir una raíz posterior de pelvis coherente con el diseño, aunque un tramo pase delante del tórax; no fijar la raíz en las costillas por una superposición 2D. Conservar anatomías fantásticas expresamente definidas. Especificar cómo la ropa permite la salida y qué partes quedan ocultas, sin moverlas para exhibirlas.

### Encuadre, escala y alcance

Registrar cuerpo entero o segmento solicitado, límites incluidos y excluidos, proporción del lienzo y anclas de escala. Una pose T no anula una petición de torso aislado o de omitir cabeza/brazos. Para cuerpo entero incluir extremos de pelo, dedos, zapatos y accesorios requeridos. Usar solo el espacio libre necesario para evitar cortes; no imponer grandes márgenes. Nunca acortar brazos, ensanchar cintura o cambiar proporciones para encajar en el formato. Fijar tamaño del sujeto y cámara compatibles con el lienzo. Para vistas comparables mantener escala y anclas comunes; si aprovechar todo el lienzo exige distintas escalas por la anchura proyectada, registrar esa diferencia en vez de afirmar que son plantillas a igual escala.

### Continuidad a cargo del agente

El contrato guardado es la fuente de decisiones entre llamadas. Cada solicitud transmite explícitamente las dimensiones, materiales, paleta, laterales, conexiones, cantidades, pose y cámara pertinentes, además de las referencias autorizadas. No confiar en que el generador recuerde otra imagen. Distinguir pieza ausente de pieza ocluida; no replicar en el lado contrario un accesorio oculto. Comprobar cada salida contra el mismo contrato y la referencia original antes de usarla como guía siguiente.

Para una vista nueva de una escena estática, mantener la geometría y las transformaciones de objetos; modificar únicamente la cámara. Una espada unida a una mano conserva su dirección en el sistema del personaje, aunque se proyecte más corta o quede parcialmente oculta desde atrás. No reflejar la escena para simular una vuelta de cámara.

Si se usa geometría real, la proyección se obtiene de punto local → transformación de objeto → transformación de cámara → proyección. Si solo se usa un generador, describir esas relaciones como objetivos y comprobarlas después; no afirmar que la herramienta ejecutó esas matrices.

Cuando continuidad, contactos u orientación sigan fallando, considerar un volumen 3D sencillo y cámaras compartidas como guía si el alcance permite crearlo. No construir una escena nueva ni adjuntar imágenes auxiliares contra una restricción explícita del usuario.

## Verificación sin reinterpretación silenciosa

1. Comparar con fuente y contrato, no exclusivamente con la última imagen generada.
2. Revisar primero identidad/silueta y relaciones espaciales; después superficies, colores y detalles. Un acierto de color no compensa una conexión equivocada.
3. Para escala 2D usar encuadre/cámara equivalentes o relaciones entre anclas identificables. No comparar longitudes en píxeles de vistas con perspectiva diferente como medidas físicas.
4. Si solo hay una imagen lateral, marcar profundidad y grosor reales como no comprobables cuando no exista evidencia suficiente; no asumir cumplimiento por un brillo convincente.
5. Una corrección cambia solo parámetros implicados y explicita los que quedan bloqueados. Con generación estocástica, comparar también los no modificados: una nueva muestra puede alterarlos.
6. No atribuir una mejora a los números sin una comparación adecuada. Variar una familia de parámetros facilita investigar, pero una muestra no demuestra causalidad.

## Casos de control

- Referencia sin regla ni objeto de tamaño conocido: se fijan proporciones o escala elegida; no se presenta una estatura como medición.
- Vista posterior con accesorio sujeto: mano, agarre y eje del accesorio se conservan; el lado de pantalla puede cambiar.
- Patrón rojo sobre traje negro: no crear relieve solo por el cambio de color.
- Abertura oscura convertida en gema: incumple la especificación de hueco aunque conserve color y posición.
- Nueva sesión: leer contrato guardado; si falta, reconstruirlo desde la evidencia disponible y marcar las decisiones nuevas, sin inventar aprobaciones anteriores.
