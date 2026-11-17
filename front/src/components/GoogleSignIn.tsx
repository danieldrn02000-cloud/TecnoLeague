import { useEffect, useRef, useState, type FormEvent } from "react";

//Se muestra el botón oficial, recibimiento de la credencial de google y coordina las solicitudes a Astro

//Descripción del SDK
type Identity = {
  //se declaran initialize y render button, que son los metodos que utiliza el SDK¿
  initialize(options: {
    client_id: string;
    nonce: string;
    auto_select: boolean;
    callback: (response: { credential: string }) => void;
  }): void;
  
  renderButton(
    container: HTMLElement,
    options: Record<string, string | number>,
  ): void;
};

declare global {
  //se informa a typeScript de que el script de google puede agregar window.google
  //esta declaración solamente describe el objeto, el script externo es quin lo crea
  interface Window {
    google?: { accounts: { id: Identity } };
  }
}
let carga: Promise<Identity> | undefined;

//descarga el script oficial
function cargarGoogle() {
  //si ya existe una cuenta, devuelve ese objeto
  if (window.google?.accounts.id)
    return Promise.resolve(window.google.accounts.id);
  
  //si el script ya se está cargando, reutiliza la promeda guardada en carga
  //si todavia no se ha solicitado, crea una etiqueta script y la agrega al cocumento
  return (carga ??= new Promise<Identity>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    
    const fallo = () => {
      script.remove();
      carga = undefined;
      reject(new Error());
    };

    script.onerror = fallo;
    script.onload = () =>  window.google?.accounts.id ? resolve(window.google.accounts.id) : fallo();
    document.head.appendChild(script);
  }));
}

//Se conecta el componente con AuthForm mediante las propiedades
export function GoogleSignIn({
  next,
  disabled,
  onBusy,
}: {
  next: string; //dirección a la que se navegará después de iniciar sesión, ej: a checkout
  disabled: boolean; //indica que el formulario padre está procesando una operación
  onBusy: (value: boolean) => void; //permite bloquear el formulario mientras se verifica Google
}) {
  const clientId = import.meta.env.PUBLIC_GOOGLE_CLIENT_ID?.trim(); //obtiene cliente id de .env

  const boton = useRef<HTMLDivElement>(null); //identifica el contenedor donde google dibuja su botón
  const activo = useRef(false); //permite descartar respuestas cuadno el componente ya se desmontó
  const ocupado = useRef(false); //bloquea inmediatamente un segundo envío
  const bloqueado = useRef(disabled); //conserva el valor actual de disabled 

  bloqueado.current = disabled; //bloqueo falso
  const avisar = useRef(onBusy);//avisar conserva la función onBusy actual
  avisar.current = onBusy; 

  //se utilizan useState para datos que cambian lo que se ve en pantalla
  const [error, setError] = useState(""); //msj q verá el usuario
  const [credential, setCredential] = useState(""); //credencial conservado temporalmente mientras se confirma una vinculación
  const [revision, setRevision] = useState(0); //contador que permite reiniciar la preparación
  const [listo, setListo] = useState(false); //indica que el SDK ya dibujó el botón

  //Envio de credencial a Astro recibe toke y contraseña si hay
  async function acceder(token: string, password?: string) {
    //si no está activo, o bloqueado u ocupado se retorna
    if (!activo.current || ocupado.current || bloqueado.current) return;
    
    ocupado.current = true;
    avisar.current(true);
    setError("");
    
    try {
      const response = await fetch("/api/auth/google", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          credential: token,
          ...(password ? { password } : {}),
        }),
        signal: AbortSignal.timeout(20000),
      });
      const body = await response.json();
      if (!activo.current) return;
    
      //si la respuesta es correcta nos vamos a la siguiente pagina
      if (response.ok) {
        setCredential("");
        window.location.replace(next);
        return;
      }
    
      setCredential(body.code === "GOOGLE_LINK_REQUIRED" ? token : "");//conserva la credencial y muestra el formulario de contraseña
      setError(body.error || "No pudimos iniciar sesión con Google.");
    } catch {
      if (activo.current) {
        setCredential("");
        setError("No pudimos conectar con Google. Inténtalo de nuevo.");
      }
    } finally {
      //finalmente se quitan los bloqueos
      ocupado.current = false;
      if (activo.current) avisar.current(false);
    }
  }

  //preparación del componente 
  useEffect(() => {
    activo.current = true;
    let vigente = true;
    const abort = new AbortController();
    setListo(false);
    boton.current?.replaceChildren();
    
    //se solicita a astro preparar 
    async function preparar() {
      try {
        //response espera un nonce, un valor que identifica esta preparación del acceso
        const response = await fetch("/api/auth/google", {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ accion: "preparar" }),
          signal: AbortSignal.any([abort.signal, AbortSignal.timeout(15000)]),
        });
    
        const body = await response.json(); //conversion de json
        if (!response.ok || !body.nonce) throw new Error();

        const google = await cargarGoogle(); //se carga google
        if (!vigente || !boton.current) return;

        //se configura google
        google.initialize({
          client_id: clientId!,
          nonce: body.nonce,
          auto_select: false, //desactiva la selccion automatica de cuenta

          //función que google ejecutará cuando entregue la credenciañ
          callback: ({ credential }) => { 
            if (vigente) void acceder(credential);
          },
        });
        boton.current.replaceChildren();
    
        //se dibuja el botón oficial dentro del contentendor 
        google.renderButton(boton.current, {
          type: "standard",
          theme: "outline",
          size: "large",
          text: "continue_with",
          locale: "es",
          width: 280,
        });
        setListo(true);

      } catch {
        if (vigente)
          setError(
            "El acceso con Google no está disponible. Puedes entrar con correo y contraseña.",
          );
      }
    }
    
    if (clientId) void preparar();
    return () => {
      activo.current = false;
      vigente = false;
      abort.abort();
    };
  }, [clientId, revision]);

  if (!clientId) return null;
  
  const reiniciar = () => {
    setCredential("");
    setError("");
    setRevision((n) => n + 1);
  };
  
  //confirma una cuenta existente, se muestra el formulario de contraseña
  function vincular(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    //obtiene la contraseña que ingrese el usuario
    const form = event.currentTarget;
    const password = String(new FormData(form).get("googlePassword") || "");
    
    form.reset();
    void acceder(credential, password);
  }
  
  return (
    <div className="google-access">
      <p className="muted">O continúa con tu cuenta de Google</p>

      <div ref={boton} inert={disabled || !!credential} />
      {!listo && !error && <p role="status">Cargando Google…</p>}
      {error && (
        <p className="auth-error" role="alert">
          {error}
        </p>
      )}
      {credential && (
        <form className="auth-form" onSubmit={vincular}>
          <label>
            Contraseña actual de TecnoLeague
            <input
              name="googlePassword"
              type="password"
              autoComplete="current-password"
              required
              maxLength={128}
              disabled={disabled}
            />
          </label>
          <button className="btn full" disabled={disabled}>
            Confirmar y vincular Google
          </button>
        
          <a href="/verificar-correo">¿Olvidaste tu contraseña?</a>
        </form>
      )}
  
      {(error || credential) && (
        <button
          type="button"
          className="text-btn"
          disabled={disabled}
          onClick={reiniciar}
        >
          {credential ? "Usar otra cuenta de Google" : "Reintentar con Google"}
        </button>
      )}
    </div>
  );
}
