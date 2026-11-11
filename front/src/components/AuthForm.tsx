import { useEffect, useState, type FormEvent } from "react";
import { ArrowRight, KeyRound, Mail, UserRound } from "lucide-react";

export function AuthForm({
  mode,
  next,
  notice = "",
}: {
  mode: "registro" | "login";
  next: string;
  notice?: string;
}) {
  const registro = mode === "registro";
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [email, setEmail] = useState("");
  const [recordar, setRecordar] = useState(false);

  useEffect(() => {
    try {
      const guardado = localStorage.getItem("tl_email_recordado");
      if (guardado && !registro) { setEmail(guardado); setRecordar(true); }
    } catch { /* El acceso sigue funcionando si el navegador bloquea el almacenamiento. */ }
  }, [registro]);

  async function recuperar() {
    if (busy) return;

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) { window.location.assign("/verificar-correo"); return; }
    setBusy(true); setError("");
    
    try {
      const response = await fetch("/api/auth/recuperacion", {
        method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accion: "solicitar", email: email.trim() }),
      });
    
      const resultado = await response.json();
      if (!response.ok) { setError(resultado.error ?? "No pudimos enviar el código."); return; }
      window.location.assign("/verificar-correo");
    } catch { setError("No pudimos enviar el código. Inténtalo en unos momentos."); }
    finally { setBusy(false); }
  }

  async function enviar(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const form = new FormData(event.currentTarget);
    const password = String(form.get("password") ?? "");
    
    if (
      registro &&
      password !== String(form.get("confirmPassword") ?? "")
    ) {
      setError("Las contraseñas no coinciden.");
      return;
    }
    setBusy(true);
    setError("");
    
    const datos: Record<string, string> = {
      email: String(form.get("email") ?? "").trim(),
      password,
    };
    //obtiene registro
    if (registro) datos.nombre = String(form.get("nombre") ?? "").trim();

    //manda solicitud POST al backend, dependiendo si es registro o no
    try {
      const response = await fetch(
        registro ? "/api/auth/register" : "/api/auth/login",
        {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(datos),
        },
      );
      //convierte la respuesta de json a JS
      const result = (await response.json().catch(() => null)) as
        | { error?: string }
        | null;
      //obtiene error de respuesta
      if (!response.ok) {
        setError(result?.error ?? "No se pudo validar la cuenta.");
        return;
      }
      //esta opcion es para recordar
      if (!registro) {
        try {
          if (recordar) localStorage.setItem("tl_email_recordado", datos.email);
          else localStorage.removeItem("tl_email_recordado");
        } catch { /* No impedir una sesión válida por un fallo de almacenamiento. */ }
      }
      //indica 
      window.location.replace(next);
    } catch {
      setError("No se pudo conectar con el servidor. Intenta de nuevo.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="auth-page">
      <section className="auth-intro">
        <a className="auth-back" href="/">
          <span aria-hidden="true">←</span> Volver a la tienda
        </a>

        <span className="eyebrow">TECNOLEAGUE / CUENTA</span>
        <h1>{registro ? "Crea tu cuenta." : "Qué bueno verte."}</h1>
        <p>
          {registro
            ? "Guarda tus datos y consulta aquí el historial de tus compras."
            : "Entra para continuar con tu compra y consultar tus pedidos."}
        </p>
      </section>
      
      <section className="auth-panel panel" aria-labelledby="auth-title">
        <div className="auth-heading">
          <span className="auth-symbol" aria-hidden="true">
            {registro ? <UserRound size={20} /> : <KeyRound size={20} />}
          </span>
          <div>
            <span className="eyebrow">ACCESO SEGURO</span>
            <h2 id="auth-title">
              {registro ? "Registro" : "Iniciar sesión"}
            </h2>
          </div>
        </div>

        {notice && <p className="auth-notice">{notice}</p>}
        <form className="auth-form" onSubmit={enviar}>
          {registro && (
            <label>
              Nombre completo
              <input
                name="nombre"
                autoComplete="name"
                required
                minLength={2}
                maxLength={120}
                placeholder="Tu nombre"
              />
            </label>
          )}
          <label>
            Correo electrónico
            <span className="auth-input-wrap">
              <Mail size={17} aria-hidden="true" />
              <input
                name="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                required
                maxLength={150}
                placeholder="tu@correo.com"
              />
            </span>
          </label>
          <label>
            Contraseña
            <span className="auth-input-wrap">
              <KeyRound size={17} aria-hidden="true" />
              <input
                name="password"
                type="password"
                autoComplete={registro ? "new-password" : "current-password"}
                required
                minLength={registro ? 8 : undefined}
                maxLength={128}
                placeholder={registro ? "Mínimo 8 caracteres" : "Tu contraseña"}
              />
            </span>
          </label>

          {registro && (
            <label>
              Confirmar contraseña
              <span className="auth-input-wrap">
                <KeyRound size={17} aria-hidden="true" />
                <input
                  name="confirmPassword"
                  type="password"
                  autoComplete="new-password"
                  required
                  minLength={8}
                  maxLength={128}
                  placeholder="Repite tu contraseña"
                />
              </span>
            </label>
          )}

          {error && (
            <p className="auth-error" role="alert">
              {error}
            </p>
          )}

          {!registro && (
            <div className="auth-options">
              <button type="button" className="text-btn" disabled={busy} onClick={() => void recuperar()}>¿Olvidaste tu contraseña?</button>
            </div>
          )}
          
          <button className="btn full" type="submit" disabled={busy}>
            {busy
              ? registro
                ? "Creando cuenta…"
                : "Verificando…"
              : registro
                ? "Crear cuenta"
                : "Iniciar sesión"}
            <ArrowRight size={17} />
          </button>
        </form>
        <p className="auth-switch">
          {registro ? "¿Ya tienes una cuenta?" : "¿Todavía no tienes cuenta?"}{" "}
          <a
            href={`${registro ? "/iniciar-sesion" : "/registro"}?next=${encodeURIComponent(next)}`}
          >
            {registro ? "Inicia sesión" : "Regístrate"}
          </a>
        </p>
      </section>
    </main>
  );
}
