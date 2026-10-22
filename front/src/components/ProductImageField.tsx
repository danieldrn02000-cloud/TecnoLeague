import { useEffect, useId, useRef, useState } from "react";

export function ProductImageField({
  initialImage,
  disabled,
  onUploading,
}: {
  initialImage?: string;
  disabled: boolean;
  onUploading: (uploading: boolean) => void;
}) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const activeRequest = useRef<AbortController | null>(null);
  const [imagen, setImagen] = useState(initialImage || "/images/keyboard.jpg");
  const [subiendo, setSubiendo] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => () => activeRequest.current?.abort(), []);

  async function subir(file: File | undefined) {
    if (!file || disabled || subiendo) return;
    setError("");
    if (
      !/\.(jpe?g|png)$/i.test(file.name) ||
      !["image/jpeg", "image/png"].includes(file.type)
    ) {
      setError("Selecciona una imagen JPG, JPEG o PNG.");
      return;
    }
    if (!file.size || file.size > 5 * 1024 * 1024) {
      setError("Selecciona una imagen de hasta 5 MB.");
      return;
    }
    const controller = new AbortController();
    activeRequest.current = controller;
    setSubiendo(true);
    onUploading(true);
    try {
      const form = new FormData();
      form.set("imagen", file);
      const response = await fetch("/api/admin/imagenes", {
        method: "POST",
        body: form,
        credentials: "same-origin",
        signal: AbortSignal.any([
          controller.signal,
          AbortSignal.timeout(30000),
        ]),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok || typeof body?.imagen !== "string") {
        throw new Error(
          body?.error || "No se pudo subir la imagen. Intenta de nuevo.",
        );
      }
      setImagen(body.imagen);
    } catch (error) {
      if (!controller.signal.aborted)
        setError(
          error instanceof Error
            ? error.message
            : "No se pudo subir la imagen.",
        );
    } finally {
      if (!controller.signal.aborted) {
        setSubiendo(false);
        onUploading(false);
      }
      activeRequest.current = null;
    }
  }

  return (
    <div className="product-image-field">
      <label htmlFor={id}>Imagen</label>
      <input
        id={id}
        name="imagen"
        required
        maxLength={1000}
        value={imagen}
        onChange={(event) => setImagen(event.target.value)}
        disabled={disabled || subiendo}
        placeholder="/images/archivo.jpg o URL HTTPS"
      />
      <input
        ref={input}
        type="file"
        aria-label="Seleccionar imagen del producto"
        hidden
        accept=".jpg,.jpeg,.png,image/jpeg,image/png"
        disabled={disabled || subiendo}
        onChange={(event) => {
          void subir(event.target.files?.[0]);
          event.target.value = "";
        }}
      />
      <button
        type="button"
        className="btn btn-secondary"
        disabled={disabled || subiendo}
        onClick={() => input.current?.click()}
      >
        {subiendo ? "Subiendo imagen…" : "Añadir imagen"}
      </button>
      <small>JPG, JPEG o PNG. Máximo 5 MB.</small>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {imagen.startsWith("/images/uploads/") && (
        <img
          src={imagen}
          alt="Vista previa del producto"
          width={160}
          height={120}
          style={{ objectFit: "contain" }}
        />
      )}
    </div>
  );
}
