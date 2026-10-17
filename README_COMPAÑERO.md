

# Parte 2 — Full BackOffice con GraphQL Subscriptions

## Instrucciones para el asistente de IA

Implementa la conexión del BackOffice existente con las subscriptions administrativas del backend.

Antes de editar, inspecciona el checkout actual y conserva los cambios del equipo. **No reconstruyas el dashboard ni sustituyas el checkout corregido.** Explica el motivo de cada archivo creado o actualizado.

Completa implementación, pruebas y documentación. No te limites a proponer un plan.

## 1. Estado recibido

La primera parte ya implementó:

- Servicio central de eventos con PubSub en memoria.
- Subscription `backOfficeActualizado`, protegida para administradores.
- Publicaciones de productos, categorías, pedidos, inventario y pagos.
- Publicación después de confirmar las escrituras.
- Pruebas unitarias y de integración.

El autor reporta que las pruebas pasan en su computadora después de sincronizar las secuencias de PostgreSQL.

Ya existen estos módulos administrativos:

- Dashboard.
- Productos.
- Pedidos.
- Inventario.
- Clientes.
- Pagos.
- Categorías.

**Tu objetivo es actualizar sus datos sin recargar la página cuando otra sesión modifica información**, conservando filtros, periodos, paginación, modales y formularios en edición.

Antes de comenzar, ejecuta las pruebas recibidas sobre una base de desarrollo para establecer el estado inicial.

## 2. Archivos que debes inspeccionar

Backend:

```text
back/src/schema.graphql
back/src/app.module.ts
back/src/eventos.service.ts
back/src/backoffice-subscription.resolver.ts
back/src/auth.service.ts
back/src/auth.guard.ts
back/src/roles.guard.ts
back/src/tienda.service.ts
back/src/admin.service.ts
back/src/pagos.service.ts
```

Comprueba los nombres reales: algunas ramas pueden utilizar un nombre ligeramente distinto para el resolver de subscriptions.

Frontend:

```text
front/src/screens/Admin.tsx
front/src/api.ts
front/src/lib/server/graphql.ts
front/src/pages/api/graphql.ts
front/src/pages/api/auth/logout.ts
front/src/App.tsx
front/src/types.ts
front/src/store.tsx
front/src/lib/checkout.ts
front/src/lib/verificar-checkout.ts
```

Pruebas:

```text
back/test/backoffice.test.cjs
back/test/eventos-compilado.test.cjs
scripts/test-api.mjs
scripts/test-checkout-recuperacion.cjs
```

## 3. Contrato existente de eventos

Endpoint local:

```text
ws://127.0.0.1:4000/graphql
```

Biblioteca de transporte: `graphql-ws`.

Nombre del subprotocolo WebSocket:

```text
graphql-transport-ws
```

Operación:

```graphql
subscription BackOfficeEnVivo {
  backOfficeActualizado {
    eventoId
    entidad
    entidadId
    accion
    ocurridoEn
  }
}
```

Entidades:

```text
PEDIDO
PRODUCTO
INVENTARIO
CATEGORIA
PAGO
```

Acciones:

```text
CREADO
ACTUALIZADO
DESACTIVADO
ELIMINADO
```

Interpretación de identificadores:

- `INVENTARIO.entidadId` identifica un **producto**.
- `PAGO.entidadId` identifica un **pago**.
- Los intentos de compra tienen UUID; no confundirlos con los IDs enteros de pedidos.

Los eventos **avisan qué cambió**. El frontend debe volver a consultar los datos mediante las queries existentes.

No calcular ventas sumando notificaciones ni inventar otra API para reemplazar las consultas actuales.

PubSub es en memoria y está limitado a una instancia:

- No conserva historial.
- No reproduce eventos perdidos.
- No garantiza entrega.
- No comparte publicaciones entre procesos.

Por ello, consultar los datos al entrar al panel y al reconectar es obligatorio.

## 4. Implementar la autenticación del navegador

### Problema que debes resolver

La sesión está en la cookie `HttpOnly`:

```text
tl_session
```

React no puede leer esa cookie.

Los scripts Node de prueba utilizan un JWT para autenticarse, pero **no debes exponer el JWT original al navegador**, devolverlo en JSON ni guardarlo en `localStorage`.

### Solución acordada: ticket exclusivo de subscription

Implementa este recorrido:

```text
React
  → POST a Astro con la cookie existente
  → Astro solicita un ticket al backend
  → Backend verifica sesión y rol ADMIN
  → React recibe el ticket
  → React inicia la subscription con ese ticket
```

Pasos:

1. Agregar una mutation administrativa, por ejemplo:

   ```graphql
   crearTicketBackOffice
   ```

   Debe estar protegida por autenticación y rol `ADMIN`, y devolver el ticket y su expiración.

2. El ticket debe tener una firma separada de los tokens de sesión. Puede utilizar una clave derivada del secreto servidor con un contexto exclusivo.

3. Incluir identificador del usuario, identificador del ticket, emisor, audiencia y propósito exclusivo de BackOffice. Una duración de unos 60 segundos es suficiente para iniciar la operación.

4. **El ticket no debe funcionar como token de sesión para las queries y mutations HTTP.**

5. Crear un guard específico para la subscription que valide el ticket y confirme en la base de datos que el usuario sigue siendo `ADMIN` al iniciar la operación.

6. Conservar el acceso por sesión que utilizan los scripts administrativos existentes, mediante rutas explícitas de validación. No convertir silenciosamente un ticket inválido en un intento de autenticación por otro mecanismo.

7. Crear esta ruta Astro:

   ```text
   front/src/pages/api/admin/subscription-ticket.ts
   ```

   Debe:

   - Aceptar únicamente `POST`.
   - Comprobar mismo origen.
   - Leer `tl_session` en el servidor.
   - Solicitar el ticket mediante `requestBackend`.
   - Responder sin caché.
   - Devolver `401` sin sesión y `403` sin permisos.
   - No devolver el JWT de sesión ni errores internos.

8. El cliente React solicita el ticket y conecta utilizando:

   ```ts
   connectionParams: {
     ticket,
   }
   ```

   Adaptar el contexto del backend para transportar ese campo.

No guardar tickets persistentemente, incluirlos en URLs ni imprimirlos en logs.

**Fuera del alcance de esta práctica:** expiración, revocación o corte por cambios de rol durante una subscription ya iniciada. La vigencia del ticket se valida al iniciar la operación.

Cerrar la conexión local al abandonar el panel o cerrar sesión sí forma parte del manejo del frontend.

## 5. Implementar un cliente compartido

Agregar `graphql-ws` como dependencia explícita de `front` si todavía no lo es.

Posibles archivos nuevos:

```text
front/src/lib/backoffice-subscriptions.ts
front/src/hooks/useBackOfficeEvents.ts
```

Puedes usar un provider si encaja mejor con la estructura existente.

Requisitos:

- Una conexión compartida por panel montado.
- No crear una conexión por tabla, render o evento.
- Conectar únicamente después de verificar el acceso administrativo.
- Eliminar subscription, cliente, temporizadores y listeners al desmontar.
- Evitar conexiones duplicadas al montar y desmontar repetidamente.
- Mostrar estados de conexión comprensibles.
- Reconectar con espera progresiva y límite de reintentos.
- Ante `401` o `403`, recuperar sesión o mostrar acceso denegado; no reintentar indefinidamente.
- Tratar errores de la operación, no solo errores del socket.

Estados sugeridos:

```text
Conectando
Conectado
Reconectando
Desconectado / Error
```

### Configuración del despliegue

Usar `ws` en desarrollo y `wss` cuando el frontend se sirve por HTTPS.

Configurar explícitamente la URL pública WebSocket del backend. La variable actual `BACKEND_GRAPHQL_URL` es servidor-servidor y puede contener una dirección privada.

No generar conexiones a `127.0.0.1` en producción.

La ruta Astro del ticket es HTTP: **no actúa como proxy WebSocket**. El navegador debe alcanzar un backend NestJS que soporte conexiones persistentes.

No afirmar que el despliegue está validado sin probar ese destino real.

## 6. Actualizar los módulos existentes

Integra el cliente compartido en `PanelAdmin` y sus módulos.

No fuerces el remontaje de toda la pantalla mediante una `key`: eso borraría filtros y formularios.

Usa esta tabla para determinar qué consultas pueden quedar obsoletas:

| Evento | Módulos afectados |
|---|---|
| `PEDIDO` | Dashboard, pedidos, detalle e historial, clientes |
| `PRODUCTO` | Productos, inventario, dashboard, categorías y conteos |
| `INVENTARIO` | Existencias, movimientos, productos y dashboard |
| `CATEGORIA` | Categorías, selectores y productos relacionados |
| `PAGO` | Pagos, dashboard, pedidos y gasto de clientes |

No ejecutes todas las consultas por cada evento. Refresca las vistas relevantes que estén montadas; las demás consultarán al abrirse.

Requisitos:

- Conservar las variables actuales de las consultas.
- Utilizar `retry`, `refetch` o invalidación explícita.
- Agrupar ráfagas de eventos durante unos 150–300 ms.
- Deduplicar por `eventoId` con memoria limitada.
- Evitar que respuestas antiguas sobrescriban resultados nuevos.
- Refrescar las vistas activas después de reconectar, aunque no llegue un evento.
- Conservar formularios en edición.
- Si el registro editado cambió, avisar y ofrecer una recarga explícita.
- Mostrar notificaciones breves sin saturar al usuario.
- Mantener los importes calculados por el backend.

No introducir polling como sustituto de las subscriptions. Revisar el polling existente para evitar recargas duplicadas dentro del panel.

## 7. Conservar la corrección del carrito

El flujo actual:

1. Crea un intento de compra.
2. Reserva inventario.
3. Verifica el resultado con Mercado Pago.
4. Crea el pedido cuando el pago se confirma.
5. Ajusta el carrito una sola vez tras la confirmación.

Debes conservar:

- Idempotencia.
- Recuperación de intentos inciertos.
- Protección contra compras duplicadas.
- Liberación de reservas cuando corresponde.
- Sincronización del carrito entre pestañas.
- Descuento de artículos del carrito únicamente después de confirmar.

**No regresar al flujo anterior de crear el pedido antes de iniciar el pago.**

Un intento reservado no representa un pedido confirmado ni una venta aprobada.

No añadir aprobación manual de pagos ni realizar cobros reales en las pruebas.

## 8. Pruebas necesarias

Conservar los tests recibidos y agregar pruebas significativas para:

- Rechazo de tickets sin sesión o con rol `CLIENTE`.
- Ticket válido.
- Ticket alterado, de propósito incorrecto o vencido antes de iniciar la operación.
- Imposibilidad de usar el ticket como sesión HTTP.
- Montaje, desmontaje y reconexión sin conexiones duplicadas.
- Actualización por eventos manteniendo filtros y formularios.
- Agrupación de ráfagas y deduplicación.
- Recuperación de datos después de perder la conexión.

Si hacen falta herramientas de prueba para frontend, añadirlas con una justificación clara. No sustituir pruebas funcionales por comprobaciones que solo repitan la implementación.

Desde la raíz, sobre una base de desarrollo:

```bash
npm ci
npm run db:generate
npm run db:migrate
npm run db:seed
npm run test:subscriptions
npm run test:checkout
npm run build
```

La prueba de integración inicia su propio backend y no requiere `npm run dev` en otra terminal.

Crea datos de prueba y utiliza Mercado Pago simulado.

Si aparece una colisión en `productos.id`, revisar y sincronizar las secuencias mediante el seed existente. No borrar tablas ni quitar assertions.

## 9. Demostración funcional obligatoria

Usar dos sesiones:

- Un administrador observando el BackOffice.
- Otra sesión realizando operaciones.

Comprobar:

1. La información cambia sin presionar F5.
2. Los filtros y la paginación se conservan.
3. Los formularios en edición no pierden datos.
4. Se muestran los estados de conexión.
5. Tras interrumpir y recuperar la conexión, los datos se actualizan.
6. Al salir del panel o cerrar sesión, se limpia la conexión local.
7. Reservar un checkout no anuncia un pedido inexistente.
8. Confirmar el pago no descuenta inventario por segunda vez.

Distinguir las comprobaciones simuladas de las pruebas reales. Pasar tests del backend no demuestra por sí solo que la interfaz funciona.

## 10. Entrega del asistente

Al terminar, entregar:

- Archivos creados y modificados, con su motivo.
- Comandos ejecutados y resultados.
- Variables necesarias, sin valores secretos.
- Pasos para reproducir la demostración.
- Configuración del destino WebSocket.
- Limitaciones y pendientes.

No declarar terminada la práctica si falta la conexión del navegador, la actualización de los módulos o su comprobación funcional.

No hacer push, merge ni despliegue sin autorización del compañero.

**Si no puede descargar archivos, mostrar el código directamente en el chat. No depender de ZIPs o enlaces locales como única entrega.**