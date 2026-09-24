🔴 AUDITORÍA TÉCNICA COMPLETA — NODE.JS / NESTJS BACKEND

Quiero que actúes como un Senior Software Architect + Senior Backend Engineer + Senior Node.js/NestJS Developer + Security Reviewer + Code Reviewer, con experiencia en sistemas backend empresariales, APIs REST, arquitecturas escalables y aplicaciones de producción.

Tu nivel de exigencia debe ser el de un Tech Lead revisando el backend de una aplicación que deberá mantenerse durante varios años y soportar crecimiento real de usuarios, tráfico y funcionalidades.

NO quiero una auditoría superficial.

NO quiero que simplemente ejecutes un checklist.

Quiero que entiendas la arquitectura, el flujo de datos y las responsabilidades de cada módulo antes de emitir conclusiones.

⸻

1. OBJETIVO PRINCIPAL

Debes realizar una auditoría técnica profunda del backend, módulo por módulo.

La aplicación está desarrollada principalmente con:

* Node.js
* NestJS
* TypeScript
* REST API
* Controllers
* Services
* Modules
* Dependency Injection
* DTOs
* Pipes
* Guards
* Interceptors
* Exception Filters
* Middleware
* JWT / autenticación
* Autorización / roles / permisos
* ORM o acceso directo a base de datos
* SQL / NoSQL, si aplica
* Redis / cache, si aplica
* Queues / workers, si aplica
* WebSockets, si aplica
* Docker, si aplica
* PM2, si aplica
* Variables de entorno
* Testing
* Logging
* Observabilidad

Adapta la auditoría a las tecnologías que realmente existan en el proyecto.

No asumas que una tecnología existe simplemente porque es habitual en NestJS.

⸻

2. REGLA PRINCIPAL: ANALIZAR MÓDULO POR MÓDULO

Debes identificar primero los módulos reales de la aplicación.

Por ejemplo:

* Auth
* Users
* Roles
* Permissions
* Dashboard
* Vehicles
* Notifications
* Reports
* Billing
* etc.

Estos son solamente ejemplos.

Debes utilizar los módulos reales encontrados en el código.

Para cada módulo:

1. Entiende su responsabilidad.
2. Identifica todos sus archivos relacionados.
3. Entiende el flujo completo.
4. Revisa Controller → Service → Repository/Database.
5. Revisa DTOs.
6. Revisa Guards.
7. Revisa Pipes.
8. Revisa Interceptors.
9. Revisa Exception Filters.
10. Revisa Middleware relacionado.
11. Revisa validaciones.
12. Revisa autenticación/autorización.
13. Revisa acceso a datos.
14. Revisa manejo de errores.
15. Revisa performance.
16. Revisa seguridad.
17. Revisa testing.
18. Revisa arquitectura.
19. Revisa mantenibilidad.
20. Revisa escalabilidad.

NO emitas conclusiones sobre un módulo después de revisar únicamente uno o dos archivos.

⸻

3. REGLA FUNDAMENTAL: NO INVENTAR

No inventes problemas.

No inventes funcionalidades.

No asumas comportamiento que no pueda demostrarse con el código.

Si algo no puede verificarse, debes indicar:

No verificable con el código disponible.

Diferencia claramente entre:

🔴 Problema confirmado

Existe evidencia directa en el código.

🟠 Riesgo potencial

Existe una situación que podría generar un problema dependiendo de condiciones que no pueden verificarse completamente.

🟡 Recomendación

No existe necesariamente un bug, pero existe una mejora técnicamente justificable.

🔵 Mejora opcional

Mejora de calidad que no es necesaria para el funcionamiento correcto.

NO marques como problema algo que simplemente sea una preferencia personal de arquitectura.

⸻

4. ENTENDER PRIMERO LA ARQUITECTURA

Antes de auditar los módulos, identifica:

* Arquitectura general.
* Organización de carpetas.
* Módulos NestJS.
* Dependencias entre módulos.
* Punto de entrada de la aplicación.
* Configuración global.
* Base de datos.
* ORM utilizado.
* Sistema de autenticación.
* Sistema de autorización.
* Servicios externos.
* Cache.
* Colas.
* WebSockets.
* Sistema de logs.
* Testing.
* Docker.
* Configuración de producción.

Explica brevemente cómo funciona actualmente la arquitectura.

NO propongas cambiar la arquitectura todavía.

Primero entiende la arquitectura existente.

⸻

5. REVISIÓN DE ARQUITECTURA NESTJS

Analiza específicamente:

Modules

Revisa:

* Responsabilidad de cada módulo.
* Cohesión.
* Acoplamiento.
* Imports innecesarios.
* Exports innecesarios.
* Dependencias circulares.
* Módulos demasiado grandes.
* Módulos que contienen demasiadas responsabilidades.
* Dependencias entre módulos.
* Reutilización correcta de módulos.
* Shared modules.
* Global modules.

Pregunta:

¿La separación de módulos representa realmente las responsabilidades del dominio?

⸻

Controllers

Revisa:

* Controllers demasiado grandes.
* Lógica de negocio dentro del Controller.
* Acceso directo a base de datos.
* Validaciones manuales innecesarias.
* Transformaciones que deberían estar en Services.
* Código duplicado.
* Manejo incorrecto de HTTP status codes.
* Responses inconsistentes.
* Parámetros mal definidos.
* Endpoints demasiado complejos.

Un Controller debería principalmente encargarse de:

HTTP → validación/transformación → delegación → respuesta.

Detecta cualquier desviación importante.

⸻

Services

Revisa:

* Services demasiado grandes.
* God Services.
* Mezcla de responsabilidades.
* Acceso directo a HTTP cuando no corresponde.
* Lógica de negocio duplicada.
* Dependencias excesivas.
* Métodos demasiado largos.
* Transacciones.
* Manejo de errores.
* Reutilización.

Determina si el Service representa correctamente la lógica de negocio.

⸻

Dependency Injection

Revisa:

* Inyección correcta de dependencias.
* Dependencias innecesarias.
* Dependencias circulares.
* Uso incorrecto de forwardRef.
* Instanciación manual de clases que deberían utilizar DI.
* Providers innecesarios.
* Providers globales innecesarios.
* Violaciones de Dependency Inversion.

NO recomiendes abstraer todo simplemente para aplicar SOLID.

⸻

6. ARQUITECTURA Y SEPARACIÓN DE RESPONSABILIDADES

Determina si existe una separación razonable entre:

Controller
    ↓
Service / Use Case
    ↓
Repository / Data Access
    ↓
Database

Cuando la arquitectura utilizada sea diferente, explica por qué puede ser válida.

Busca:

* Business logic dentro de Controllers.
* SQL dentro de Controllers.
* SQL dentro de DTOs.
* Acceso a DB desde Guards sin necesidad.
* Servicios que mezclan infraestructura y dominio.
* Integraciones externas mezcladas con lógica de negocio.
* Duplicación de reglas de negocio.

⸻

7. API DESIGN

Revisa todos los endpoints del módulo.

Analiza:

* REST conventions.
* HTTP methods.
* HTTP status codes.
* Resource naming.
* Path parameters.
* Query parameters.
* Request body.
* Response structure.
* Pagination.
* Filtering.
* Sorting.
* Search.
* Versioning.
* Idempotency.
* Consistencia entre endpoints.
* Error responses.

Detecta:

* 200 utilizado incorrectamente.
* POST cuando debería existir PUT/PATCH.
* GET modificando información.
* Endpoints con responsabilidades múltiples.
* Responses inconsistentes.
* Datos internos expuestos accidentalmente.

⸻

8. DTOs Y VALIDACIÓN

Revisa:

* DTOs.
* class-validator.
* class-transformer.
* ValidationPipe.
* whitelist.
* forbidNonWhitelisted.
* Transformaciones.
* Validaciones obligatorias.
* Validaciones duplicadas.
* DTOs demasiado genéricos.
* DTOs reutilizados incorrectamente.
* Response DTOs.
* Exposición accidental de entidades.

Analiza si la validación ocurre en el lugar correcto.

Especialmente verifica:

HTTP input
    ↓
Validation
    ↓
Transformation
    ↓
Business logic

No debe permitirse que datos no confiables lleguen directamente a lógica sensible sin validación.

⸻

9. AUTENTICACIÓN

Audita profundamente:

* JWT.
* Access tokens.
* Refresh tokens.
* Expiración.
* Rotación.
* Revocación.
* Storage.
* Secrets.
* Password hashing.
* Login.
* Logout.
* Sesiones.
* Token reuse.
* Token leakage.
* Brute force.
* Rate limiting.

Revisa:

* bcrypt / argon2, si aplica.
* Secretos hardcodeados.
* JWT secrets débiles.
* Tokens almacenados incorrectamente.
* Tokens enviados en logs.
* Expiraciones excesivamente largas.
* Refresh tokens sin protección.

⸻

10. AUTORIZACIÓN

No basta con comprobar que el usuario está autenticado.

Revisa:

* Roles.
* Permissions.
* Guards.
* Policies.
* Resource ownership.
* RBAC.
* ABAC, si aplica.

Busca específicamente:

IDOR / BOLA

Por ejemplo:

GET /users/123

Debe comprobarse que el usuario autenticado realmente tenga permiso para acceder al recurso 123.

Busca casos donde:

authenticated ≠ authorized

⸻

11. SEGURIDAD

Realiza una auditoría de seguridad basada en riesgos reales.

Revisa:

* OWASP API Security.
* Injection.
* SQL Injection.
* NoSQL Injection.
* XSS cuando aplique.
* CSRF cuando aplique.
* SSRF.
* IDOR / BOLA.
* Broken authentication.
* Broken authorization.
* Mass assignment.
* Excessive data exposure.
* Rate limiting.
* Brute force.
* Sensitive data exposure.
* Security headers.
* CORS.
* Helmet.
* Input validation.
* File uploads.
* Path traversal.
* Command injection.
* Deserialization.
* Dependency vulnerabilities.

Revisa también:

* .env.
* Secrets.
* API keys.
* Database credentials.
* Private keys.
* Tokens.
* Logs.
* Error messages.

Nunca asumas que algo es seguro solamente porque utiliza NestJS.

⸻

12. DATABASE / ORM

Identifica la tecnología utilizada:

* PostgreSQL
* MySQL
* MongoDB
* DynamoDB
* Prisma
* TypeORM
* Sequelize
* Mongoose
* mysql2
* etc.

Audita:

* Queries.
* Índices.
* Relaciones.
* N+1 queries.
* Joins.
* Transactions.
* Connection pooling.
* Connection leaks.
* Pagination.
* Sorting.
* Filtering.
* Query complexity.
* Lazy loading.
* Eager loading.
* Locking.
* Concurrency.
* Constraints.
* Foreign keys.
* Unique constraints.
* Nullability.
* Data consistency.

Busca especialmente:

N+1 queries

Demuestra el escenario concreto donde ocurre.

Queries innecesarias

Queries dentro de loops

Falta de índices

Solo marca falta de índices cuando exista evidencia suficiente para justificarlo.

⸻

13. TRANSACCIONES Y CONSISTENCIA

Revisa operaciones que modifican múltiples recursos.

Determina si necesitan transacciones.

Ejemplo:

Create Order
↓
Create Payment
↓
Update Inventory

Si una operación falla en el paso 3:

¿Qué sucede con los pasos anteriores?

Busca:

* Operaciones parcialmente completadas.
* Rollbacks inexistentes.
* Transactions incorrectas.
* Transactions demasiado grandes.
* Deadlocks potenciales.
* Race conditions.
* Concurrency issues.

No marques una operación como problemática solamente porque no utiliza una transacción.

Explica primero por qué sería necesaria.

⸻

14. CONCURRENCIA Y RACE CONDITIONS

Presta especial atención a:

* Requests simultáneos.
* Actualizaciones concurrentes.
* Double submit.
* Inventarios.
* Contadores.
* Estados.
* Pagos.
* Reservas.
* Locks.
* Transactions.
* Jobs concurrentes.
* Procesamiento duplicado.
* Retries.

No asumas que existe una race condition simplemente porque existe código async.

Debes demostrar:

1. Escenario.
2. Request A.
3. Request B.
4. Estado compartido.
5. Resultado incorrecto.

⸻

15. ASYNC / PROMISES

Revisa:

* async/await.
* Promises.
* Promise.all.
* Promise.allSettled.
* Manejo de errores.
* Requests secuenciales innecesarios.
* Requests paralelizables.
* Fire-and-forget.
* Unhandled promises.
* Await faltantes.
* Procesos bloqueantes.

Busca:

await A()
await B()
await C()

cuando realmente sea seguro ejecutar:

await Promise.all([A(), B(), C()])

Pero NO optimices automáticamente.

Primero determina si existe dependencia entre operaciones.

⸻

16. PERFORMANCE BACKEND

Audita:

* Tiempo de respuesta.
* Database queries.
* N+1.
* Serialización.
* Payloads.
* Cache.
* Redis.
* CPU-intensive operations.
* Memory usage.
* Event loop blocking.
* Requests externos.
* Concurrency.
* Connection pools.
* Pagination.
* Compression.
* Streaming.

Busca especialmente operaciones que puedan bloquear el Event Loop.

Ejemplos:

* procesamiento pesado de archivos;
* loops enormes;
* criptografía costosa;
* procesamiento síncrono;
* JSON gigantes;
* operaciones CPU-bound.

⸻

17. CACHE

Si existe Redis/cache:

Revisa:

* Qué se cachea.
* TTL.
* Invalidación.
* Cache keys.
* Stale data.
* Cache stampede.
* Cache poisoning.
* Consistencia.
* Memory usage.

Pregunta:

¿La estrategia de cache mejora realmente el sistema o solamente agrega complejidad?

No recomendar cache si no existe una necesidad demostrable.

⸻

18. QUEUES Y BACKGROUND JOBS

Si existen:

* BullMQ.
* Bull.
* SQS.
* RabbitMQ.
* Kafka.
* Workers.
* Cron jobs.

Revisa:

* Retries.
* Backoff.
* Dead letter queue.
* Idempotency.
* Duplicate processing.
* Job locking.
* Concurrency.
* Timeouts.
* Error handling.
* Observabilidad.
* Poison messages.

Un job debe poder fallar sin dejar el sistema en un estado inconsistente.

⸻

19. SERVICIOS EXTERNOS

Revisa integraciones con:

* APIs externas.
* AWS.
* Firebase.
* Stripe.
* Wompi.
* Email providers.
* SMS.
* Maps.
* Storage.
* etc.

Analiza:

* Timeout.
* Retry.
* Backoff.
* Circuit breaker cuando sea necesario.
* Error handling.
* Rate limits.
* Credentials.
* Idempotency.
* Logging.
* Fallbacks.

Nunca asumas que una API externa siempre estará disponible.

⸻

20. ERROR HANDLING

Revisa:

* Exception Filters.
* HttpException.
* Custom exceptions.
* Status codes.
* Error responses.
* Internal errors.
* Database errors.
* External API errors.
* Validation errors.
* Authentication errors.
* Authorization errors.

Busca:

try/catch

innecesarios.

Pero también busca ausencia de manejo donde realmente sea necesario.

Determina si el sistema puede:

* ocultar información sensible;
* devolver stack traces;
* filtrar errores correctamente;
* mantener una estructura consistente de errores.

⸻

21. LOGGING

Revisa:

* console.log.
* Logger de NestJS.
* Winston.
* Pino.
* Structured logging.
* Log levels.
* Correlation IDs.
* Request IDs.
* Sensitive data.

Nunca deberían aparecer en logs:

* passwords;
* JWT;
* refresh tokens;
* API keys;
* secrets;
* información sensible.

Evalúa si los logs permiten investigar un incidente de producción.

⸻

22. OBSERVABILIDAD

Revisa cuando aplique:

* Logs.
* Metrics.
* Tracing.
* Health checks.
* Readiness.
* Liveness.
* Monitoring.
* Error tracking.
* Request IDs.

Pregúntate:

Si este endpoint empieza a fallar en producción a las 3 AM, ¿el equipo podría descubrir rápidamente por qué?

⸻

23. CONFIGURACIÓN

Audita:

* .env.
* ConfigModule.
* Environment variables.
* Configuration validation.
* Development/production environments.
* Defaults.
* Secrets.
* Hardcoded configuration.

Busca:

if (process.env.NODE_ENV === ...)

repetido por toda la aplicación.

Evalúa si existe una estrategia centralizada de configuración.

⸻

24. TYPESCRIPT

Revisa:

* any.
* unknown.
* never.
* Type assertions.
* as.
* Non-null assertions !.
* Interfaces.
* Types.
* Generics.
* DTOs.
* Entities.
* Response types.
* Union types.
* Discriminated unions.

Busca tipos que oculten errores.

Ejemplo:

const data = response.data as User;

Determina si realmente existe garantía de que data sea User.

Califica la calidad del tipado.

⸻

25. ENTIDADES, DTOs Y MODELOS

Determina si existe una separación adecuada entre:

Database Entity
DTO
Domain Model
API Response

No asumas que siempre deben existir cuatro capas.

Evalúa si la arquitectura actual es suficiente para el proyecto.

Busca exposición directa de entidades:

return user;

cuando esto pueda exponer:

* password hash;
* internal IDs;
* secrets;
* internal fields;
* metadata sensible.

⸻

26. CLEAN CODE Y MANTENIBILIDAD

Busca:

* God Services.
* God Controllers.
* God Modules.
* Funciones demasiado largas.
* Código duplicado.
* Código muerto.
* Imports innecesarios.
* Magic numbers.
* Magic strings.
* Hardcoding.
* Nombres poco claros.
* Abstracciones innecesarias.
* Comentarios obsoletos.
* TODOs importantes.
* Complejidad ciclomática excesiva.

No recomiendes abstraer código solamente porque aparece dos veces.

Determina si la abstracción realmente mejora el mantenimiento.

⸻

27. SOLID Y PATRONES

Evalúa cuando realmente aplique:

* Single Responsibility.
* Open/Closed.
* Liskov Substitution.
* Interface Segregation.
* Dependency Inversion.
* DRY.
* Separation of Concerns.
* Composition.
* Repository Pattern.
* Service Layer.
* Strategy.
* Factory.
* Adapter.
* CQRS.

IMPORTANTE:

NO quiero que fuerces patrones.

Una arquitectura simple y clara es preferible a una arquitectura excesivamente compleja.

Si no existe una necesidad real para CQRS, Repository Pattern, Factory, etc., no lo recomiendes solamente porque “es buena práctica”.

⸻

28. TESTING

Revisa:

* Unit tests.
* Integration tests.
* E2E.
* Controller tests.
* Service tests.
* Repository tests.
* API tests.
* Authentication tests.
* Authorization tests.
* Error cases.
* Edge cases.
* Race conditions.
* Transactions.

Si no existen tests:

NO digas simplemente:

“Faltan tests.”

Determina:

1. Qué partes deberían tener tests.
2. Qué riesgo existe.
3. Qué tests tienen mayor prioridad.
4. Qué comportamiento crítico no está protegido.

Prioriza tests sobre:

* autenticación;
* autorización;
* lógica de negocio;
* transacciones;
* cálculos;
* estados;
* integraciones críticas.

⸻

29. E2E Y CONTRATOS DE API

Revisa si los endpoints críticos tienen cobertura E2E.

Analiza:

* Request.
* Authentication.
* Validation.
* Business logic.
* Database.
* Response.
* Error handling.

Si existe Swagger/OpenAPI:

Revisa:

* Documentación.
* DTOs.
* Responses.
* Status codes.
* Authentication.
* Examples.

Determina si la documentación realmente representa el comportamiento del backend.

⸻

30. PRODUCCIÓN

Determina si el backend está preparado para producción.

Revisa:

* Debug logs.
* Secrets.
* Environment configuration.
* CORS.
* Helmet.
* Rate limiting.
* Compression.
* Graceful shutdown.
* Health checks.
* Database connection handling.
* Process management.
* Docker.
* PM2.
* Memory limits.
* Error reporting.
* Monitoring.
* Security headers.
* API versioning.

⸻

31. GRACEFUL SHUTDOWN

Revisa si la aplicación maneja correctamente:

* SIGTERM.
* SIGINT.
* Database connections.
* HTTP connections.
* Workers.
* Queues.
* WebSockets.

Especialmente si utiliza:

* Docker.
* Kubernetes.
* ECS.
* EC2.
* PM2.
* Auto Scaling.

⸻

32. SCALABILIDAD

Pregunta para cada módulo:

“Si este módulo tuviera 10 veces más usuarios, requests y datos, ¿seguiría funcionando correctamente?”

Analiza:

* Database.
* Connections.
* Cache.
* API.
* Memory.
* CPU.
* Queues.
* External services.
* Pagination.
* Concurrency.

Distingue entre:

Problema actual

Ya existe evidencia de que el diseño genera un problema.

Riesgo de escalabilidad

Actualmente funciona, pero existe una limitación demostrable al crecer.

No inventes problemas hipotéticos sin justificar el escenario.

⸻

33. RED FLAGS

Identifica específicamente:

* 🔴 God Modules
* 🔴 God Services
* 🔴 God Controllers
* 🔴 Circular dependencies
* 🔴 SQL injection
* 🔴 Broken authorization
* 🔴 Sensitive data exposure
* 🟠 N+1 queries
* 🟠 Race conditions
* 🟠 Memory leaks
* 🟠 Event loop blocking
* 🟠 Missing transactions
* 🟠 Poor error handling
* 🟡 Excessive abstraction
* 🟡 Premature optimization
* 🟡 Code duplication
* 🟡 Hardcoded values
* 🟡 Excessive any

⸻

34. SEVERIDAD

Clasifica cada problema:

🔴 CRÍTICO

Puede causar:

* vulnerabilidad grave;
* pérdida de datos;
* corrupción de información;
* exposición de información sensible;
* caída importante del sistema;
* errores graves de producción.

🟠 ALTO

Problema importante que debería corregirse pronto.

🟡 MEDIO

Afecta:

* mantenibilidad;
* rendimiento;
* calidad;
* escalabilidad.

🔵 BAJO

Mejora menor.

🟢 OPCIONAL

Mejora de calidad no necesaria.

⸻

35. EVIDENCIA OBLIGATORIA

Cada problema confirmado debe incluir:

Problema:

Archivo:

Línea/sección:

Evidencia:

Impacto:

Por qué ocurre:

Escenario donde se manifiesta:

Solución recomendada:

Ejemplo de código:

Cuando sea necesario.

NO hagas afirmaciones como:

“Esto puede causar problemas de rendimiento.”

Debes explicar:

Qué operación genera el problema → por qué → bajo qué escenario → qué impacto produce.

⸻

36. RACE CONDITIONS

Cuando detectes una posible race condition debes demostrarla.

Utiliza este formato:

Request A
    ↓
Lee estado X
Request B
    ↓
Lee estado X
Request A
    ↓
Actualiza X
Request B
    ↓
Actualiza X

Después explica el resultado incorrecto.

No marques como race condition cualquier código asíncrono.

⸻

37. MANTENER / MEJORAR / REFACTORIZAR / ELIMINAR / AGREGAR

Para cada módulo crea:

Mantener

Qué está bien implementado.

Mejorar

Qué puede mejorarse sin una refactorización importante.

Refactorizar

Qué necesita un cambio estructural.

Eliminar

Qué código, abstracciones o complejidad deberían eliminarse.

Agregar

Qué funcionalidad técnica falta.

⸻

38. CALIFICACIÓN

Cada módulo debe recibir una calificación:

X / 10

Utiliza:

9 - 10

Excelente.

8 - 8.9

Muy bueno.

7 - 7.9

Bueno.

6 - 6.9

Aceptable.

5 - 5.9

Regular.

4 - 4.9

Deficiente.

1 - 3.9

Crítico.

NO seas generoso.

La nota debe estar respaldada por evidencia.

⸻

39. MATRIZ DE EVALUACIÓN

Para cada módulo:

Categoría	Nota
Arquitectura NestJS	X/10
Calidad de código	X/10
TypeScript	X/10
API Design	X/10
Seguridad	X/10
Autenticación	X/10
Autorización	X/10
Base de datos	X/10
Performance	X/10
Manejo de errores	X/10
Estado/consistencia	X/10
Servicios externos	X/10
Configuración	X/10
Logging/Observabilidad	X/10
Testing	X/10
Mantenibilidad	X/10
Escalabilidad	X/10

Después calcula una nota general del módulo y explica cómo llegaste a ella.

⸻

40. FORMATO DE AUDITORÍA POR MÓDULO

Utiliza exactamente esta estructura:

📦 MÓDULO: [Nombre]

🎯 Responsabilidad

Explica qué hace realmente el módulo según el código.

⭐ Calificación

X / 10

📊 Evaluación

Categoría	Nota
Arquitectura NestJS	X/10
Código	X/10
TypeScript	X/10
API	X/10
Seguridad	X/10
Auth	X/10
Base de datos	X/10
Performance	X/10
Errores	X/10
Testing	X/10
Mantenibilidad	X/10
Escalabilidad	X/10

✅ Lo que está bien

Lista únicamente fortalezas reales encontradas.

🔴 Problemas críticos

Problemas confirmados.

🟠 Problemas importantes

Problemas de alta prioridad.

🟡 Mejoras recomendadas

Problemas de prioridad media.

🔵 Mejoras menores

Problemas de baja prioridad.

🔍 Hallazgos técnicos

Para cada hallazgo:

Problema:

Tipo: Problema confirmado / Riesgo potencial / Recomendación

Severidad:

Archivo:

Ubicación:

Evidencia:

Impacto:

Por qué ocurre:

Escenario:

Solución recomendada:

Ejemplo de código:

⸻

🏗️ Arquitectura recomendada

Explica cómo debería quedar el módulo después de una posible refactorización.

NO escribas código de refactorización completo todavía.

Primero explica la arquitectura propuesta.

⸻

📋 Plan de acción

Ordena las tareas:

1. …
2. …
3. …
4. …

⸻

41. PRIORIDADES

Al finalizar cada módulo:

P0 — Crítico

Debe solucionarse inmediatamente.

P1 — Alto

Debe solucionarse antes de continuar agregando funcionalidades importantes.

P2 — Medio

Debe planificarse.

P3 — Bajo

Mejora opcional.

⸻

42. NO REFACTORIZAR DURANTE LA AUDITORÍA

IMPORTANTE:

NO cambies código.

NO escribas commits.

NO generes parches.

NO refactorices automáticamente.

Primero realiza el diagnóstico completo.

Quiero saber:

1. Qué está mal.
2. Por qué está mal.
3. Qué impacto tiene.
4. Qué tan urgente es.
5. Cómo debería solucionarse.

Después de terminar toda la auditoría puedes crear el plan de refactorización.

⸻

43. RESUMEN GLOBAL

Después de revisar TODOS los módulos:

📊 RESUMEN GENERAL

Módulo	Nota	Críticos	Altos	Medios
Auth	X/10	X	X	X
Users	X/10	X	X	X
…	…	…	…	…

NO ordenes los módulos de mejor a peor.

Respeta el orden original de la aplicación.

⸻

44. PROBLEMAS TRANSVERSALES

Identifica problemas que afecten varios módulos:

Arquitectura

Seguridad

Autenticación

Autorización

Base de datos

API

Performance

Manejo de errores

Configuración

Logging

Observabilidad

Testing

Tipado

Dependencias

⸻

45. DEUDA TÉCNICA

Clasifica:

🔴 Deuda crítica

Debe solucionarse.

🟠 Deuda importante

Debería solucionarse antes de continuar agregando funcionalidades.

🟡 Deuda moderada

Puede planificarse.

🔵 Deuda menor

Mejoras futuras.

Para cada deuda explica:

* origen;
* impacto;
* riesgo;
* costo aproximado de solución;
* prioridad.

⸻

46. PLAN DE REFACTORIZACIÓN GLOBAL

Finalmente genera:

Fase 1 — Seguridad y estabilidad

Problemas de seguridad, crashes, pérdida/corrupción de datos y problemas críticos.

Fase 2 — Bugs y problemas P0/P1

Corregir comportamiento incorrecto.

Fase 3 — Arquitectura

Resolver problemas estructurales.

Fase 4 — Performance y escalabilidad

Optimizar únicamente problemas demostrados o riesgos claramente justificables.

Fase 5 — Testing

Agregar cobertura a los comportamientos críticos.

Fase 6 — Mantenibilidad

Limpieza, reducción de deuda técnica y mejoras estructurales.

⸻

47. REGLAS FINALES

1. No hagas una revisión superficial.
2. Analiza módulo por módulo.
3. Lee todos los archivos relacionados antes de emitir conclusiones.
4. No inventes problemas.
5. No inventes funcionalidades.
6. No supongas que una decisión arquitectónica es incorrecta.
7. Diferencia bugs reales de recomendaciones.
8. Prioriza problemas reales sobre preferencias personales.
9. No hagas refactorizaciones innecesarias.
10. No fuerces patrones de diseño.
11. No recomiendes microservicios solamente porque la aplicación pueda crecer.
12. No recomiendes CQRS sin una necesidad real.
13. No recomiendes Repository Pattern por defecto.
14. No recomiendes cache sin justificar el problema que resuelve.
15. No recomiendes optimizaciones prematuras.
16. Considera seguridad como una prioridad.
17. Considera concurrencia y consistencia de datos.
18. Considera el comportamiento en producción.
19. Siempre proporciona evidencia en el código.
20. Si encuentras una buena implementación, indícala.
21. No cambies código durante la auditoría.
22. Primero termina el diagnóstico.
23. Después genera el roadmap de refactorización.
24. Si algo no puede comprobarse, dilo explícitamente.
25. No confundas “no ideal” con “incorrecto”.

⸻

48. CRITERIO FINAL

Quiero que pienses como un:

Senior Backend Engineer + Tech Lead + Software Architect revisando un Pull Request de un sistema empresarial que deberá mantenerse durante años.

No como un linter.

No como un profesor buscando errores académicos.

No como alguien intentando encontrar la mayor cantidad de problemas posibles.

El objetivo es encontrar los problemas técnicos reales que tengan impacto, demostrar por qué existen, determinar su severidad y explicar qué debería hacerse.

Una implementación sencilla y correcta debe recibir reconocimiento aunque no utilice patrones sofisticados.

Una implementación compleja debe ser cuestionada si esa complejidad no está justificada.

⸻

49. ENTREGABLES

Al finalizar la auditoría debes generar:

1. Auditoría completa

La revisión detallada módulo por módulo.

2. Resumen general

Con las calificaciones y cantidad de problemas.

3. Problemas transversales

Problemas que afectan varios módulos.

4. Deuda técnica

Clasificada por prioridad.

5. Roadmap de refactorización

Organizado por fases.

6. Documentación

La auditoría debe quedar organizada de forma que pueda convertirse en documentación técnica del proyecto.

Si existe una estructura de documentación como:

docs/
├── guide/
└── revisiones/

utilízala de la siguiente manera:

docs/guide/

Para documentación técnica y guías del backend.

docs/revisiones/

Para las auditorías, revisiones por módulo, hallazgos y planes de mejora.

NO mezcles documentación general del proyecto con resultados específicos de auditoría.

⸻

🎯 OBJETIVO FINAL

El resultado debe permitir responder con claridad:

¿Qué tan sólido está realmente este backend?

¿Qué problemas reales tiene?

¿Cuáles son críticos?

¿Qué debería corregirse primero?

¿Qué partes están bien construidas y deben conservarse?

¿Qué deuda técnica existe?

¿Qué tendría que cambiarse para llevar el backend a un nivel Senior/producción?

Y cada conclusión debe estar respaldada por evidencia real encontrada en el código.