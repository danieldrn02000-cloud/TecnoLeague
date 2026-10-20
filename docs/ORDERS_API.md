# Checkout API con Orders: reserva, cobro y resultado

El backend expone dos operaciones autenticadas. `prepararCompra` reserva stock
y devuelve el total calculado desde PostgreSQL; no llama a Mercado Pago.
`procesarPago` cobra ese total con un token generado por MercadoPago.js.
El frontend prepara la compra, inicializa los campos seguros de MercadoPago.js con el total del servidor,
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
operación. Los pagos nuevos se crean con `automatic`, sin solicitar configuración
de 3DS. Los reenvíos conservan el modo guardado, incluido `automatic_async` en
operaciones iniciadas con la configuración anterior. Este ajuste no requiere
una migración adicional ni nuevas variables de entorno.

El backend necesita `MP_ACCESS_TOKEN`, `MP_COLLECTOR_ID` (vendedor asociado al
token) y `MP_WEBHOOK_SECRET`. Configura en la aplicación de Mercado Pago el
webhook público HTTPS `/pagos/webhook` y eventos de Orders. Las credenciales
deben corresponder al mismo escenario de pruebas o producción.
El frontend necesita `PUBLIC_MP_PUBLIC_KEY` en `front/.env` para desarrollo local
y reiniciarse después de cambiarla. Public Key y Access Token deben corresponder al mismo escenario.
El flujo anterior conserva sus variables de retorno y callback.

### Netlify

No se sube `front/.env`. Define `PUBLIC_MP_PUBLIC_KEY` en las variables del sitio,
con scope **Builds** y un valor para el contexto utilizado (**Production**,
**Deploy previews** o la rama correspondiente). No basta con scope Functions.
La clave pública se incorpora al JavaScript del navegador durante el build:
guardar la variable no cambia un deploy existente. Ejecuta un nuevo deploy
con build después de configurarla; no publiques de nuevo un artefacto antiguo.
El build de Netlify se detiene con un mensaje explícito si la variable no está
disponible, para evitar publicar un formulario de pago sin configurar.
Solo `PUBLIC_MP_PUBLIC_KEY` va al navegador; `MP_ACCESS_TOKEN` y
`MP_WEBHOOK_SECRET` permanecen en el backend.

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
   La interfaz usa el correo de la cuenta autenticada para preparación y pago;
   no pide correo ni documento al comprador. En el flujo mexicano se omite la
   identificación. El backend conserva el campo opcional por compatibilidad.
   La tokenización usa `fields.createCardToken({ cardholderName })` con número,
   vencimiento y CVV capturados en iframes del SDK, sin campos ocultos ficticios.
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
El seguimiento realiza como máximo 12 consultas por tanda (cada cinco segundos
después de recibir la respuesta); un desafío bancario puede extender la tanda
a 120 consultas. Volver a enfocar la ventana no reinicia el contador ni solapa
peticiones. Al agotarse el límite se muestra una pausa y solo «Consultar estado»
abre otra tanda. Un estado final detiene las consultas.
Solo `CONFIRMADO`, verificado por el backend, actualiza el carrito.
Una respuesta perdida conserva el intento y consulta; no genera otro cobro.

Los pagos nuevos usan `capture_mode: automatic` y omiten
`config.online.transaction_security`. No se solicita un desafío 3DS ni se muestra
una opción para activarlo. Esto no garantiza aprobación ni permite omitir una
autenticación exigida por Mercado Pago o el emisor.

Para conservar la idempotencia de operaciones anteriores, los reenvíos guardados
con `automatic_async` mantienen `config.online.transaction_security` con
`validation: on_fraud_risk` y `liability_shift: required`, siguiendo el
[ejemplo oficial de 3DS](https://github.com/mercadopago/sdk-nodejs/blob/master/src/examples/order/createWith3DS.ts).
La configuración debe incluir ambas propiedades; enviar solo `validation`
produce `required_properties`. No se envía dentro de
`transactions.payments[].payment_method`: el endpoint la rechaza con
`unsupported_properties`. Se expone una URL
HTTPS del desafío obtenida de la orden verificada. Se acepta
`payment_method.transaction_security.url` o `payment_method.redirect_url` cuando
la orden requiere una acción. No se persisten las URLs del desafío.
La interfaz muestra un iframe y una opción de abrir el banco en otra pestaña
cuando sus políticas impidan mostrarlo embebido. Ningún mensaje del iframe,
su cierre ni su carga aprueban la compra: siempre se consulta el backend.

Referencias de contrato: [Orders del SDK oficial de Node](https://github.com/mercadopago/sdk-nodejs/blob/master/src/clients/order/create/types.ts),
[respuesta de Orders](https://github.com/mercadopago/sdk-nodejs/blob/master/src/clients/order/commonTypes.ts),
[campos seguros del SDK oficial](https://github.com/mercadopago/sdk-js/blob/master/docs/fields.md).
La disponibilidad de captura asíncrona/3DS y la presentación del desafío deben
verificarse con la cuenta de México y una tarjeta de pruebas compatible.
Las pruebas simuladas no establecen disponibilidad ni acreditación real.
Las reglas comerciales de intereses de cuotas no se implementan aquí.

Pruebas de recuperación y componentes:

```sh
npm run test:checkout
```

## Diagnóstico de creación y webhook

`solicitudRechazada` distingue un error HTTP al crear la orden de un rechazo
bancario confirmado. Una solicitud inválida muestra «No se pudo iniciar el pago».
En el POST inicial, `402` con código `failed` significa pago rechazado y termina
el intento, liberando la reserva una sola vez. Un `402` sin ese código sigue
siendo incierto. Un rechazo recibido al reenviar nunca descarta un cobro previo
incierto ni libera su inventario.
El backend registra `ERROR_CREAR_ORDEN_MP` con HTTP, código, causas y request ID;
no registra cuerpos, mensajes del proveedor, tokens ni datos de tarjeta.
El extractor admite `errors`, `cause`, `causes` y errores anidados. `campos`
contiene exclusivamente nombres públicos conocidos del contrato de la solicitud;
`formato` identifica la estructura de error recibida. No contiene valores del comprador.
Una orden consultada y validada registra `ORDEN_MP_VERIFICADA` con estado y detalle
cuando cambian; permite identificar un rechazo del proveedor con HTTP exitoso.
`transacciones` incluye los códigos de estado y detalle de cada pago. El detalle
de la orden puede ser solo `failed`, mientras el de la transacción identifica
el motivo, por ejemplo `cc_rejected_3ds_challenge`. No se registran mensajes ni valores del comprador.
Para consultar una orden ya rechazada sin iniciar otro pago, tras compilar el backend:
`npm run diagnostico:orden -- ID_ORDEN`. Lee `MP_ACCESS_TOKEN` del entorno o de
`back/.env` y solo realiza un GET a Mercado Pago; no necesita conexión a la base de datos.
Los errores de red conocidos se identifican mediante códigos como `ENOTFOUND`,
`ECONNRESET` o `TIMEOUT` sin imprimir direcciones ni credenciales.

Una consulta mientras la orden se está creando devuelve un estado pendiente;
no es un rechazo ni provoca otro cobro. Un resultado incierto conserva el stock
y no permite cancelar localmente sin verificar el proveedor.

La creación de la orden conecta el backend con `api.mercadopago.com`.
El webhook conecta Mercado Pago con el backend público después de esa operación.
La URL debe ser `https://<servicio>.onrender.com/pagos/webhook` y estar registrada
en la aplicación de Mercado Pago. En el flujo Orders API actual, definir
`MP_WEBHOOK_URL` en `.env` no registra por sí solo la URL en Mercado Pago;
esa variable se usa para el callback del flujo anterior de redirección.
Si el backend local y Render comparten la base de datos, ambos deben usar código
y credenciales compatibles con las mismas órdenes y el mismo vendedor.
Si el webhook indica firma inválida, comprueba que
`MP_WEBHOOK_SECRET` en Render sea la firma secreta del webhook de la misma
aplicación y entorno de Mercado Pago; no es el Access Token ni la Public Key.
No desactives la validación. Tras corregir la configuración y desplegar, reenvía
desde el panel de Mercado Pago las notificaciones fallidas de los intentos
anteriores que quedaron inciertos. El código no los marca como rechazados
retroactivamente: una respuesta de un reenvío no demuestra ausencia de cobro.

### Cerrar un rechazo inicial histórico comprobado

Si el log original demuestra `ERROR_CREAR_ORDEN_MP`, `http:402`, `codigo:failed`
y `reenvio:false`, el intento anterior puede haber quedado `INCIERTA` por el
tratamiento antiguo del 402. Con el backend compilado, el administrador puede ejecutar:

```sh
npm run checkout:cerrar-rechazo -- INTENTO_ID OPERACION_ID --confirmar-rechazo-inicial-402
```

El comando lee `DATABASE_URL` del entorno o `back/.env`. Usa exactamente los dos
IDs del log inicial comprobado y la base de datos donde existe el intento.
No usar para timeouts ni para un 402 recibido en un reenvío. El comando exige
una operación histórica incierta sin orden ni pedido vinculados; no se expone
al navegador. Cierra como `RECHAZADO`, libera la reserva una vez mediante la
conciliación existente y permite preparar otra compra. Es idempotente y no cobra.
No basta con borrar localStorage ni con cambiar el carrito: el intento se conserva
en la base de datos para evitar cobros duplicados.
