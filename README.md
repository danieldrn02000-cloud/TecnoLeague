# TecnoLeague: desarrollo local y en la red

Requiere Node.js 22.12 o posterior, npm y PostgreSQL (local o Neon). Ejecuta los comandos desde la raíz del repositorio.

```bash
npm ci
npm run setup
```

Configura `back/.env` con tu `DATABASE_URL`, `JWT_SECRET` y `AUTH_BRIDGE_SECRET`. En `front/.env`, configura `BACKEND_GRAPHQL_URL=http://127.0.0.1:4000/graphql` y el mismo `AUTH_BRIDGE_SECRET`. La URL de Neon pertenece exclusivamente a `back/.env`; nunca debe llevar prefijos `PUBLIC_` ni llegar al navegador.

```bash
npm run db:generate
npm run db:migrate
# Solo para preparar un catálogo de desarrollo y la cuenta ADMIN_EMAIL/ADMIN_PASSWORD:
npm run db:seed
npm run dev
```

## Usar otra computadora de la misma red

Ejecuta ambos servicios en la laptop. En la laptop puedes entrar por `http://localhost:5173`; en la otra computadora, escribe `http://IP_DE_TU_LAPTOP:5173`. Consulta la IPv4 de la laptop con `ipconfig` en Windows o `ip addr` en Linux. Ambos equipos deben estar en la misma red, sin aislamiento entre clientes, y el firewall de la laptop debe permitir TCP 5173 en la red privada.

Astro escucha en todas las interfaces. Las consultas, las imágenes y las actualizaciones WebSocket pasan por el puerto 5173. Deja `PUBLIC_BACKOFFICE_WS_URL` vacía o sin definir en `front/.env` durante el desarrollo: así cada navegador usa el mismo origen desde el que abrió la tienda. No pongas `localhost`, la dirección de Neon ni la IP de la segunda computadora en esa variable.

`BACKEND_GRAPHQL_URL` sigue apuntando a NestJS desde la laptop, normalmente `http://127.0.0.1:4000/graphql`. Reinicia `npm run dev` tras cambiar los archivos `.env`. Cada dirección tiene sus propias cookies: inicia sesión en la dirección que estés utilizando.

En producción, configura `PUBLIC_BACKOFFICE_WS_URL=wss://TU_BACKEND/graphql`. El backend debe admitir conexiones persistentes y el proxy de despliegue debe permitir WebSocket. El proxy de desarrollo de Astro no se publica como proxy WebSocket en Netlify.

## Añadir imágenes

En **Administración → Productos → Nuevo producto / Editar producto**, pulsa **Añadir imagen** y selecciona un archivo `.jpg`, `.jpeg` o `.png` de hasta 5 MB. Espera a que termine la subida y guarda el producto. También puedes conservar una ruta `/images/archivo` o una URL HTTPS.

Solo una sesión ADMIN puede subir archivos. El backend comprueba el formato real, limita la imagen a 40 megapíxeles de entrada, la vuelve a codificar, elimina metadatos y guarda un nombre aleatorio. Las imágenes se sirven mediante Astro y son visibles desde ambos equipos.

Por defecto se guardan en `back/uploads/`, que Git ignora. No borres esa carpeta y respáldala junto con la base de datos. Puedes definir `IMAGE_UPLOAD_DIR` en el backend para utilizar otro directorio persistente. En Render u otro alojamiento con disco efímero debes montar almacenamiento persistente y configurar esa variable; Neon guarda las rutas, no los archivos. Varias instancias del backend necesitan compartir el almacenamiento. Una imagen subida cuyo formulario se cancela puede quedar sin asociar a un producto.

## Categorías, productos y contadores de IDs

Un `P2002` de PostgreSQL puede indicar un ID repetido, aunque el nombre sea nuevo. Esto ocurre al importar filas con IDs explícitos sin adelantar sus secuencias. Ahora se distingue el nombre duplicado del contador desincronizado y de los errores de conexión o estructura.

La migración `202610220001_reparar_secuencias` corrige los contadores existentes. Si importas más datos después, vuelve a sincronizarlos:

```bash
npm run db:repair-sequences
```

La reparación no borra registros, no cambia IDs y nunca retrocede los contadores. Requiere que las migraciones estén aplicadas y que el usuario de PostgreSQL tenga permisos sobre las tablas y secuencias. Puede bloquear brevemente escrituras mientras sincroniza. El seed también utiliza esta reparación.

Para Neon, usa su cadena PostgreSQL con TLS (`sslmode=require`). Antes de migrar una base compartida, revisa el destino y conserva un respaldo; para las migraciones utiliza la conexión directa indicada por Neon si la conexión agrupada no permite la operación. Si Prisma informa que una base existente necesita establecer una línea base de migraciones, revisa ese estado antes de continuar: no ejecutes `migrate reset` sobre tus datos.

## Actualizaciones en vivo

Neon es el servidor de base de datos. El navegador se conecta por WebSocket a **NestJS**, que publica los eventos. Un fallo de Neon puede impedir validar el usuario o emitir el ticket; un WebSocket dirigido a `127.0.0.1` desde la segunda computadora falla incluso si Neon funciona.

El panel muestra errores de configuración, sesión y conexión y permite **Reconectar**. Si persiste el error, revisa la petición `POST /api/admin/subscription-ticket`, el WebSocket `/api/backoffice-ws` en desarrollo y los logs del backend. La conexión administrativa utiliza un ticket breve; el JWT de sesión permanece en una cookie HttpOnly.

Cada intento obtiene un ticket **antes de abrir el WebSocket**, también al reconectar. Así una consulta lenta a PostgreSQL, el arranque de Neon o la compilación inicial de Astro no consume el plazo de autenticación del socket. NestJS espera explícitamente 10 segundos para el mensaje inicial y el cliente espera 10 segundos para su confirmación. Los fallos temporales de red o del ticket se reintentan hasta cinco veces con espera progresiva; las sesiones inválidas y los permisos insuficientes se detienen.

Los logs `[BackOffice]` del navegador y de Astro y el logger `BackOffice` de NestJS comparten un identificador `requestId`, que también aparece junto al error del panel. Registra las etapas del ticket, su estado HTTP y duración, los códigos de cierre WebSocket y los errores de validación. No se imprimen JWT, tickets, cookies ni cadenas de conexión. Un rechazo de origen se distingue de una cuenta sin permisos; los fallos de PostgreSQL se distinguen de una sesión inválida.

Ejemplos de diagnóstico: `4408` significa que NestJS no recibió a tiempo la autenticación inicial; `4504`, que el cliente no recibió confirmación; `1006`, una interrupción sin cierre normal. `DATABASE_UNAVAILABLE` indica que el backend no pudo consultar al usuario; `BACKEND_UNREACHABLE`, que Astro no pudo contactar a NestJS. Comparte el identificador y el código, sin copiar el contenido del ticket.

Los eventos se mantienen en memoria en una sola instancia NestJS. Si despliegas varias instancias, necesitas un canal de eventos compartido antes de garantizar notificaciones entre ellas.

## Verificación

```bash
npm run lint
npm run build
npm run test:front
npm run test:checkout
# Sobre una base de desarrollo migrada y con seed; modifica datos de prueba:
npm run test:subscriptions
# Recorrido del hook React → ticket Astro → proxy → NestJS → PostgreSQL local:
npm run test:backoffice
```

Las pruebas nuevas de imágenes ejercitan HTTP, JWT, permisos, decodificación, disco y reinicio del servidor; simulan la consulta del usuario a la base de datos. Las pruebas del frontend simulan el transporte y comprueban la selección de archivos, errores, agrupación de eventos, reconexión y limpieza. La prueba existente del BackOffice usa PostgreSQL real y Mercado Pago simulado.

`test:backoffice` requiere PostgreSQL **local**, migraciones aplicadas y una cuenta administradora preparada por el seed. Abre servicios de prueba en puertos libres, usa el handler real de Astro, WebSocket real, los guards y resolvers de NestJS y Prisma real. Comprueba un ticket más lento que el plazo de inicio del socket, entrega de eventos, reconexión con otro ticket, cierre al abandonar el panel y rechazo sin sesión o sin rol ADMIN. También comprueba que un fallo simulado de Prisma devuelva un diagnóstico sin filtrar credenciales. `@types/jsdom` se utiliza únicamente para los tipos del navegador simulado en esa prueba.

Para una comprobación manual, abre el administrador en ambos equipos. Crea una categoría con nombre nuevo y un producto con una imagen subida en uno; comprueba que el otro recibe el evento y muestra la imagen sin recargar. Interrumpe y recupera el backend y verifica la reconexión y la conservación de formularios en edición.
