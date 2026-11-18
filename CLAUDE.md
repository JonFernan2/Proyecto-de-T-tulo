## Flujo de trabajo multimodelo

La sesión principal planifica y coordina; los subagentes ejecutan.

- Para tareas que afecten más de un archivo, primero planifica en modo plan.
- Delega la lectura masiva (exploración, inventario, revisión de varios archivos) al subagente `lector-haiku`.
- Delega la escritura de código al subagente `implementador-sonnet`, entregándole un plan concreto: archivos, cambios esperados y criterios de aceptación.
- Las decisiones de arquitectura, seguridad y migración las toma la sesión principal, nunca los subagentes.
- Nunca leer ni mostrar archivos .env, claves ni credenciales.
