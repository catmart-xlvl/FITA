# Preparación de un personaje de FITA para VRChat PC

Guía para Codex. Aplicar cuando el usuario solicite preparar su personaje para VRChat, después de aprobar Rigging. No ejecutar esta etapa solamente por recibir el paquete de instrucciones de Rigging. No es una declaración de que cualquier exportación ya está lista para VRChat.

Revisión 2026-10-17: el usuario incorpora al flujo oficial la base de materiales Poiyomi ensayada en Review11. Leer también `VRCHAT_PC_REFERENCE_PROFILE.json`, entregado junto a esta guía en el directorio local indicado por el paquete. Contiene versiones, propiedades, curvas y resultados concretos del piloto. Es una referencia declarativa: Codex debe implementarla, adaptarla y comprobarla; recibir el JSON no configura Unity automáticamente. Los refinamientos de máscaras y anisotropía propuestos después de Review11 todavía no están implementados ni aprobados como acabado final.

Revisión 2026-10-20: aplicar también **`VRCHAT_PC_SKIN_SETUP.md`**. Todos los personajes de FITA preparados para VRChat PC incluyen **Skin Brightness / Brillo de piel** y **Skin Reflection / Reflejo de piel**, controles independientes obligatorios, con centro en el aspecto aprobado. Adaptar la base Poiyomi a cada paleta; los ajustes ensayados en ReferenceAvatar son una referencia aproximada y no una receta numérica universal. Conservar el albedo. Las nuevas entregas deben aportar el contrato y la evidencia de ambos controles para dar materiales por terminados; las anteriores conservan sus manifiestos y reciben la guía actualizada.

## Entrada, conservación y registro

La etapa **Exportar > Exportar para VRChat** prepara un ZIP que contiene únicamente instrucciones y rutas, después de aprobar cuerpo y expresiones faciales en Rigging. Leer el manifiesto local: identifica la revisión facial aprobada y la versión exacta del rig original, incluidos los últimos pesos manuales válidos. No usar geometría del donante. Los modelos, texturas, runtime y bindings permanecen en el proyecto local, fuera del ZIP. No añadir un cuestionario fijo ni un árbol de instalación: comprobar los requisitos reales y pedir solo la información o autorización que falte.

El paquete distingue `input/character.glb` (rig, pesos y morphs autorizados), `input/body.blend` (fuente editable conectada), `input/facial.blend` (autoría facial), `input/runtime.json` y `input/bindings.json`. Antes de convertir a un formato para Unity, reconciliar los pesos y deformaciones de las copias editables con el GLB autorizado. No dar por equivalentes dos archivos por su nombre. Mantener identidades de vértice y pesos uniformes en las costuras. Un FBX es un intermedio cuando se necesite, no el objetivo final.

### Expresiones anime y controles de destino

Conservar también las **sombras oculares superiores (Eye Shadow)** y sus bindings coordinados de parpadeo. Pueden ser dos renderers o una malla bilateral manual; incluir explícitamente sus blendshapes en los mismos controles que los párpados, manteniendo negro semitransparente, alpha aprobado y normales de cada pose. Comprobar neutral, cierres parciales, cierre completo y mirada desde ambos perfiles: no deben flotar, atravesar el párpado ni tapar los brillos. No fusionarlas con el iris ni eliminarlas al convertir materiales.

Leer también **`VRCHAT_PC_FACIAL_SETUP.md`** y el apartado `facial` de `VRCHAT_PC_REFERENCE_PROFILE.json`: son el contrato mantenido de configuración facial en Unity/VRChat. Incluyen Eye Look nativo con recorrido acotado del iris, coordinación de visemas y expresiones, preservación de normales y un interruptor de parpadeo por cámara **activado por defecto**, con parpadeo automático estable al apagarlo. Esta configuración se implementa y verifica en destino; no queda ejecutada por descargar el ZIP.

Los botones, submenús y etiquetas de ejes del avatar van **en inglés por defecto**: **Camera Blink, Mood, Mouth, Brows**, etc. El idioma del chat y de FITA no decide el idioma del avatar. Reutilizar una preferencia explícita del usuario para este personaje; si no existe, preguntar una vez antes de crear el menú y usar inglés si queda sin especificar. Un idioma solicitado explícitamente prevalece. Guardar idioma y mapa de etiquetas en la configuración del personaje; traducir solo los textos visibles, manteniendo los IDs de parámetros y bindings. No repetir la pregunta si ya está resuelta.

Usar los bindings coordinados aprobados. Cada expresión puede afectar varios SkinnedMeshRenderers: cara/párpado, pestañas, iris, pupila, brillos y cejas según el ajuste. Crear clips que vinculen explícitamente cada renderer y blendshape; comprobarlos juntos. Configurar el modo de lip sync adecuado: el selector nativo de visemas de un solo renderer no mueve por sí solo todos los demás. Para coordinación mediante FX, evaluar **Viseme Parameter Only** y clips conducidos por el parámetro `Viseme` (0–14), verificando transiciones y regreso a neutral. Si se utiliza SIL nativo, verificar que Unity no haya eliminado el target vacío; conservar la neutralidad visual. No introducir Jaw Flap Bone en sustitución del movimiento anime de labios aprobado.

Los morphs de mirada no equivalen a los huesos de Eye Look nativo ni garantizan eye tracking. Configurar y comprobar Eye Look nativo para el seguimiento compatible; un menú FX manual por sí solo no satisface esta integración. Aplicar el adaptador y los límites ajustados al personaje descritos en la guía facial; 6,5 mm es el radio inicial en metros mundiales, no una distancia local universal. Mantener iris, pupila y brillos como conjunto rígido, sin encogerlos al parpadear. Evitar escritores simultáneos de párpados y mantener la mirada al apagar Camera Blink. El filtro de zona muerta que empeoró los cierres al mirar abajo no se incorpora como solución. Revisar mirada+parpadeo y habla+expresión en ambos modos, Unity y VRChat, también en espejo. Los menús de ánimo no demuestran seguimiento emocional de cámara. Documentación mantenida: [Lip sync](https://creators.vrchat.com/avatars/creating-your-first-avatar/#lip-sync-mode), [parámetros](https://creators.vrchat.com/avatars/animator-parameters/), [capas de animación](https://creators.vrchat.com/avatars/playable-layers/).

### Devolución a FITA

Seguir los nombres exactos de salida y el esquema de informe entregados en las instrucciones locales. Separar configuración de Unity, Humanoid, materiales, auxiliares, PhysBones, bindings faciales, validación SDK, Build & Test, prueba del usuario en VRChat y publicación. Guardar evidencia real, limitaciones y rutas de los artefactos. Cargar el informe en Exportar; la aplicación muestra hitos **reportados**, sin inferir publicación ni compatibilidad completa a partir de un ZIP o FBX. Si falta una prueba o una acción de cuenta, queda pendiente. Publicar requiere autorización explícita del usuario.

Identificar el proyecto, versión aprobada, manifiesto y rutas entregadas por FITA. Si son instrucciones locales, leer UBICACIONES.json: las rutas corresponden a la máquina donde se generó el paquete. Si faltan o pertenecen a otro equipo, regenerar el paquete en la aplicación; no sustituir el personaje por uno encontrado en otro proyecto.

Usar una copia versionada del GLB/FBX, runtime.json y texturas. Mantener intactos el BLEND conectado aprobado, los archivos fuente y los manifiestos de origen. Registrar hashes, inventario de mallas/materiales, huesos, shape keys, altura solicitada, herramientas y versiones. No regenerar modelos ni contratar servicios de pago para convertir un resultado que ya existe.

Mantener una bitácora con pasos pendientes, en curso, verificados en archivos, compilados y comprobados por el usuario en VRChat. Cada corrección debe incluir causa, alcance, respaldo, evidencia y limitaciones. Una compilación correcta no demuestra buen movimiento o acabado.

## Un proyecto de Unity por personaje y trabajo concurrente

Regla del flujo de FITA: **un proyecto de Unity por personaje**. No es una limitación de Unity: es el aislamiento elegido para que otro Codex pueda seguir el paquete sin conocer otros chats abiertos. Las revisiones, atuendos y pruebas del mismo personaje pueden permanecer en ese proyecto con activos y salidas versionados. No importar un personaje distinto en el proyecto de otro por comodidad.

Antes de escribir, vincular el `projectId` del manifiesto de FITA con una carpeta física de Unity exclusiva. Elegirla dentro de la ubicación de proyectos del usuario, con nombre legible e identidad de FITA suficiente para distinguir personajes con el mismo nombre. No usar rutas del piloto como destino predeterminado. Crear una carpeta nueva si no existe; reutilizar únicamente un proyecto cuya pertenencia a este mismo personaje esté comprobada. No vaciar, fusionar ni sobrescribir una carpeta existente sin identificarla. Registrar en una bitácora local la relación entre `projectId`, ruta física, revisión de origen, escenas, salidas y blueprint de VRChat, y comprobarla al retomar. Si falta esa relación, no deducir identidad solo por el nombre de carpeta.

Resolver enlaces/junctions para comparar destinos reales. Comprobar si hay un editor o proceso de importación/compilación trabajando en ese mismo proyecto; no iniciar un segundo editor sobre la misma carpeta ni eliminar bloqueos de `Temp`. Si otro trabajo tiene el destino ocupado, coordinar o esperar; no interrumpirlo, cerrarlo ni editar sus archivos. Un editor abierto no prueba por sí solo conflicto: se puede continuar en su sesión si está inequívocamente vinculada a esta tarea. Proyectos de personajes distintos pueden permanecer abiertos; no cerrar otros editores para esta exportación. No actualizar paquetes compartidos, modificar proyectos ajenos ni cambiar configuración global sin necesidad y autorización correspondientes.

Usar nombres de escenas, informes, temporales y pruebas locales que distingan personaje y revisión, también fuera de Unity: dos proyectos pueden escribir en la misma carpeta de avatares de prueba de VRChat. No reutilizar el blueprint de otro personaje ni sobrescribir una prueba local ajena. Para un personaje nuevo sin identidad de publicación, crear su propia identidad cuando se autorice publicar; las actualizaciones del mismo personaje conservan la suya tras verificarla. Registrar las comprobaciones de aislamiento en la evidencia de `unity-project`; no declarar aislamiento automático ni ausencia garantizada de conflictos solo por recibir el ZIP.

## Requisitos y programas ausentes

Comprobar realmente las instalaciones, no solo accesos directos o carpetas de proyectos. Se necesitan Unity compatible, proyecto Avatars administrado por VRChat Creator Companion y cliente de VRChat para probar. Blender sirve si hace falta convertir o revisar el modelo. Unity Hub es una vía de gestión/instalación; no es el editor. No hacen falta cargadores de mods.

Consultar la versión oficial en https://creators.vrchat.com/sdk/upgrade/current-unity-version/ antes de instalar. El piloto comprobado utilizó Unity 2022.3.22f1 y SDK Avatars/Base 3.10.5; son datos históricos, no una regla para versiones futuras. Unity más reciente no implica compatibilidad con VRChat.

Si falta un programa, explicar qué falta y su finalidad; obtener autorización para instalarlo si todavía no existe, consultar descarga/espacio requerido en el instalador oficial y comunicar el tamaño antes de descargar cuando el usuario lo pida. Usar la ruta predeterminada salvo preferencia del usuario. Verificar firma digital y resultado de instalación. El usuario atiende avisos de administrador, licencias e inicio de sesión; no pedir contraseñas ni copiar credenciales a registros. Si ya autorizó la instalación y ruta, continuar sin volver a solicitar la misma aprobación.

Vincular el editor compatible en Creator Companion y crear/reutilizar un proyecto Avatars de PC exclusivo de este personaje según la regla anterior. Instalar módulos móviles solo si se solicitan. Comprobar compilación del SDK y sesión del Builder. Los nombres de carpetas por sí solos no acreditan una instalación válida.

Guardar el proyecto real en el disco y carpeta elegidos por el usuario, fuera de cachés internas de Codex u otra aplicación empaquetada. En Windows, dos procesos pueden ver contenido diferente bajo una ruta virtualizada de AppData. Verificar ubicación física, acceso desde Explorador/Hub/Creator Companion y ausencia de dependencia de un enlace roto. Si hay que trasladarlo: guardar y cerrar Unity, comprobar espacio, copiar a una carpeta temporal, verificar inventario y hashes, sustituir únicamente el enlace identificado y abrir desde la carpeta real. Conservar el origen como respaldo hasta validar. No copiar archivos de bloqueo de `Temp` como si fueran datos del personaje. Actualizar accesos y registros de proyecto sin borrar otros proyectos ni credenciales.

Si aparece “No valid Unity Editor license”, comprobar la licencia Personal en Unity Hub con la cuenta del usuario. Que Hub no muestre proyectos no demuestra pérdida de archivos: añadir la carpeta existente; si falta el editor en Installs, localizar la instalación compatible. Lanzar Unity sin `-projectPath` puede abrir solo Hub. Consultar la advertencia oficial de seguridad de la versión: la recomendación vigente para proyectos VRChat puede diferir de la de aplicaciones Unity independientes; no actualizar por un triángulo rojo sin verificar compatibilidad.

## Importación y estructura del personaje

Importar una copia con inventario estricto: exportar solo mallas aprobadas y esqueleto. Excluir donantes, cámaras, controles visuales, objetos de demostración e Icosphere auxiliares. No borrar una pieza desconocida sin identificarla. Comparar nombres, geometría, pesos, UV, normales y morphs antes/después de la conversión.

Conservar normales personalizadas, en especial cabello anime: usar Import Normals y comprobar numéricamente o con iluminación comparable que la exportación las conserva. Conservar también el campo compartido de rostro, párpados, pestañas, cejas, escleróticas, iris, pupilas y brillos, y los deltas de normales de todas sus expresiones. Verificar tras la conversión parpadeo e intensidades intermedias con luz rotada; conservar solo POSITION y recalcular normales por triángulo pierde este acabado. No recalcularlas para esconder un fallo de iluminación. Duplicados de UV no implican desconexión editable, pero sí deben compartir pesos y deltas cuando representan el mismo vértice conectado de origen.

Configurar rig Humanoid, mapear huesos y medir pose de referencia. Una inclinación pequeña de brazos es un indicio que debe contrastarse con la calibración de Unity. Preservar la anatomía aprobada; calibrar el Avatar de destino y revisar ejes/retargeting antes de desplazar articulaciones. Respaldar cualquier cambio de auxiliares o jerarquía. Resetear y comprobar que no cambia la superficie en reposo.

Para aplausos, reposo y gestos, comprobar todo el ciclo y sus transiciones: una captura no acredita ausencia de cruces. Una animación personalizada puede adaptarse a proporciones, pero debe declararse y no presentarse como reparación universal del rig. Mantener animación original para comparar. Conservar las convenciones reales de bindings de dedos de Unity.

## Huesos auxiliares, controles y persistencia

Leer runtime.json: importar huesos no ejecuta automáticamente recetas de twist, volumen o correctivos. Convertir a mecanismos admitidos por VRChat, con ejes medidos en el marco local de reposo, fracciones y orden correctos. Probar cada lado por separado y sus combinaciones. No marcar una receta pendiente como convertida.

Usar constraints nativos admitidos. Separar swing de torsión axial cuando corresponda: copiar todos los ejes de un muslo o brazo puede causar deformaciones erróneas. Validar el marco de la rotación con poses numéricas, no solo la presencia del componente.

No hacer que Constraint y PhysBone controlen el mismo Transform: colocar el control cinemático en un padre auxiliar y la simulación en la cadena hija. Si una modificación de jerarquía de un modelo prefab no persiste, respaldar y desempaquetar únicamente la instancia de destino, conservando el activo fuente. Comprobar inmediatamente el padre real y después guardar, cerrar/reabrir y repetir la pose. En el piloto se movían pivotes sin arrastrar las cadenas tras guardar: medir solamente los pivotes dio un falso positivo.

Las modificaciones de colocación/calibración y adaptaciones de jerarquía para Unity pertenecen a esta etapa de destino. No reescribir silenciosamente el esqueleto anatómico del donante de Rigging.

## PhysBones y unidades

Los huesos secundarios necesitan VRC Phys Bone, configuración e influencia efectiva sobre la superficie. Comprobar componentes activos, raíces, cadenas, huesos ponderados y endpoints antes de ajustar fuerzas. Para un hueso único definir un extremo virtual adecuado.

Medir en metros mundiales. El piloto tenía escala interna de huesos cercana a 158 pese a medir 1.58 m. Convertir radio y extremo desde metros a unidades locales usando la transformación correspondiente; no copiar coordenadas locales como metros. Contrarrestar la escala heredada en helpers de colliders y comprobar tamaño mundial. La lista interna de huesos reales no añade el extremo virtual: no exigir un hueso adicional ficticio.

En Simplified, Pull devuelve a reposo, Spring aporta oscilación y Gravity influye hacia abajo/arriba. Una fuerza de retorno más alta puede reducir la movilidad, aunque Spring aumente. Ajustar una variable o un grupo acotado por prueba. Evaluar curvas en articulaciones reales usando su ratio, no solo en cero/uno abstractos.

Cabello: fijar la unión en posición, distribuir la rigidez a lo largo de la cadena y permitir libertad progresiva. Según el peinado, un giro pequeño en el primer segmento puede ser necesario para evitar una base rígida demasiado larga. Las puntas no deben soltar toda la masa desde la raíz. Afinar por separado coletas y mechones próximos a la cara. Comprobar cruces con cabeza, cuello, hombros y torso. Registrar qué valores aprobó el usuario; no aplicar el mismo preset a todos los personajes.

Usar `physics` del perfil como punto de partida medido: coletas Pull 0.55 con multiplicador descendente hasta 0.60 y Spring 0.38 creciente desde 0.15; mechones delanteros Pull 0.72 hasta 0.45 efectivos y Spring 0.30 desde cero; Gravity cero en ambos. Son curvas multiplicativas, no porcentajes de pesos de vértice. Evaluar cada articulación con el ratio real del SDK y conservar/interrogar las tangentes de interpolación. “Raíz fija” se refiere al punto de unión: en el piloto, las coletas admitían 5° en el primer segmento, mientras los mechones delanteros mantenían cero. No inmovilizar varios huesos superiores si el peinado necesita balanceo desde más arriba. No aumentar Pull y esperar más libertad, ni usar Spring para compensar una región sin pesos.

Colisiones: inventariar y asignar explícitamente cabeza, torso, cuello y hombros para cabello, y pelvis/muslos para falda; ajustar por anatomía y reposo real, no por el número de componentes. Los ejemplos de radios del perfil están en metros mundiales. Comprobar que los colliders no empujan la cadena ya en reposo, que cubren los huecos de cuello/hombro/pelvis y que no impiden innecesariamente el recorrido aprobado. Separar interacción con otros avatares de colisiones locales. Probar giros, arranque/parada, inclinación, agachado sostenido y regreso a reposo. No garantizar que ninguna superficie se solapará por tener siete colliders ni añadir más huesos sin demostrar que hace falta.

Pecho/glúteos: no confundir hueso presente con jiggle visible. Medir cobertura y fuerza de pesos, simetría anatómica y desplazamiento de la superficie bajo rotaciones controladas, con unidades físicas. En el piloto había desplazamientos inferiores a un milímetro y gran diferencia izquierda/derecha. Corregir pesos en Rigging cuando proceda; revisar el ajuste de auxiliares en la copia de destino sin alterar la fuente. El usuario decide si quiere respuesta sutil, media o fuerte. No añadir físicas de muslos si quedaron fuera del alcance.

## Ropa y deformación estática

La prenda ajustada debe acompañar a la piel sin copiar indiscriminadamente pesos a mangas o falda sueltas. Comparar piel/prenda en ambos lados, revisar bandas de fijación, separación geométrica y correctivos; transferir y suavizar pesos solo en regiones autorizadas. Revisar tirantes por separado: un lado correcto no demuestra el otro.

Una fijación anatómica protegida no exige una franja central rígida en la prenda. Si el centro debe acompañar al pecho, usar una región compartida con mezcla progresiva de ambos auxiliares y soporte anatómico restante. Revisar continuidad a través del centro, bordes y costuras después de limitar influencias; no crear cortes por signo X ni bandas de peso cero. Esa mezcla intencional no equivale a filtración accidental hacia la extremidad opuesta.

PhysBones no simula cada vértice de tela. Las colisiones en muslos/pelvis pueden ser insuficientes aunque los huesos no penetren. Una falda anclada solo a pelvis puede requerir seguimiento parcial de muslos, pesos diferentes, correctivos u otra distribución de cadenas. Probar agachado sostenido y sentado sin movimiento, además de caminar agachado. El piloto mejoró en movimiento con padres de seguimiento, pero siguió penetrando en reposo: esa limitación permanece abierta, no existe una solución universal demostrada.

## Materiales anime y texturas

El flujo oficial de aspecto anime para PC adopta **Poiyomi Toon gratuito** como base probada, conservando un shader ya aprobado si el encargo lo exige. El piloto usó Toon 10.0.25 con ThryEditor 2.74.3, disponibles mediante el repositorio oficial `https://poiyomi.github.io/vpm/index.json`. Usar Creator Companion para resolver las dependencias. Verificar la versión disponible y su compatibilidad antes de instalar; registrar la versión elegida y no sustituir silenciosamente una base que funciona. Para VRChat se usa Built-in, no el paquete URP. Pro no es necesario para SSS, contornos y los reflejos empleados aquí; no adquirir suscripciones automáticamente. Un nombre local como “Poiyomi Trial” describe una escena de comparación, no una licencia temporal.

Conservar albedo aprobado, materiales originales y una escena de referencia. Crear materiales/escena de destino propios para comparar, con mapeo explícito renderer → material → texturas → perfil. Mantener normales personalizadas del cabello, UV, pesos y morphs; no usar la conversión de shader para rehacerlos. Mantener el aspecto dibujado con sombras controladas, brillo especular moderado y respuesta ambiental equilibrada. La comprobación Review11 conservó 223 archivos originales y convirtió nueve materiales en una escena separada; no se exige ese inventario a otros personajes.

### Base de Poiyomi y máscaras

Aplicar las propiedades exactas de `materials` del perfil como referencia inicial, con `HasProperty` o comprobación equivalente para la versión instalada. Sincronizar keywords mediante las herramientas soportadas por esa versión de ThryEditor; escribir un float sin activar su función no acredita efecto. Los materiales optimizados/locked requieren desbloqueo soportado o copias nuevas antes de editar y una nueva optimización después; no cambiar valores sobre un shader con constantes horneadas y esperar que respondan.

- **Iluminación común:** el piloto usó mínimo 0.38, límite 1.05 y desaturación de luces 0.82 tanto para piel como cuerpo/ropa. Ajustar contra las referencias del usuario y con las mismas luces/cámaras; estos valores no sustituyen una máscara ni deben aclarar solo el rostro.
- **Piel:** SSS suave mediante `_SubsurfaceScattering` y una máscara de color/espesor; base probada Strength 0.14, Spread 3 y Distortion 0.45. Responde a la luz, especialmente a contraluz. El rubor permanente corresponde a albedo o una capa separada; no atribuir cualquier mejilla rosa al SSS. Evitar manchas duras en nariz/cara y transmisión sobre ropa, ojos o uñas. Una máscara aproximada no es una medición de espesor anatómico.
- **Cabello:** es dieléctrico, con metallic cero. Conservar su tono y limitar el reflejo antes de añadir bandas estilizadas. La anisotropía estaba desactivada en Review11: es una mejora propuesta que exige ajuste por orientación, UV/tangentes y referencia. No presentarla como ya probada.
- **Tela, cuero y metal:** preparar regiones distintas para partes mates, satinadas y herrajes. Los atlas compartidos requieren máscaras; no volver brillante toda la prenda ni convertir en metal todos los píxeles claros. En el piloto ese criterio volvió gris y metálico el cabello claro; se corrigió excluyendo semánticamente el cabello del metal. El perfil registra los valores usados y esta limitación de las primeras máscaras.
- **Contorno:** conservar la silueta oscura de todo el personaje, con grosor fino por región. Referencia probada: 0.45mm rostro, 0.6mm piel, 0.8mm cabello y 0.9mm ropa/botas; Poiyomi divide `_LineWidth` por cien. Con escala interna grande, usar el espacio mundial o hacer la conversión medida una sola vez. Reducir marcas interiores con una máscara de tamaño; evitar contornos adicionales en pupilas, brillos y capas de labios. No eliminar la silueta para ocultar un fallo interior. El contorno de casco invertido puede abrir costuras; si se necesitan normales exclusivas para contorno, trabajar sobre una copia, conservar normales de sombreado, colores de vértice existentes y revisar la deformación. El piloto no horneó normales de contorno en colores de vértice.

Autoría recomendada: pintar sobre el modelo 3D y guardar mapas separados en sus UV existentes; revisar también el atlas 2D, uniones, padding y mipmaps. Usar selección de piezas/regiones para identificar material y transiciones suaves donde corresponda. Un borde físico metal/cuero puede ser nítido; una mezcla de efecto sobre la piel no debe crear una banda rígida. No confundir estas máscaras de shader con weight maps de huesos.

En el empaquetado PBR usado por este perfil, `_MochieMetallicMaps` emplea R metal, G smoothness, B reflexión y A especular; cargar como datos con sRGB desactivado. Smoothness blanco significa superficie más pulida: no tratar un mapa de roughness con el mismo sentido. En `_SSSThicknessMap`, RGB colorea transmisión y A representa espesor que el shader invierte; comprobar el canal y la fórmula en la versión usada. Una textura rosa o una máscara blanca por sí solas no configuran todas estas funciones.

### Preparación para el SDK y verificación visual

Revisar el probe anchor de todos los renderers. El aviso **Thry: Automatic Lighting Fix** propone asignar un ancla común a las mallas que no tienen una, para reducir diferencias de iluminación. Inspeccionar anclas intencionales ya configuradas; activar el arreglo cuando corresponda. No atribuir a él la solución universal de z-fighting, mipmaps o pesos. El aviso **Locking Materials** es la optimización de los materiales utilizados; pulsar OK permite continuar. No significa comprar Pro ni caducidad. La primera compilación puede tardar minutos: esperar y leer progreso antes de lanzar otra.

Comparar frente, perfil y tres cuartos, cuerpo entero y primer plano, con iluminación neutra, oscura, amarilla intensa y contraluz; conservar cámara/luz idénticas entre variantes. Revisar piel frente a cuello/cuerpo, nariz y labios, cabello sin reflejo metálico, costuras y silueta, botas y herrajes. No identificar el shader original de una referencia por su apariencia ni prometer igualdad exacta por cambiar a Poiyomi. Las máscaras detalladas, el SSS anatómico y la dirección de brillos requieren su propia revisión de acabado.

Equilibrar luminosidad mínima de rostro, cuello y cuerpo. No iluminar solo el rostro hasta que destaque artificialmente en un mundo oscuro. Comparar luz neutra, ambiente oscuro y luz de color intensa; las botas del piloto se volvieron amarillas bajo luz amarilla con el material inicial. Reducir influencia cromática/efectos especulares de forma acotada sin prometer un color idéntico bajo cualquier entorno.

Separar emisión suave de halo visible: el bloom depende del mundo y de la cámara. No prometer glow independiente por activar emisión. Respetar el nivel de luminosidad aprobado y no añadir menús/toggles si el usuario los difiere.

Si aparecen franjas oscuras o parpadeo dependiente de distancia, mantener luz constante y comparar distancia/ángulo; revisar mipmaps, padding de islas UV, filtrado, compresión, normales y superficies superpuestas. No atribuirlo automáticamente a luces o costuras ni unir islas como solución sin diagnóstico. Activar streaming de mipmaps y compresión apropiada cuando lo requiera SDK, preservando originales.

## Altura, descriptor y rendimiento

Recuperar la altura guardada por FITA, documentar su convención (el piloto incluye cabello/calzado), medir el resultado en metros y aplicar solo el factor necesario una vez. Ajustar vista del Avatar Descriptor y dimensiones de físicas después de escala. No estimar altura por perspectiva de una captura.

Configurar Descriptor, vista y ajustes humanoides/expresiones disponibles. Declarar ausencias: los correctivos de hombro no son expresiones faciales. Un avatar puede probarse corporalmente sin visemas, parpadeo u ojos móviles, pero no describirlo como configuración facial completa.

Leer estadísticas SDK: triángulos, skinned meshes, materiales, memoria de texturas, huesos, constraints y costes de físicas. No culpar solo al conteo de triángulos. Separar avisos de rendimiento de errores que bloquean el build. Consultar umbrales actuales; no afirmar optimizado por comprimir texturas si persisten otras causas.

## Automatización, prueba local y publicación

Preferir scripts del editor y API pública del SDK para importación, configuración, validación y Build & Test. Hacer pasos repetibles e idempotentes, respaldos y solicitudes únicas con caducidad. No ejecutar builds duplicados por recargas. Verificar que Unity cargó el código nuevo; Assets > Refresh importa/compila, pero no actualiza por sí solo el avatar que el usuario lleva en VRChat.

Si queda código viejo cargado, comprobar compilación/importación y solicitar foreground/Refresh; guardar y reabrir solo si realmente hace falta. Esperar compilación antes de otra orden. Si se pierde sesión, esperar inicio de sesión del usuario. No capturar credenciales ni deducir errores de transcripciones ambiguas: distinguir «déjalo miro» de un aviso real.

Versionar también el nombre del marcador de cada preparación: una clase vieja no debe consumir y borrar una acción nueva que desconoce. Comprobar compatibilidad antes de consumirla, y registrar error recuperable/expiración. El piloto necesitó restablecer una solicitud de refinamiento consumida por una asamblea anterior. Si el SDK espera sin nuevos registros, comprobar primero avisos modales de Thry/Unity y autenticación; no reiniciar ni duplicar el build como diagnóstico inicial.

Un build válido exige reporte reciente, validación sin errores y archivo local existente correspondiente a esa versión. Restaurar selección/escena y eliminar clones temporales sin borrar la versión estable. Una excepción del panel después del build no demuestra que el bundle haya fallado; revisar ambas cosas separadamente.

Indicar nombre exacto de la nueva prueba y cómo seleccionarla en SDK Test Avatars > Apply. Probar cuerpo en escritorio sin exigir trackers. La compatibilidad de full-body tracking requiere rig/proporciones adecuados y cada usuario calibrará sus trackers; no certificar comportamiento físico sin esa prueba.

La prueba local solo se carga en ese equipo; no equivale a subir a la cuenta. Para publicar, requerir la autorización correspondiente y usar la cuenta destino. Un avatar subido como privado es visible para otros cuando su dueño lo lleva: privado restringe quién puede usarlo. Un avatar público puede propagarse por clonación; desactivar clonación en el dueño no controla a quienes ya lo usan. No prometer impedir redistribución a alguien que recibe los archivos.

Finalizar con estado por apartado (fuente, rig, pesos, auxiliares, materiales, físicas, altura, SDK, prueba real, publicación), rutas de evidencia y pendientes. Conservar los fallos sin resolver para el siguiente ensayo completo concepto → vistas → modelos → Rigging → VRChat. No declarar probado todo el flujo con un único personaje ni por validar componentes individualmente.

## Registro de fallos y límites que debe consultar cada Codex

| Síntoma observado | Causa o límite comprobado | Corrección/revisión y estado |
|---|---|---|
| Rodillas/hombros tiraban de la superficie tras exportar | Huesos auxiliares presentes sin ejecutar todos sus controles | Convertir recetas y probar articulaciones reales. Rodillas y movimiento general mejoraron según el usuario; no dar por convertidas recetas de correctivos aún pendientes. |
| Brazos atravesaban ropa en idle y manos se sobrepasaban en el aplauso | Se detectaron desalineaciones de pose de referencia; el ajuste de una animación es específico de esa animación | Calibrar Humanoid y contrastar más ciclos/poses. El aplauso fue adaptado explícitamente: no certifica retargeting universal. |
| Tirantes se hundían en el cuerpo | Diferencias locales de deformación entre prenda y superficie ajustada | Transferencia localizada, continuidad de pesos y separación; el tirante del hombro **derecho anatómico** conserva cruce residual. |
| Franja central rígida al añadir jiggle | Primera máscara dejaba una banda medial casi sin influencia | Mezcla compartida y suave de auxiliares con soporte anatómico; revisar centro, costuras e influencias después de pruning. La respuesta estática mejoró; no confundirla con rebote dinámico ya aprobado. |
| Huesos de pecho/glúteos activos sin movimiento visible | Pesos débiles y asimétricos; aumentar solo Spring no mueve una superficie sin influencia efectiva | Medir y reparar pesos en Rigging; continuar el ajuste de fuerzas en destino. No añadir físicas de muslos si están diferidas. |
| Se esperaba aislamiento completo de coletas | Algunas ponderaciones del bloque central correspondían a la coleta izquierda | Revisar masas conectadas y pesos, no solo nombres/jerarquías; la pequeña filtración detectada quedó pendiente, no reparada. |
| Cabello excesivamente rígido tras añadir rampas | Retorno/límites y zona superior demasiado restrictivos | Evaluar ratios reales; separar perfiles de coletas y mechones frontales, disminuir retorno y permitir giro superior acotado; más Spring no corrige por sí solo todo ello. |
| Fallaba el conteo de cadena o el extremo parecía gigantesco | Endpoint virtual contado como hueso y confusión entre metros/local con escala interna grande | Comparar solo Transform reales y medir endpoint/radios mundiales tras conversión. Comprobaciones aisladas corregidas; guardar evidencia. |
| Pivotes de falda se movían, pero el resultado no persistía | Reparenting de instancia prefab no conservado | Verificar hijos reales, desempaquetar solo la instancia de destino cuando haga falta y reabrir antes de validar. |
| Falda parecía funcionar al caminar agachada, pero atravesaba el muslo estando quieta | Simulación por cadenas/colliders y seguimiento parcial no garantizan contacto de toda la superficie | Sigue abierto. Probar postura estática; podrían requerirse pesos, correctivos o una distribución diferente de cadenas. |
| Botas amarillas, rostro aislado demasiado luminoso | Respuesta inicial a luces de color y mínimos desiguales | Equilibrar iluminación por materiales y reducir influencia cromática, verificando varias luces; el parpadeo inicial no quedó atribuido de forma concluyente a una única causa. |
| Cabello gris/metálico con Poiyomi | Máscara automática basada en brillo clasificó cabello claro como metal | Pelo dieléctrico y exclusión semántica; los mapas detallados por zona siguen siendo refinamiento pendiente. |
| Hub/Creator Companion no mostraban el proyecto y un enlace de F fallaba | Proyecto en almacenamiento virtualizado de la aplicación, inaccesible mediante la ruta aparente | Copia verificada a carpeta física elegida por el usuario y registro de esa ruta; no usar la ruta interna del piloto como plantilla. |
| Build parecía detenido después de iniciar sesión | Ventanas de Automatic Lighting Fix y Locking Materials esperando al usuario; después hubo compilación inicial larga | Resolver el aviso correspondiente y seguir el build existente. Review11 produjo un bundle local de 96.018.792 bytes sin errores de validación. |
| Refresco correcto pero avatar antiguo seguía puesto | Refresh no sustituye un avatar activo en el cliente | Verificar bundle nuevo, elegir su nombre exacto en SDK Test Avatars y Apply. |

Registrar problemas nuevos con la misma separación: observación, causa comprobada o hipótesis, ajuste, evidencia y pendiente. Mantener las instrucciones generales reutilizables y los valores particulares identificados como referencia del piloto.

## Referencias oficiales

- Versión de Unity: https://creators.vrchat.com/sdk/upgrade/current-unity-version/
- PhysBones y separación de constraints: https://creators.vrchat.com/common-components/physbones/
- Constraints/API: https://creators.vrchat.com/common-components/constraints/constraints-api/
- Rendimiento: https://creators.vrchat.com/avatars/avatar-performance-ranking-system/
- Poiyomi Toon y ThryEditor: https://www.poiyomi.com/download
- Release probada: https://github.com/poiyomi/PoiyomiToonShader/releases/tag/v10.0.25
- SSS: https://www.poiyomi.com/shading/subsurface-scattering
- Reflejos y mapas: https://www.poiyomi.com/shading/reflections-and-specular
- Contornos: https://www.poiyomi.com/10.0/outlines

Los valores concretos reutilizables se entregan en `VRCHAT_PC_REFERENCE_PROFILE.json`; la bitácora histórica de LastUpdates se conserva en `VRCHAT_PC_PILOT_NOTES.md` y `VRCHAT_REVIEW8_SKIRT_HAIR.md` en la aplicación. Son evidencia del piloto, no una garantía universal ni resultados que otro personaje pueda declarar sin probarlos.
