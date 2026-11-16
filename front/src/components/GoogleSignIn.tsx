import { useEffect, useRef, useState, type FormEvent } from "react";

type Identity = {
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
  interface Window {
    google?: { accounts: { id: Identity } };
  }
}
let carga: Promise<Identity> | undefined;
function cargarGoogle() {
  if (window.google?.accounts.id)
    return Promise.resolve(window.google.accounts.id);
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
    script.onload = () =>
      window.google?.accounts.id ? resolve(window.google.accounts.id) : fallo();
    document.head.appendChild(script);
  }));
}

export function GoogleSignIn({
  next,
  disabled,
  onBusy,
}: {
  next: string;
  disabled: boolean;
  onBusy: (value: boolean) => void;
}) {
  const clientId = import.meta.env.PUBLIC_GOOGLE_CLIENT_ID?.trim();
  const boton = useRef<HTMLDivElement>(null);
  const activo = useRef(false);
  const ocupado = useRef(false);
  const bloqueado = useRef(disabled);
  bloqueado.current = disabled;
  const avisar = useRef(onBusy);
  avisar.current = onBusy;
  const [error, setError] = useState("");
  const [credential, setCredential] = useState("");
  const [revision, setRevision] = useState(0);
  const [listo, setListo] = useState(false);

  async function acceder(token: string, password?: string) {
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
      if (response.ok) {
        setCredential("");
        window.location.replace(next);
        return;
      }
      setCredential(body.code === "GOOGLE_LINK_REQUIRED" ? token : "");
      setError(body.error || "No pudimos iniciar sesión con Google.");
    } catch {
      if (activo.current) {
        setCredential("");
        setError("No pudimos conectar con Google. Inténtalo de nuevo.");
      }
    } finally {
      ocupado.current = false;
      if (activo.current) avisar.current(false);
    }
  }

  useEffect(() => {
    activo.current = true;
    let vigente = true;
    const abort = new AbortController();
    setListo(false);
    boton.current?.replaceChildren();
    async function preparar() {
      try {
        const response = await fetch("/api/auth/google", {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ accion: "preparar" }),
          signal: AbortSignal.any([abort.signal, AbortSignal.timeout(15000)]),
        });
        const body = await response.json();
        if (!response.ok || !body.nonce) throw new Error();
        const google = await cargarGoogle();
        if (!vigente || !boton.current) return;
        google.initialize({
          client_id: clientId!,
          nonce: body.nonce,
          auto_select: false,
          callback: ({ credential }) => {
            if (vigente) void acceder(credential);
          },
        });
        boton.current.replaceChildren();
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
  function vincular(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
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
