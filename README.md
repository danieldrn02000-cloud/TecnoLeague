# TecnoLeague

TecnoLeague es una tienda web de productos de tecnología y accesorios gamer. El
proyecto integra catálogo, carrito, cuentas de usuario, pagos, pedidos, inventario
y un panel administrativo dentro de una misma aplicación.

Su objetivo es cubrir el recorrido de una compra: consultar productos, preparar
el carrito, autenticar al cliente, verificar el pago en el servidor, registrar el
pedido, enviar una confirmación por correo y consultar los datos de entrega.

Los importes se manejan en pesos mexicanos (MXN). El catálogo de preparación
incluye datos y fotografías de demostración; para una tienda comercial se deben
revisar los productos, precios y derechos de uso de las imágenes.

## Funcionalidades

### Clientes

- Consultar productos y categorías, buscar y revisar sus características.
- Aprender conceptos básicos de hardware y consolas en la [guía gamer para principiantes](https://tecnoleague.netlify.app/guia-gamer).
- Agregar uno o varios artículos al carrito y modificar cantidades.
- Registrarse e iniciar sesión con correo y contraseña.
- Continuar con Google cuando la integración está configurada.
- Recuperar la contraseña mediante un código de seis dígitos enviado por correo.
- Pagar con tarjeta mediante Mercado Pago dentro de la tienda.
- Pagar mediante PayPal con redirección para autorizar la compra.
- Consultar pedidos, su folio y los datos de seguimiento disponibles.
- Recibir un correo de confirmación por cada pedido nuevo.

### Administración

- Administrar productos y categorías.
- Subir imágenes JPG/JPEG, PNG, AVIF, WebP, GIF y TIFF.
- Consultar existencias y registrar movimientos de inventario.
- Consultar ventas, pedidos y actividad reciente.
- Actualizar estados de pedidos conforme a las reglas del backend.
- Registrar una guía de envío y consultar su información mediante 17TRACK.
- Recibir eventos en vivo para actualizar las vistas del BackOffice.

Los permisos se verifican en NestJS. La interfaz administrativa está asociada al
rol `ADMIN`; las cuentas nuevas de clientes reciben el rol `CLIENTE`.

## Tecnologías utilizadas

| Área | Tecnologías y función |
| --- | --- |
| Lenguaje | TypeScript para frontend y backend; JavaScript para scripts auxiliares. |
| Frontend | Astro 7 para páginas y rutas de servidor; React 19 para la interfaz interactiva. |
| Estilos | Tailwind CSS 4, CSS del proyecto e iconos Lucide. |
| Construcción del frontend | Vite y el adaptador `@astrojs/netlify`. |
| Backend | Node.js 22.12 o posterior, NestJS 12 y Express. |
| API propia | GraphQL, Apollo Server y resolvers de NestJS. |
| Actualizaciones en vivo | WebSocket, `graphql-ws` y `graphql-subscriptions`. |
| Persistencia | PostgreSQL y Prisma ORM 6, con migraciones versionadas. |
| Autenticación | JWT propios, cookies `HttpOnly`, hashes de contraseña con `scrypt` y Google Identity Services. |
| Imágenes | Sharp para comprobar, redimensionar y volver a codificar archivos. |
| Correo | API de Resend para recuperación de contraseña y confirmaciones de pedido. |
| Pruebas | Node Test Runner, Vitest y React Testing Library. |
| Calidad | ESLint, comprobación de tipos y `astro check`. |
| Automatización | GitHub Actions para CI/CD. |
| Alojamiento | Netlify para Astro y sus Functions; Render para NestJS; PostgreSQL local o un proveedor como Neon. |

### Integraciones externas

| Servicio | Uso dentro de TecnoLeague |
| --- | --- |
| Mercado Pago | Tokenizar tarjetas, procesar órdenes y verificar resultados de pago. |
| PayPal | Crear órdenes, obtener autorización y capturar pagos. |
| Google Identity Services | Autenticar una cuenta de Google para iniciar una sesión propia de la tienda. |
| Resend | Enviar los correos de recuperación y de confirmación de pedidos. |
| 17TRACK | Registrar números de guía existentes y consultar información de rastreo. |

17TRACK consulta el seguimiento de una guía; la integración no compra un envío ni
genera por sí misma una etiqueta de paquetería.

## Arquitectura

El repositorio utiliza npm workspaces para organizar dos aplicaciones:

- `front`: frontend Astro y React, junto con las rutas de servidor de Astro.
- `back`: API NestJS, reglas de negocio, integración con proveedores y acceso a datos.

Astro funciona como intermediario entre el navegador y NestJS para las consultas
HTTP y la autenticación. Este patrón permite mantener el token de sesión en una
cookie protegida y agregar las credenciales necesarias desde el servidor web.

```mermaid
flowchart LR
  Cliente[Cliente o administrador] --> Front[Astro + React en Netlify]
  Front --> Rutas[Rutas Astro: /api/auth y /api/graphql]
  Rutas --> Nest[NestJS + GraphQL en Render]
  Nest --> Prisma[Prisma ORM]
  Prisma --> DB[(PostgreSQL)]
  Nest --> MP[Mercado Pago]
  Nest --> PP[PayPal]
  Nest --> Google[Verificación de identidad Google]
  Nest --> Tracking[17TRACK]
  Nest --> Archivos[Disco persistente de imágenes]
  Nest --> Cola[(correos_pedido)]
  Worker[CorreoPedidoService] --> Cola
  Worker --> Resend[Resend]
  Front -->|WebSocket con ticket temporal| Nest
```

### Autenticación y sesiones

Los formularios llaman a las rutas `/api/auth/*` del mismo origen del frontend.
Astro solicita la autenticación a NestJS usando el puente privado configurado con
`AUTH_BRIDGE_SECRET`. NestJS emite un JWT de TecnoLeague y Astro lo guarda en la
cookie `tl_session`, con `HttpOnly`, `SameSite=Lax` y `Secure` cuando se usa HTTPS.

El JSON que recibe React no incluye ese JWT. En las llamadas posteriores, Astro
lee la cookie y agrega el encabezado de autorización hacia NestJS.

Con Google se recibe primero una credencial de identidad del proveedor. El
backend verifica su firma, destinatario, emisor, vigencia y nonce. Después crea o
identifica al usuario local y genera la misma clase de sesión de TecnoLeague.
Vincular una cuenta existente por coincidencia de correo requiere confirmar su
contraseña local.

### GraphQL y reglas de negocio

`back/src/schema.graphql` define las consultas, mutaciones y tipos públicos.
Los resolvers reciben las operaciones y delegan en servicios como `TiendaService`,
`PagosService`, `AdminService` y `AuthService`.

El backend calcula los importes y comprueba existencias, permisos y resultados de
los proveedores. La base registra usuarios, productos, categorías, pedidos,
detalles, pagos, intentos de compra y movimientos de inventario.

### Actualizaciones en vivo

El panel solicita un ticket administrativo de corta duración a Astro y lo usa
para abrir una suscripción WebSocket. En producción la conexión va directamente
al backend público de NestJS. En desarrollo puede utilizar el proxy de Vite.

Los servicios publican eventos después de confirmar las operaciones. El cliente
agrupa eventos relacionados y vuelve a consultar las vistas afectadas. La
implementación de publicación/suscripción utiliza memoria del proceso NestJS.

## Estructura principal

```text
TecnoLeague/
├── .github/workflows/ci-cd.yml    # Validación y despliegue
├── back/
│   ├── prisma/
│   │   ├── schema.prisma         # Modelo de datos
│   │   ├── migrations/           # Cambios versionados de la base
│   │   └── seed.ts              # Catálogo y administrador de desarrollo
│   └── src/
│       ├── schema.graphql       # Contrato de la API
│       ├── auth.service.ts      # Cuentas y sesiones
│       ├── tienda.service.ts    # Catálogo y pedidos
│       ├── pagos.service.ts     # Reservas y confirmación de pagos
│       ├── admin.service.ts     # Operaciones administrativas
│       ├── imagenes.controller.ts
│       └── correo-pedido.service.ts
├── front/
│   ├── public/                  # Archivos estáticos
│   └── src/
│       ├── pages/               # Páginas y endpoints Astro
│       ├── components/          # Componentes React
│       ├── screens/             # Catálogo, checkout, pedidos y administración
│       └── lib/                 # Integraciones y utilidades
├── docs/                        # Guías de configuración
├── scripts/                     # Automatización y diagnóstico
├── netlify.toml
└── package.json                 # Workspaces y comandos generales
```

## Instalación y ejecución local

### Requisitos

- Node.js 22.12 o posterior y npm.
- Una base PostgreSQL disponible para desarrollo.
- Credenciales de los servicios externos que se quieran utilizar.

Desde la raíz del repositorio:

```bash
npm ci
npm run setup
```

`setup` crea `front/.env` y `back/.env` a partir de sus ejemplos si todavía no
existen. Conserva los archivos existentes.

Configura como mínimo:

| Archivo | Variables |
| --- | --- |
| `back/.env` | `DATABASE_URL`, `JWT_SECRET` y `AUTH_BRIDGE_SECRET`. |
| `front/.env` | `BACKEND_GRAPHQL_URL` y el mismo `AUTH_BRIDGE_SECRET` del backend. |

La base indicada por `DATABASE_URL` debe existir. Para desarrollo, la dirección de
NestJS normalmente es `http://127.0.0.1:4000/graphql`.

Después ejecuta:

```bash
npm run db:generate
npm run db:migrate
npm run db:seed
npm run dev
```

El frontend se abre en `http://localhost:5173` y GraphQL en
`http://localhost:4000/graphql`.

El seed prepara datos de demostración. Para crear un administrador de desarrollo,
configura `ADMIN_EMAIL`, `ADMIN_PASSWORD` y, opcionalmente, `ADMIN_NAME` antes de
ejecutarlo. El seed no convierte una cuenta cliente existente en administradora.

### Variables para funcionalidades opcionales

| Funcionalidad | Configuración |
| --- | --- |
| Google | `PUBLIC_GOOGLE_CLIENT_ID` en el frontend y `GOOGLE_CLIENT_ID` en el backend, con el mismo Client ID. |
| Mercado Pago | Credenciales y webhook del backend según [Orders API](docs/ORDERS_API.md), y `PUBLIC_MP_PUBLIC_KEY` en el frontend. |
| PayPal | `PAYPAL_ENV`, `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `PAYPAL_MERCHANT_ID` y `PAYPAL_RETURN_BASE_URL` en el backend. |
| Recuperación por correo | `RESEND_API_KEY` y `PASSWORD_RESET_FROM` en el backend. |
| Confirmación de pedidos | Las mismas credenciales de Resend; `ORDER_EMAIL_FROM` permite elegir otro remitente verificado. |
| Enlace de la tienda en correos | `PUBLIC_SITE_URL` con el origen HTTPS del frontend. |
| Rastreo | `TRACK17_API_KEY` en el backend. |
| Imágenes subidas | `CLOUDINARY_URL` en el backend para subir a Cloudinary. `IMAGE_UPLOAD_DIR` para los archivos locales. |

Los valores del backend y los secretos del servidor Astro se configuran en sus
respectivos entornos. Las variables `PUBLIC_*` del frontend quedan disponibles
para el navegador y no deben contener contraseñas o claves privadas.

## Uso y funcionamiento

La opción **¿Eres nuevo en el mundo gamer?**, junto a **Pedidos**, abre la página
pública `/guia-gamer`. Explica componentes, RAM y DDR, almacenamiento, tarjetas
gráficas, marcas, consolas y criterios para elegir equipo. No requiere iniciar sesión.

### Recorrido de una compra

1. El cliente consulta el catálogo y agrega productos al carrito.
2. Inicia sesión para continuar con la compra.
3. Completa los datos de contacto y dirección de entrega.
4. El backend comprueba el carrito, calcula el total y prepara la reserva de stock.
5. Se procesa el método de pago seleccionado.
6. El backend verifica el resultado con el proveedor antes de registrar el pedido pagado.
7. La creación del pedido también registra su confirmación de correo en la cola.
8. El cliente consulta el resultado y posteriormente el estado en **Mis pedidos**.

Mercado Pago usa campos seguros del SDK para tokenizar la tarjeta; el número
completo y el código de seguridad no se envían al backend de TecnoLeague. Si el
proveedor exige autenticación bancaria adicional, el flujo debe atenderla.

PayPal redirige al cliente para obtener autorización. Al regresar, NestJS verifica
y captura la orden. La autorización o el simple regreso a una URL no prueban que
el dinero haya sido capturado.

Las claves de idempotencia y los registros de operaciones permiten recuperar
resultados inciertos sin tratar cada consulta como un cobro nuevo. El backend
también conserva la creación de pedidos con pago al recibir.

### Productos e inventario

El administrador crea productos, asigna una categoría y puede subir una imagen.
El backend verifica el archivo real, limita su tamaño a 5 MB y su entrada a 40
megapíxeles, y reduce sus dimensiones cuando corresponde.

JPG y PNG se vuelven a codificar en sus formatos de salida. AVIF, WebP, GIF y TIFF
se normalizan a WebP. En archivos animados o con varias páginas se usa la primera
imagen. En producción, al elegir un archivo con **Añadir imagen**, el backend lo
sube a Cloudinary y rellena el campo **Imagen** con su URL pública HTTPS. Al guardar
el producto, esa referencia queda en `productos.imagen`. En desarrollo, si no se
configura Cloudinary, las subidas se guardan en `back/uploads` o `IMAGE_UPLOAD_DIR`.

El inventario registra entradas, salidas, ajustes, reservas y liberaciones. El
mínimo de existencias ya fue retirado de la tabla de productos y de la interfaz;
se muestran productos disponibles y agotados.

### Envíos

El administrador registra el número de guía y la información de la paquetería.
La integración de 17TRACK permite consultar su seguimiento y guardar la
información que se muestra al cliente.

El folio interno del pedido, como `TL-2026-0042`, es diferente del número de guía
que entrega la paquetería. El correo inicial indica **Por asignar** si todavía no
existen los datos de rastreo.

## Despliegue

### Backend en Render

Con el directorio de trabajo en la raíz del repositorio:

```text
Build Command:
npm ci && npm run db:generate && npm run build -w back

Start Command:
npm run db:migrate && npm run start -w back
```

Las variables del backend se configuran en Render. PostgreSQL puede alojarse en
Neon u otro servicio compatible.

Para habilitar las subidas, abre **Cloudinary → Settings → API Keys** y copia
el **API Environment Variable** del entorno de producto. En **Render → servicio
del backend → Environment**, crea `CLOUDINARY_URL` con el valor
`cloudinary://API_KEY:API_SECRET@CLOUD_NAME`. Usa solo el valor de la variable y
guarda los cambios con un despliegue. La autenticación de la subida se realiza en
NestJS con las claves de Cloudinary. Mantén esa variable únicamente en el backend.

Las referencias existentes conservan su URL. Las imágenes antiguas que apuntan
a `/images/uploads/` dependen de los archivos en `IMAGE_UPLOAD_DIR` o `back/uploads`.
Para alojarlas en Cloudinary, vuelve a subirlas y guarda el producto.

### Frontend en Netlify

La configuración del repositorio establece:

```toml
[build]
  base = "."
  command = "npm run build -w front"
  publish = "front/dist"
  ignore = "exit 0"

[build.environment]
  NODE_VERSION = "22"
```

La base es la raíz del repositorio. Al publicar con el CLI se selecciona el
workspace `@tecnoleague/front`, de manera que las Functions del adaptador se
encuentren en `front/.netlify/v1/functions`.

Netlify debe tener `BACKEND_GRAPHQL_URL` apuntando al NestJS público de Render y
el `AUTH_BRIDGE_SECRET` correspondiente. Las variables necesarias para compilar
deben estar disponibles para **Builds**, y las que se leen en ejecución, para
**Functions**.

### CI/CD con GitHub Actions

El workflow valida pull requests y cambios de `main`. Incluye ESLint, comprobación
de Prisma, PostgreSQL desechable, pruebas automatizadas y builds.

Si la validación pasa, la ejecución es de `main` y `CD_ENABLED=true`, publica el
SHA validado en Render, espera su estado activo y luego construye/publica Netlify.
Una comprobación final consulta la página y el catálogo mediante `/api/graphql`.

Configura en GitHub:

| Tipo | Nombres |
| --- | --- |
| Secrets | `RENDER_API_KEY`, `NETLIFY_AUTH_TOKEN`. |
| Variables del repositorio | `RENDER_SERVICE_ID`, `NETLIFY_SITE_ID`, `PRODUCTION_SITE_URL`, `CD_ENABLED`. |

`ignore = "exit 0"` omite los builds automáticos de Netlify disparados por Git.
El despliegue se realiza con el CLI desde Actions. Render también debe tener
desactivado su Auto-Deploy para que la publicación pase por CI.

La configuración completa está en [docs/CI_CD.md](docs/CI_CD.md). El proceso no
realiza una reversión automática de la base de datos o de ambos proveedores si
falla una publicación parcial.

## Comandos habituales

| Comando | Función |
| --- | --- |
| `npm run dev` | Inicia frontend y backend de desarrollo. |
| `npm run build` | Construye ambos proyectos. |
| `npm run lint` | Ejecuta ESLint. |
| `npm run db:generate` | Genera el cliente Prisma. |
| `npm run db:migrate` | Aplica migraciones pendientes. |
| `npm run db:seed` | Prepara datos de desarrollo. |
| `npm run db:studio` | Abre Prisma Studio. |
| `npm run test:front` | Ejecuta las pruebas del frontend. |
| `npm run test:auth` | Comprueba autenticación y recuperación. |
| `npm run test:orders` | Comprueba Mercado Pago Orders. |
| `npm run test:paypal` | Comprueba PayPal. |
| `npm run test:backoffice` | Comprueba la integración del BackOffice. |

Las pruebas de integración que necesitan PostgreSQL requieren preparar una base
de pruebas. El workflow configura una base temporal y simula los proveedores
externos para evitar cobros o correos reales.

## Documentación adicional

- [Configuración y funcionamiento de Google](docs/GOOGLE_IDENTITY.md).
- [Checkout API con Mercado Pago Orders](docs/ORDERS_API.md).
- [Checkout de PayPal y Sandbox](docs/PAYPAL_CHECKOUT.md).
- [Recuperación de contraseña](docs/RECUPERACION_PASSWORD.md).
- [Confirmaciones de pedido por correo](docs/PEDIDOS_CORREO.md).
- [CI/CD, credenciales de publicación y despliegue](docs/CI_CD.md).
- [Fuentes de las fotografías del catálogo](docs/IMAGENES.md).
