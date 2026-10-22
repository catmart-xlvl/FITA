---
name: especificacion-visual-coherente
description: Convertir referencias o ideas visuales en especificaciones firmes de proporciones, geometría, relaciones espaciales y cámaras antes de generar imágenes, vistas o modelos. Usar entre proyectos para conservar el diseño y verificar resultados; también al corregir deriva entre vistas. No activa generación ni modifica proyectos por una consulta conceptual.
---

# Especificación visual coherente

Método general independiente de aplicaciones y proyectos. Estado: procedimiento en prueba; no garantiza fidelidad del generador ni reconstrucción exacta de superficies ocultas. Aplicarlo como apoyo a la herramienta de creación solicitada, sin sustituirla ni modificar otras skills. No presentar estas instrucciones como aprendizaje permanente de los pesos del modelo.

## Regla central

**Estimar → elegir → fijar → generar → comprobar.** El agente asume el análisis y las decisiones rutinarias. No pedir al usuario que convierta la imagen en coordenadas. Una estimación elegida se comunica al generador como un objetivo concreto, sin «quizá», intervalos de alternativas o invitaciones a reinterpretar el diseño. Su procedencia estimada permanece registrada: objetivo firme no equivale a medición comprobada.

## Procedimiento obligatorio para una creación

1. Inspeccionar las referencias efectivamente disponibles. Identificar silueta, proporciones, partes, colores, materiales, aberturas, asimetrías, contactos y oclusiones. Describir explícitamente el estilo y acabado: medio visual, línea, sombreado, detalle, paleta e iluminación. En personajes incluir tono visible de piel, cabello, ojos, expresión y vestuario; no darlos por sobreentendidos ni inferir etnia del tono. Separar color base de tintes de iluminación, dibujo superficial, brillo/sombra y volumen; una zona de otro color no implica otra pieza 3D.
2. Leer [references/contrato-visual.md](references/contrato-visual.md). Crear o recuperar una única especificación de trabajo según ese contrato. Para producción guardarla junto a los resultados, con revisión y procedencia. No crear archivos por una pregunta meramente conceptual. Reutilizar un registro equivalente existente en vez de duplicarlo.
3. Fijar una solución coherente para la información oculta, usando continuidad y construcción plausibles. No truncar superficies en la oclusión ni inventar adornos. Elegir valores de trabajo; preguntar únicamente por ambigüedades que cambien materialmente identidad, silueta o función y no se resuelvan con el encargo. No pedir aprobación de cada parámetro.
4. Para personajes, completar la ficha dimensional corporal del contrato antes de generar. Definir longitudes, anchuras, profundidades y, cuando la prenda lo requiera, contornos y holguras. Mantener separados cuerpo, ropa y perspectiva. Comprobar que dimensiones, ejes, conexiones y cámara no se contradigan. Corregir la especificación antes de generar. Conservar rasgos aprobados. Si cambia la cámara, no cambiar la pose ni orientar accesorios hacia el observador para hacerlos visibles.
5. Transmitir objetivos firmes, relaciones y exclusiones precisas. La continuidad es responsabilidad del agente: cada llamada recibe una especificación suficiente derivada del mismo contrato y las referencias pertinentes, sin suponer memoria del generador ni sustituir detalles por «mantener coherencia». Usar el formato que admita la herramienta: texto estructurado no es código ejecutado. Adjuntar referencias solo si está permitido por el encargo; si el usuario pide prueba sin imágenes, no incluir originales, recortes ni resultados anteriores.
6. Inspeccionar el resultado real y compararlo con la especificación y la fuente. Revisar conexiones, dirección respecto al objeto, laterales, recuentos y proporciones; no limitarse a colores o apariencia general. Distinguir cumplimiento visual, medición y propiedades 3D que una imagen no permite comprobar.
7. Corregir el defecto concreto manteniendo los demás valores. Por defecto realizar hasta dos correcciones dirigidas por entrega; después explicar la discrepancia y proponer cambio de método o entregar provisional. Respetar autorización y coste; no reenviar trabajos con estado desconocido ni reintentar bloqueos para eludir controles de seguridad. Un nuevo encargo del usuario puede autorizar otra prueba, dentro de esos límites.

## Persistencia y entrega

- Mantener separada la conversión a apariencia 3D gris o la simplificación de detalles hacia texturas. Son tratamientos opcionales solicitados aparte, no requisitos de este método. Aplicar el encuadre al alcance concreto: cuerpo completo o segmento solicitado, con máximo aprovechamiento del lienzo sin deformar la anatomía.

- Al retomar, leer la última especificación y resultados antes de generar. No reconstruir decisiones a partir de un recuerdo aproximado del chat. Mantener la fuente original como evidencia; una vista generada no confirma por sí misma lo oculto.
- Registrar qué cambió, por qué, y qué versión del resultado corresponde a cada revisión. No marcar una propuesta como aprobada por el usuario sin aprobación real.
- Informar de forma breve: qué se generó, qué se verificó, qué difiere y qué sigue siendo supuesto. No prometer exactitud matemática de un generador de imágenes solo porque el prompt incluye números.
- Esta skill queda disponible para selección automática en el entorno donde esté instalada. No afirmar que modifica instrucciones globales del sistema o que está cargada en todos los chats y dispositivos.
