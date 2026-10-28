# Instrucciones para agentes

## Uso de DeepSeek como subagente

- DeepSeek es un apoyo opcional para tareas acotadas que puedan ejecutarse en paralelo. No es requisito para completar una tarea.
- Si el MCP de DeepSeek no está disponible, falla o no responde dentro de un tiempo razonable, continúa el trabajo principal sin esperar por él. No repitas indefinidamente la llamada ni bloquees el avance.
- Si DeepSeek devuelve un error, una respuesta incompleta o una propuesta que no aplica, registra esa limitación brevemente y sigue con el mejor criterio disponible.
- Trata sus respuestas y cambios como contribuciones que requieren revisión: comprueba el diff, valida que respeten el alcance solicitado y ejecuta las verificaciones pertinentes antes de integrarlos.
- Delega tareas independientes y específicas; evita que varios agentes editen simultáneamente los mismos archivos. No delegues secretos, credenciales ni acciones externas como publicar, desplegar, enviar mensajes o cambiar datos de producción.

## Entorno y despliegues

- Trabaja en la rama `dev` para los cambios solicitados en este proyecto. No subas cambios a `main` ni despliegues a Producción.
- Un despliegue a Dev también requiere que forme parte del alcance explícito de la solicitud actual.
- No leas, imprimas ni incluyas en cambios archivos locales de secretos o variables de entorno, como `.env`, `.env.dev` y `.dev.vars`.
