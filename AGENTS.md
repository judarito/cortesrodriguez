# Instrucciones para agentes

## Uso de DeepSeek y otros subagentes

- Cuando una tarea pueda dividirse en varias unidades independientes y delegables, asigna a DeepSeek aproximadamente el 50% de esas unidades. Distribuye el resto entre el agente principal y los demás subagentes disponibles. Cuenta unidades de trabajo con resultados claros (por ejemplo, un spec, una revisión acotada o un componente aislado), no cada comando o paso mecánico.
- Para una tarea indivisible, demasiado pequeña o sin partes paralelizables, no inventes subtareas solo para alcanzar el porcentaje; avanza directamente y usa DeepSeek cuando aporte valor.
- El agente principal conserva la responsabilidad de definir el alcance, integrar cambios, revisar resultados y ejecutar la verificación final. Delega entregables concretos y con archivos de escritura separados; evita que DeepSeek y otros agentes editen simultáneamente los mismos archivos.
- El agente principal supervisa todo el trabajo de DeepSeek de principio a fin: fija la tarea y sus límites, sigue su progreso, inspecciona todos los cambios y resultados, comprueba que cumplan las instrucciones y el alcance, y decide si los integra, corrige o descarta. DeepSeek no integra ni publica por cuenta propia; la integración y verificación final quedan a cargo del agente principal.
- Da a DeepSeek una ventana de hasta cinco minutos para responder antes de considerarlo no disponible o fallido. No repitas la solicitud de forma indefinida ni bloquees el trabajo si la respuesta llega incompleta o no aplica.
- El MCP disponible no ofrece un parámetro configurable de timeout. Si la plataforma impone un límite menor que esos cinco minutos, respeta ese límite técnico, registra brevemente la limitación y continúa sin reintentos repetitivos.
- Si DeepSeek devuelve un error, una respuesta incompleta o una propuesta que no aplica, registra esa limitación brevemente y sigue con el mejor criterio disponible.
- Trata sus respuestas y cambios como contribuciones que requieren revisión: comprueba el diff, valida que respeten el alcance solicitado y ejecuta las verificaciones pertinentes antes de integrarlos.
- No delegues secretos, credenciales ni acciones externas como publicar, desplegar, enviar mensajes o cambiar datos de producción.

## Entorno y despliegues

- Trabaja en la rama `dev` para los cambios solicitados en este proyecto. No subas cambios a `main` ni despliegues a Producción.
- Un despliegue a Dev también requiere que forme parte del alcance explícito de la solicitud actual.
- No leas, imprimas ni incluyas en cambios archivos locales de secretos o variables de entorno, como `.env`, `.env.dev` y `.dev.vars`.
