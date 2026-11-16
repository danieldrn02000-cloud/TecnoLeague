# Acceso con Google

Se conserva el acceso por contraseña y la sesión propia de TecnoLeague. El botón
oficial aparece en registro e inicio de sesión cuando se configura el Client ID.

1. En https://console.cloud.google.com/ selecciona o crea un proyecto y abre
   **Google Auth Platform**. Configura la marca, el correo de contacto y el público
   externo. Agrega tus usuarios de prueba si corresponde al estado del proyecto.
2. En **Clientes → Crear cliente → Aplicación web**, registra estos orígenes de
   JavaScript (sin rutas): `http://localhost:5173`, `http://127.0.0.1:5173` y
   `https://TU-SITIO.netlify.app`. Agrega tu dominio propio si lo utilizas.
   Los túneles necesitan registrar su origen HTTPS exacto. No hace falta registrar
   Render como origen del botón ni configurar una URI de redirección para este
   flujo con ventana emergente y callback JavaScript.
3. Copia el Client ID terminado en `.apps.googleusercontent.com`. Usa el mismo en
   `PUBLIC_GOOGLE_CLIENT_ID` de `front/.env` y Netlify (Builds), y en
   `GOOGLE_CLIENT_ID` de `back/.env` y Render. No se necesita API key, Client Secret,
   acceso a Gmail ni a Drive. Conserva `AUTH_BRIDGE_SECRET` y `JWT_SECRET` existentes.
4. Ejecuta `npm ci`, `npm run db:generate` y `npm run db:migrate`. La migración
   `202611160001_google_identity` agrega un identificador de Google opcional y único;
   conserva los usuarios, contraseñas, permisos y pedidos existentes.
5. Reinicia el backend y vuelve a desplegar Netlify para incorporar su variable
   pública. Prueba registro con Google, cierre de sesión y acceso posterior.

NestJS verifica la firma, emisor, destinatario y vigencia del ID token con la
biblioteca oficial de Google. También exige correo verificado y el nonce que
Astro generó para ese navegador (cookie HttpOnly de diez minutos). La mutación
solo admite el puente de autenticación servidor-servidor. El JWT propio de la
tienda permanece en la cookie HttpOnly de siete días; nunca llega al código React.

Una cuenta nueva recibe siempre el rol CLIENTE. Si ya existe el correo, el usuario
debe confirmar su contraseña de TecnoLeague para vincular Google: tener un correo
coincidente no basta. Si olvidó la contraseña puede usar la recuperación por correo
y volver a intentarlo. La vinculación conserva ID, rol y pedidos, y no reemplaza la
contraseña. Después se identifica al usuario por el `sub` estable de Google, aunque
cambie el correo en Google. Las cuentas creadas solo con Google también pueden
establecer una contraseña usando la recuperación por correo existente.

Sin Client ID en el frontend no se carga Google ni se muestra su botón. Configurar
las variables y los orígenes en las cuentas de Google/Netlify/Render es un paso
externo al repositorio; no requiere compartir secretos en el chat.
