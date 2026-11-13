# PayPal Checkout estándar con redirección

El checkout ofrece PayPal como opción inicial. TecnoLeague calcula en el backend
el total y los artículos de uno o varios productos, reserva el inventario y crea
una orden PayPal Orders v2 con `intent: CAPTURE`. Redirige al enlace de aprobación
de PayPal. Al regresar, el backend captura y vuelve a consultar la orden antes
de crear el pedido como pagado. `APPROVED` por sí solo no significa cobro.

## Configuración Sandbox

En el backend local (`back/.env`) o en **Environment** del servicio de Render:

```dotenv
PAYPAL_ENV=sandbox
PAYPAL_CLIENT_ID=CLIENT_ID_DE_TU_APP_SANDBOX
PAYPAL_CLIENT_SECRET=SECRET_DE_TU_APP_SANDBOX
PAYPAL_MERCHANT_ID=MERCHANT_ID_DE_LA_CUENTA_BUSINESS_SANDBOX
PAYPAL_RETURN_BASE_URL=https://TU-SITIO.netlify.app
```

Para localhost usa `PAYPAL_RETURN_BASE_URL=http://127.0.0.1:5173`; para un túnel
usa su URL HTTPS del frontend. En Render la URL debe apuntar al frontend de
Netlify, no al backend de Render ni a localhost. Si no se define, se usa
`PUBLIC_SITE_URL`. Las URLs quedan guardadas al crear la compra.

1. En [PayPal Developer](https://developer.paypal.com/dashboard/), crea o elige una
   aplicación **Sandbox** vinculada a una cuenta de prueba **Business**. Copia
   su Client ID y Secret al backend.
2. Obtén el Merchant ID de esa cuenta Business: entra a la cuenta en
   `sandbox.paypal.com` y consulta su identificación de comerciante en la
   configuración del negocio. No es el Client ID, el correo ni el ID del comprador.
3. Usa una cuenta Sandbox **Personal** distinta para pagar, con sus credenciales
   de prueba del panel Sandbox Accounts. El vendedor y el comprador deben ser
   cuentas diferentes. La tienda cobra en **MXN**: configura la cuenta Business
   para aceptar esa moneda y utiliza un comprador de prueba con fondos suficientes.

El frontend no necesita Client ID, Secret ni el SDK de botones. Mantén en Netlify
`BACKEND_GRAPHQL_URL=https://TU-BACKEND.onrender.com/graphql` y el mismo
`AUTH_BRIDGE_SECRET` del backend para la sesión. Las variables PayPal van en
Render, no en variables `PUBLIC_*`. Mercado Pago sigue disponible cuando su
`PUBLIC_MP_PUBLIC_KEY` está configurada durante el build, pero es opcional para
usar PayPal. Sandbox es el entorno predeterminado; producción solo se selecciona
expresamente con `PAYPAL_ENV=live` y credenciales de producción.

## Instalación y prueba

Desde la raíz, tras actualizar y antes de reiniciar el backend:

```sh
npm run db:generate
npm run db:migrate
npm run build -w back
```

Despliega también el frontend. La migración `202611130001_paypal_checkout` añade
la modalidad PayPal y el registro de inicio de captura; conserva los pedidos
y las integraciones existentes.

Agrega uno o varios productos, ve al checkout, selecciona PayPal y completa la
entrega. Pulsa **Continuar con PayPal**, inicia sesión con el comprador Sandbox
y aprueba. Al regresar, debe aparecer **Pago aprobado**, un solo pedido con
método PayPal y todas sus líneas. El stock se descuenta una sola vez. Comprueba
la transacción también en la cuenta Business Sandbox: no basta con el texto de
la pantalla. Los pagos Sandbox no mueven dinero real.

## Recuperación y cancelación

- Se persiste el payload calculado antes de HTTP. La creación y la captura usan
  claves de idempotencia diferentes y estables.
- Una devolución de URL con `resultado=aprobado`, `token` o `PayerID` no confirma
  el pago. Solo se usa la orden guardada y la cuenta autenticada del comprador.
- Se valida vendedor, referencia, moneda, importe total, captura completada e
  importe capturado antes de aprobar. No se confía en importes del navegador.
- Un retorno repetido consulta el mismo pago; no crea otro pedido ni vuelve a
  descontar inventario. Una respuesta perdida se recupera consultando la orden.
- Antes de enviar una captura se guarda una marca bajo bloqueo de la compra.
  Cancelar o vencer antes de ese momento termina la compra localmente y bloquea
  toda captura posterior. La creación de una orden no cobra dinero.
- Tras una captura incierta se conserva la reserva. No se libera por un timeout
  ni se permite pagar otra vez hasta verificar el resultado. El retorno permite
  reintentar la captura con la misma clave entre 30 segundos y cinco minutos;
  después solo se consulta para evitar reutilizar claves fuera de la ventana.
- Los rechazos explícitos del instrumento en la primera captura se muestran como
  rechazados. Un error de un reenvío no descarta un cobro anterior incierto.
- El backend revisa compras pendientes cada minuto; el regreso funciona también
  sin configurar webhooks PayPal. Esta integración no procesa notificaciones de
  reembolso posteriores a una compra finalizada.

## Validación automatizada

```sh
npm run test:paypal
```

La integración con PostgreSQL usa únicamente `PAYPAL_TEST_DATABASE_URL`, nunca
`DATABASE_URL` por defecto; sin esa variable se omite. Las respuestas de PayPal
se simulan para probar concurrencia, cancelación, expiración, respuestas perdidas,
rechazos y validación de vendedor e importes. El recorrido también se verifica
en Chromium con PayPal simulado. Para verificar una transacción real de Sandbox
se requieren las credenciales y cuentas de prueba del despliegue.

Contrato utilizado: [Orders v2](https://developer.paypal.com/docs/api/orders/v2/)
y [especificación oficial](https://github.com/paypal/paypal-rest-api-specifications/blob/main/openapi/checkout_orders_v2.json).
