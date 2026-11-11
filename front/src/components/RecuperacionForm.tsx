import { useEffect, useRef, useState, type FormEvent } from "react";

export function RecuperacionForm({
  modo,
  emailInicial = "",
  codigoEnviado = false,
}: {
  modo: "codigo" | "password";
  emailInicial?: string;
  codigoEnviado?: boolean;
}) {
  const [email, setEmail] = useState(emailInicial);
  const [enviado, setEnviado] = useState(codigoEnviado);
  const [error, setError] = useState("");
  const [aviso, setAviso] = useState("");
  const [espera, setEspera] = useState(codigoEnviado ? 60 : 0);
  const [busy, setBusy] = useState(false);
  const bloqueado = useRef(false);
  useEffect(() => {
    if (!espera) return;
    const timer = setTimeout(() => setEspera((n) => Math.max(0, n - 1)), 1000);
    return () => clearTimeout(timer);
  }, [espera]);

  async function solicitar() {
    if (bloqueado.current) return;
    bloqueado.current = true;
    setBusy(true);
    setError("");
    setAviso("");

    try {
      const response = await fetch("/api/auth/recuperacion", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accion: "solicitar", email }),
        credentials: "same-origin",
      });
      const body = await response.json();

      if (!response.ok) {
        setError(body.error ?? "No pudimos enviar el código.");
        return;
      }
      setEnviado(true);
      setEspera(60);
      setAviso(
        "Si hay una cuenta con ese correo, recibirás un código. Revisa también la carpeta de correo no deseado.",
      );
    } catch {
      setError("No pudimos enviar el código. Inténtalo en unos momentos.");
    } finally {
      bloqueado.current = false;
      setBusy(false);
    }
  }

  async function enviar(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (bloqueado.current) return;
    if (modo === "codigo" && !enviado) {
      await solicitar();
      return;
    }

    const form = new FormData(event.currentTarget);
    const password = String(form.get("password") ?? "");
    const confirmPassword = String(form.get("confirmPassword") ?? "");

    if (modo === "password" && password !== confirmPassword) {
      setError("Las contraseñas no coinciden.");
      return;
    }
    bloqueado.current = true;
    setBusy(true);
    setError("");

    try {
      const response = await fetch("/api/auth/recuperacion", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          modo === "password"
            ? { accion: "restablecer", password, confirmPassword }
            : { accion: "verificar", codigo: String(form.get("codigo") ?? "") },
        ),
      });

      const body = await response.json();
      if (!response.ok) {
        setError(body.error ?? "No pudimos completar la recuperación.");
        return;
      }
      window.location.assign(
        modo === "password"
          ? "/iniciar-sesion?reason=recuperada"
          : "/recuperacion-contrasena",
      );
    } catch {
      setError(
        "No pudimos completar la solicitud. Inténtalo en unos momentos.",
      );
    } finally {
      bloqueado.current = false;
      setBusy(false);
    }
  }
  return (
    <main className="auth-page">
      <section className="auth-intro">
        <a className="auth-back" href="/iniciar-sesion">
          ← Volver a iniciar sesión
        </a>
        <span className="eyebrow">TECNOLEAGUE / CUENTA</span>
        <h1>
          {modo === "password"
            ? "Recuperación de contraseña"
            : "Recupera tu cuenta"}
        </h1>
        <p>
          {modo === "password"
            ? "Elige una contraseña nueva para proteger tu cuenta."
            : "Te ayudaremos a volver a entrar con un código enviado a tu correo."}
        </p>
      </section>

      <section
        className="auth-panel panel"
        aria-labelledby="recuperacion-titulo"
      >
        <h2 id="recuperacion-titulo">
          {modo === "password"
            ? "Crea tu nueva contraseña"
            : enviado
              ? "Verifica tu correo"
              : "¿Cuál es tu correo?"}
        </h2>
        {enviado && modo === "codigo" && (
          <p>
            Si tu correo está registrado, recibirás un código de seis dígitos.
            Vence en 10 minutos.
          </p>
        )}
        <form className="auth-form" onSubmit={enviar}>
          {modo === "password" ? (
            <>
              <label>
                Nueva contraseña
                <input
                  name="password"
                  type="password"
                  autoComplete="new-password"
                  minLength={8}
                  maxLength={128}
                  required
                />
              </label>
              <label>
                Confirmar nueva contraseña
                <input
                  name="confirmPassword"
                  type="password"
                  autoComplete="new-password"
                  minLength={8}
                  maxLength={128}
                  required
                />
              </label>
              <p>Usa entre 8 y 128 caracteres.</p>
            </>
          ) : enviado ? (
            <label>
              Código de seis dígitos
              <input
                name="codigo"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]{6}"
                minLength={6}
                maxLength={6}
                required
                placeholder="123456"
              />
            </label>
          ) : (
            <label>
              Correo electrónico
              <input
                name="email"
                type="email"
                autoComplete="email"
                required
                maxLength={150}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </label>
          )}
          {error && (
            <p className="auth-error" role="alert">
              {error}
            </p>
          )}
          {aviso && <p role="status">{aviso}</p>}
          <button className="btn full" disabled={busy} type="submit">
            {busy
              ? "Espera un momento…"
              : modo === "password"
                ? "Guardar nueva contraseña"
                : enviado
                  ? "Verificar código"
                  : "Enviar código"}
          </button>
        </form>
        {modo === "codigo" && enviado && (
          <div className="auth-options">
            <button
              type="button"
              className="text-btn"
              disabled={busy || espera > 0}
              onClick={() => void solicitar()}
            >
              {espera ? `Reenviar código en ${espera} s` : "Reenviar código"}
            </button>
            <button
              type="button"
              className="text-btn"
              disabled={busy}
              onClick={() => {
                setEnviado(false);
                setError("");
                setAviso("");
              }}
            >
              Cambiar correo
            </button>
          </div>
        )}
      </section>
    </main>
  );
}
