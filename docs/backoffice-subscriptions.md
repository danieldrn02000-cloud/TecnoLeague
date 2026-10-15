# Eventos administrativos sobre el checkout actualizado

Base revisada: commit `6858f627fe1a517a4efe766d44f0d50bb312144d` de main.

## Análisis de la actualización

El checkout reserva stock en IntentoCompra y crea el pedido al verificar el pago.
El retorno descuenta únicamente las cantidades compradas del carrito, marca la
aplicación por intento y usa navigator.locks cuando está disponible. El provider
se sincroniza con storage y tl-carrito-actualizado. Los intentos inciertos se
recuperan consultando el backend antes de permitir otra compra.

Esta entrega conserva esos archivos de frontend y la migración existente.
No vuelve al flujo anterior de crearPedido antes de iniciarPago.
Se ejecutan las 13 regresiones existentes de recuperación del checkout; esto no
sustituye una prueba visual en navegador ni una compra real con Mercado Pago.

## Archivos nuevos y su motivo

- `back/test/backoffice.test.cjs`: integración de Nest, PostgreSQL y WebSocket;
  valida permisos, CRUD, cambios de estado, compras y publicaciones del checkout
  actualizado. Mercado Pago se simula para no hacer cobros ni requerir claves reales.
- `back/test/eventos-compilado.test.cjs`: prueba unitaria del PubSub contra el código
  compilado. Evita conflictos con el cargador TypeScript nativo de Node en Windows.
  El test TypeScript original del usuario se conserva.
- `docs/backoffice-subscriptions.md`: explica contrato, ejecución y entrega.

## Archivos actualizados y su motivo

- `back/src/eventos.service.ts`: centraliza el registro de fallos de publicación;
  una notificación fallida no convierte una compra confirmada en una respuesta fallida.
- `back/src/tienda.service.ts`: publica alta, edición y baja de productos;
  inventario inicial y descuentos de compras directas, preservando idempotencia.
- `back/src/admin.service.ts`: publica estados de pedidos, devoluciones por
  cancelación, ajustes de inventario y CRUD de categorías. Conserva los nuevos
  campos de búsqueda e información de intentos en adminPagos.
- `back/src/pagos.service.ts`: acumula avisos dentro de cada transacción y los
  publica tras el commit. Si falla la transacción, descarta todos sus avisos.
  Reutiliza las validaciones y el flujo de conciliación existentes.
- `package.json`: comandos test:subscriptions y test:checkout.

## Contrato de publicaciones

| Acción | Evento |
| --- | --- |
| Alta/edición/baja de producto | PRODUCTO / CREADO, ACTUALIZADO, DESACTIVADO |
| Stock inicial, ajuste manual | INVENTARIO / ACTUALIZADO |
| Compra directa nueva | PEDIDO / CREADO e INVENTARIO / ACTUALIZADO |
| Estado de pedido | PEDIDO / ACTUALIZADO |
| Cancelación de pedido con devolución | Además INVENTARIO / ACTUALIZADO |
| CRUD categorías | CATEGORIA / CREADO, ACTUALIZADO, ELIMINADO |
| Intento nuevo con reserva | PAGO / CREADO e INVENTARIO / ACTUALIZADO |
| Vinculación de checkout, cambio verificado de proveedor | PAGO / ACTUALIZADO |
| Acreditación de intento | PEDIDO / CREADO y PAGO / ACTUALIZADO |
| Acreditación tardía tras liberación | Además INVENTARIO / ACTUALIZADO |
| Rechazo/cancelación/expiración verificada | PAGO / ACTUALIZADO; INVENTARIO si libera reserva |
| Reembolso confirmado por proveedor | PAGO / ACTUALIZADO; no devuelve stock automáticamente |

INVENTARIO.entidadId es el ID del producto; PAGO.entidadId es el ID del pago.
Los intentos tienen ID UUID y no se anuncian como pedidos con ID entero.
Confirmar una reserva activa no vuelve a descontar stock y no publica un segundo
cambio de inventario. Reintentos idempotentes y webhooks duplicados sin cambios
no vuelven a emitir esas actualizaciones.

## Pruebas

Desde la raíz, con Node >=22.12 y una base **de desarrollo**:

```sh
npm ci
npm run db:generate
npm run db:migrate
npm run db:seed
npm run test:subscriptions
npm run test:checkout
```

Configurar back/.env con DATABASE_URL, JWT_SECRET, AUTH_BRIDGE_SECRET,
ADMIN_EMAIL y ADMIN_PASSWORD. No compartir sus valores.
No requiere npm run dev: la integración levanta y cierra su backend en un puerto libre.
No llama a Mercado Pago: emplea respuestas simuladas y configuración temporal.
Crea cuentas, productos TEST, pedidos e intentos en la base; conserva esos datos
por sus relaciones e historial. Solo debe ejecutarse sobre datos de desarrollo.
Las pruebas se conservan y versionan para detectar regresiones.

La prueba de integración verifica reserva sin pedido, stock descontado una sola vez,
rollback sin publicaciones, confirmación con pedido persistido, rechazo y liberación,
respuestas con importes inválidos y duplicados sin nuevas publicaciones. También
reutiliza scripts/test-api.mjs para CRUD, inventario, pedidos e idempotencia.

## Para el compañero

Consumir el campo existente mediante graphql-ws:

```graphql
subscription {
  backOfficeActualizado {
    eventoId entidad entidadId accion ocurridoEn
  }
}
```

Endpoint local ws://127.0.0.1:4000/graphql, connectionParams.authorization con
Bearer. Solo ADMIN inicia la subscription. No se añade expiración ni revocación
durante la operación. Para el navegador sigue pendiente el mecanismo de ticket
mediante Astro: no exponer el JWT HttpOnly en localStorage.

Al recibir un evento, volver a consultar los módulos afectados preservando filtros.
Al conectar/reconectar, consultar el estado actual: PubSub en memoria no guarda
historial, no comparte eventos entre instancias ni garantiza entrega tras un fallo.

## Aplicar la entrega en Windows

El ZIP contiene los archivos completos modificados/nuevos y el parche equivalente.
Trabajar sobre el commit base indicado y conservar los cambios locales propios.
Desde la raíz, con el parche descargado:

```sh
git apply --check ruta/al/backoffice-actualizado.patch
git apply ruta/al/backoffice-actualizado.patch
```

Si la comprobación informa conflictos, revisar las diferencias antes de aplicar.
Los archivos del ZIP permiten inspeccionar o copiar los cambios manualmente.
No se incluyen .env, secretos, node_modules ni datos de PostgreSQL.
