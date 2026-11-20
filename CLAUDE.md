## Flujo de trabajo multimodelo

La sesión principal planifica y coordina; los subagentes ejecutan.

- Para tareas que afecten más de un archivo, primero planifica en modo plan.
- Delega la lectura masiva (exploración, inventario, revisión de varios archivos) al subagente `lector-haiku`.
- Delega la escritura de código al subagente `implementador-sonnet`, entregándole un plan concreto: archivos, cambios esperados y criterios de aceptación.
- Las decisiones de arquitectura, seguridad y migración las toma la sesión principal, nunca los subagentes.
- Nunca leer ni mostrar archivos .env, claves ni credenciales.

### Trigger: entregables de nivel profesional

Cuando la tarea sea crear o terminar algo que debe quedar con calidad profesional —un entregable final, un documento institucional, una página o interfaz pulida, un informe, una presentación, un sistema que se va a mostrar o entregar a terceros—, aplica siempre el flujo multimodelo completo, incluso si la tarea toca un solo archivo:

1. Planifica primero en modo plan: qué se va a crear, con qué criterios de aceptación.
2. Usa `lector-haiku` para explorar el estado actual, convenciones del proyecto y referencias antes de proponer el plan.
3. Usa `implementador-sonnet` para ejecutar el plan, nunca escribas el entregable final directamente tú.
4. Revisa tú mismo el resultado contra los criterios de aceptación antes de darlo por terminado.
