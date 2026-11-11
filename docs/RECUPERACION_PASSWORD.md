# Recuperación de contraseña con Resend

En acceso, «¿Olvidaste tu contraseña?» solicita un código si ya se escribió un
correo válido. Si el campo está vacío, abre `/verificar-correo` para pedirlo.
Después de verificar los seis dígitos, abre `/recuperacion-contrasena` y pide la
contraseña nueva y su confirmación. Al terminar, vuelve al acceso con un aviso.

## Configuración y despliegue

En el backend local (`back/.env`) y en las variables de Render:

```dotenv
RESEND_API_KEY=re_TU_CLAVE
PASSWORD_RESET_FROM=TecnoLeague <cuentas@tu-dominio-verificado.com>
JWT_SECRET=tu_secreto_actual_del_backend
AUTH_BRIDGE_SECRET=tu_secreto_actual_compartido_con_astro
```

El remitente debe pertenecer al dominio verificado de Resend y la clave debe
tener permiso para enviar desde él. No se exponen estas claves en variables
`PUBLIC_*`. Astro debe conservar `BACKEND_GRAPHQL_URL` y el mismo
`AUTH_BRIDGE_SECRET` que el backend. No se necesita un enlace ni `PUBLIC_SITE_URL`
para este correo de códigos.

Tras actualizar el repositorio, aplica la migración antes de iniciar el backend:

```sh
npm run db:generate
npm run db:migrate
npm run build -w back
```

Despliega también el frontend. La migración agrega los campos del código y la
versión de sesión; invalida enlaces de recuperación anteriores, conservando
usuarios, contraseñas y pedidos.

## Comportamiento

- Código aleatorio de seis dígitos, con duración de diez minutos y cinco intentos.
- Reenvío después de un minuto, con máximo de cinco solicitudes por correo/hora.
- Se guarda un HMAC del código y hashes de los permisos; no los valores originales.
- Los correos inexistentes reciben la misma respuesta pública, sin enviar correo.
- Un reenvío invalida el código y permiso anteriores. El cambio es de un solo uso.
- Los permisos se guardan en cookies HttpOnly; el navegador no recibe el token
  de recuperación en JSON ni lo guarda en localStorage o en la URL.
- Tras el cambio, las sesiones de acceso anteriores dejan de ser válidas.
- «Recordar mi correo» guarda únicamente el correo en el dispositivo después de
  acceder. Al desmarcarse se elimina inmediatamente. No guarda la contraseña ni
  controla la duración de la sesión. Un almacenamiento bloqueado no impide entrar.

## Verificación

`npm run test:auth` compila el backend y prueba las pantallas. La integración de
PostgreSQL usa exclusivamente `AUTH_TEST_DATABASE_URL`; nunca toma `DATABASE_URL`
por defecto para crear o eliminar datos de pruebas. Sin esa variable se omite
esa integración. El envío de Resend se simula durante las pruebas; la entrega
real requiere las credenciales y el remitente del despliegue.
