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