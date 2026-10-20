# Checkout API con Orders: reserva, cobro y resultado

El backend expone dos operaciones autenticadas. `prepararCompra` reserva stock
y devuelve el total calculado desde PostgreSQL; no llama a Mercado Pago.
`procesarPago` cobra ese total con un token generado por MercadoPago.js.
El frontend prepara la compra, inicializa CardForm con el total del servidor,
envía el token a `procesarPago` y muestra el resultado dentro de TecnoLeague.
La validación de una tarjeta por sí sola no cobra ni crea un pedido.

## Instalación y migración

Desde la raíz, con `DATABASE_URL` configurada en `back/.env`:

```sh
npm ci
npm run db:generate
npm run db:migrate
npm run build -w back
```

La migración `202610190001_orders_api` agrega la modalidad de checkout y la tabla
`operaciones_cobro`. Conserva datos existentes y asigna `REDIRECCION` a los
intentos anteriores. No usar `db push`, `migrate reset` ni editar migraciones
ya aplicadas para instalar este cambio.

La migración `202610200001_orders_autenticacion` agrega el modo de captura de la
operación. Conserva `automatic` en operaciones anteriores y las nuevas se crean
con `automatic_async`, para admitir autenticación bancaria sin cambiar los
parámetros de reenvíos anteriores.

El backend necesita `MP_ACCESS_TOKEN`, `MP_COLLECTOR_ID` (vendedor asociado al
token) y `MP_WEBHOOK_SECRET`. Configura en la aplicación de Mercado Pago el
webhook público HTTPS `/pagos/webhook` y eventos de Orders. Las credenciales
deben corresponder al mismo escenario de pruebas o producción.
El frontend necesita `PUBLIC_MP_PUBLIC_KEY` en `front/.env` y reiniciarse después
de cambiarla. Public Key y Access Token deben corresponder al mismo escenario.
El flujo anterior conserva sus variables de retorno y callback.

## Contrato para el frontend

```graphql
mutation Preparar($datos: PedidoInput!) {
  prepararCompra(datos: $datos) {
    intentoId total moneda expiraEn estado modalidad
  }
}

mutation Cobrar($id: ID!, $pago: DatosPagoInput!) {
  procesarPago(intentoId: $id, datosPago: $pago) {
    intentoId estado pedidoId aviso operacionId estadoOperacion autenticacion { url }
  }
}
```

1. Enviar entrega, renglones y `claveSolicitud` UUID a `prepararCompra`.
   Reutilizar esa clave para recuperar una preparación con respuesta perdida.
2. Inicializar el formulario con `total` (cadena decimal) y `moneda` del servidor.
3. Generar el token de tarjeta. Enviar `claveOperacion` UUID, `token`,
   `metodoPagoId`, `tipoMetodoPago` (`credit_card` o `debit_card`), `cuotas`,
   `email` e `identificacion` opcional. Obtener el tipo real del método mediante
   el SDK; no asumir que todas las tarjetas son de crédito. Débito admite una
   cuota en esta implementación. No enviar un importe.
4. Mostrar el resultado confirmado por el servidor. `EN_PROCESO` no significa
   compra aprobada. Consultar `estadoIntento` para recuperar el resultado.

La creación usa `/v1/orders`, `processing_mode: automatic`, captura asíncrona,
MXN y una referencia `TL-OP-<operacionId>`. No espera `checkout_url`.
El pedido se crea una sola vez al verificar vendedor, referencia, moneda/país,
importe total e importe acreditado con estado `processed/accredited`.

## Duplicados y recuperación

- Cada reserva admite una operación de cobro. Doble clic y claves nuevas sobre
  el mismo intento no crean cobros adicionales. Después de un rechazo definitivo,
  preparar un nuevo intento y generar un token nuevo.
- Antes de llamar al proveedor se guarda la operación y su idempotencia. La
  llamada de creación ocurre fuera de la transacción que reserva inventario.
- No se guardan tokens, documentos ni cuerpos del proveedor en la operación.
  Se guarda un digest SHA-256 del payload para reconocer un reenvío idéntico.
- Tras un timeout, consultar no vuelve a cobrar ni libera stock. Un webhook
  `order` puede vincular la orden por su referencia aunque el POST haya perdido
  su respuesta.
- Un reenvío explícito con la MISMA `claveOperacion` y exactamente los mismos
  datos reutiliza la idempotencia original. Un token diferente se rechaza.
  Una llamada en curso bloquea reenvíos; después de 60 segundos puede recuperarse
  una operación cuyo proceso haya terminado inesperadamente. Los reenvíos se
  limitan a los primeros 15 minutos; después solo consultar o recuperar el webhook.
  No almacenar el
  token en localStorage; conservarlo solo en memoria durante esta solicitud.
- Si se pierde el token y no llega el webhook, se requiere revisar la orden en
  Mercado Pago y recuperar su notificación. No habilitar otro cobro a ciegas.
- Vencimiento o cancelación sin ninguna operación libera la reserva. Con un
  cobro incierto se mantiene hasta verificar el proveedor. Las órdenes vinculadas
  se consultan y, cuando corresponde, se cancelan antes de liberar stock.

## Pruebas

```sh
npm run test:orders
```

Las pruebas HTTP usan proveedor simulado. Para ejecutar además las pruebas sobre
PostgreSQL, prepara una base de pruebas separada, aplica las migraciones allí y
exporta `ORDERS_TEST_DATABASE_URL` antes del comando. El runner no toma
`DATABASE_URL` implícitamente; crea datos identificados y elimina solo sus datos.
Sin esa variable, el bloque de integración queda explícitamente omitido.

Las pruebas verifican total del servidor, concurrencia, propiedad del intento,
rechazo, vencimiento, timeout, reenvío idempotente, webhook duplicado,
validación de la orden y compatibilidad con redirección. No demuestran cobros
reales ni disponibilidad de la cuenta de Mercado Pago.

## Resultado y autenticación bancaria (etapa 4)

`ResultadoPago.tsx` muestra el resultado y la acción bancaria. `use-estado-pago.ts`
comparte consultas acotadas, recuperación al volver a la pestaña, cancelación y
actualización idempotente del carrito entre checkout y retorno.
Solo `CONFIRMADO`, verificado por el backend, actualiza el carrito.
Una respuesta perdida conserva el intento y consulta; no genera otro cobro.

Se solicita `transaction_security.validation: on_fraud_risk` y se expone una URL
HTTPS del desafío obtenida de la orden verificada. Se acepta
`payment_method.transaction_security.url` o `payment_method.redirect_url` cuando
la orden requiere una acción. No se persisten las URLs del desafío.
La interfaz muestra un iframe y una opción de abrir el banco en otra pestaña
cuando sus políticas impidan mostrarlo embebido. Ningún mensaje del iframe,
su cierre ni su carga aprueban la compra: siempre se consulta el backend.

Referencias de contrato: [Orders del SDK oficial de Node](https://github.com/mercadopago/sdk-nodejs/blob/master/src/clients/order/create/types.ts),
[respuesta de Orders](https://github.com/mercadopago/sdk-nodejs/blob/master/src/clients/order/commonTypes.ts),
[CardForm del SDK oficial](https://github.com/mercadopago/sdk-js/blob/master/docs/card-form.md).
La disponibilidad de captura asíncrona/3DS y la presentación del desafío deben
verificarse con la cuenta de México y una tarjeta de pruebas compatible.
Las pruebas simuladas no establecen disponibilidad ni acreditación real.
Las reglas comerciales de intereses de cuotas no se implementan aquí.

Pruebas de recuperación y componentes:

```sh
npm run test:checkout
```
