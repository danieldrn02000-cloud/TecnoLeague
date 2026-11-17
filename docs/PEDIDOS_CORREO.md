# Confirmaciones de pedido por correo

Los pedidos nuevos encolan un correo en la misma transacción que crea el pedido.
Incluye compras con pago al recibir y pedidos creados tras verificar un pago de
Mercado Pago o PayPal. Reservar un carrito o tener un pago pendiente/rechazado no
crea un correo. Repetir una confirmación no agrega otro: la cola usa `pedido_id`
como clave primaria. No se crean correos retroactivos para pedidos anteriores.

El destinatario es el correo de contacto del pedido. El contenido incluye el mismo
folio que muestra la tienda (`TL-año-id`), fecha, productos/cantidades, total en MXN,
método de pago, destinatario y dirección. Si ya existen, incluye guía y paquetería;
en caso contrario indica **Por asignar**. La confirmación no significa que el
paquete ya haya salido ni inventa una fecha estimada de entrega. Los cambios
posteriores de guía siguen consultándose en **Mis pedidos**; esta implementación
envía una confirmación de creación, no correos por cada actualización de tracking.

## Configuración en Render

- `RESEND_API_KEY`: la misma API key que utiliza la recuperación de contraseña,
  con permiso de envío para el dominio verificado en Resend.
- `ORDER_EMAIL_FROM`: opcional, por ejemplo `TecnoLeague <compras@tudominio.com>`.
  Si está vacío, se reutiliza `PASSWORD_RESET_FROM`.
- `PUBLIC_SITE_URL`: URL HTTPS del frontend. Agrega un enlace a la tienda; no es
  necesaria para enviar el mensaje si no se configura una dirección válida.
- `ORDER_EMAIL_DISABLED=1`: detiene el proceso de entrega sin impedir que los
  pedidos se encolen. CI lo usa para no contactar servicios reales.

Después de cambiar variables, reinicia o vuelve a desplegar el backend. El proceso
NestJS consulta la cola al arrancar y cada 30 segundos. Si no hay configuración de
correo, conserva los pendientes y deja un aviso en el log; no cancela compras.

El remitente debe pertenecer al dominio verificado de Resend. Los errores del
proveedor quedan como códigos en el log, sin imprimir destinatarios, direcciones,
claves ni cuerpos del correo. Las pruebas usan respuestas simuladas de Resend.

## Migración y entrega

Ejecuta `npm run db:generate` y `npm run db:migrate`. La migración
`202611170001_imagenes_inventario_correos` retira `productos.stock_minimo` y crea
`correos_pedido`. Se conservan las existencias, usuarios y pedidos.

Cada registro mantiene estado de entrega, bloqueo temporal, intentos y el payload
original. Dos procesos NestJS no deberían reclamar la misma tarea al mismo tiempo;
los reintentos reutilizan la misma clave idempotente de Resend y el mismo contenido.
El fallo del correo no revierte el pedido ni vuelve a cobrar.

Hay hasta ocho intentos con espera progresiva. Si un resultado anterior tiene más
de 23 horas, se detiene para revisar antes de arriesgar un duplicado fuera de la
ventana de idempotencia del proveedor. `enviado_en` significa que Resend aceptó el
envío; no garantiza llegada a la bandeja de entrada. La entrega/rebotes se consultan
en el panel de Resend; no se agregó un webhook de eventos de correo.

Consulta operativa sin mostrar el contenido del mensaje:

```sql
SELECT pedido_id, intentos, enviado_en, ultimo_error
FROM correos_pedido
ORDER BY creado_en DESC;
```

Los registros con `intentos >= 8` y sin `enviado_en` requieren revisión. No borres
el contenido ni cambies la clave para repetir un envío cuyo resultado sea incierto
sin comprobar antes su estado en Resend.

## Compatibilidad del inventario

El frontend ya no tiene un campo o columna de mínimo ni alertas basadas en él.
Solo distingue disponibles y agotados. La columna física se elimina.
GraphQL conserva temporalmente `stockMinimo`/`stockBajo` como campos obsoletos que
devuelven cero e ignora `stockMinimo` de entradas antiguas. Esto permite actualizar
Render antes de Netlify y conservar pestañas abiertas del frontend anterior;
los valores no se guardan en productos.
