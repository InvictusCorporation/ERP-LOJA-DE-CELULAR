"use client";
import { useId, useState } from "react";
import { Camera, Package, Smartphone, Upload, X } from "lucide-react";

export function ProductImage({
  product,
  className = "",
}: {
  product: Record<string, any>;
  className?: string;
}) {
  const [failed, setFailed] = useState("");
  return (
    <div className={`store-product-image ${className}`}>
      {product.image_data && failed !== product.image_data ? (
        <img
          src={product.image_data}
          alt={product.name || product.product_name || "Produto"}
          loading="lazy"
          width={280}
          height={240}
          onError={() => setFailed(product.image_data)}
        />
      ) : (
        <div className="store-image-placeholder">
          {product.serialized ? (
            <Smartphone size={44} />
          ) : (
            <Package size={40} />
          )}
          <small>Sem foto</small>
        </div>
      )}
    </div>
  );
}
export function ProductPhotoField({
  initialValue = "",
}: {
  initialValue?: string;
}) {
  const id = useId(),
    [image, setImage] = useState(initialValue),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  async function read(file?: File) {
    if (!file) return;
    setError("");
    setBusy(true);
    try {
      if (
        !["image/jpeg", "image/png", "image/webp"].includes(file.type) ||
        file.size > 8 * 1024 * 1024
      )
        throw Error("Escolha uma foto PNG, JPEG ou WebP de até 8 MB.");
      const bitmap = await createImageBitmap(file);
      try {
        const ratio = Math.min(1, 600 / Math.max(bitmap.width, bitmap.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(bitmap.width * ratio));
        canvas.height = Math.max(1, Math.round(bitmap.height * ratio));
        canvas
          .getContext("2d")!
          .drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        const value = canvas.toDataURL("image/webp", 0.7);
        if (value.length > 106000)
          throw Error("Foto muito detalhada. Escolha uma imagem menor.");
        setImage(value);
      } finally {
        bitmap.close();
      }
    } catch (e: any) {
      setError(e.message || "Não foi possível carregar a foto.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="field product-photo-field">
      <label htmlFor={id}>Foto do produto</label>
      <input type="hidden" name="image_data" value={image} />
      <div className="photo-editor">
        <ProductImage
          product={{ image_data: image, name: "Prévia do produto" }}
        />
        <div>
          <label className="secondary photo-upload" htmlFor={id}>
            <Upload size={16} /> {busy ? "Preparando foto…" : "Escolher foto"}
          </label>
          <input
            id={id}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            disabled={busy}
            onChange={(e) => void read(e.target.files?.[0])}
          />
          <small>
            <Camera size={13} /> PNG, JPEG ou WebP. A foto é reduzida antes de
            salvar.
          </small>
          {image && (
            <button
              type="button"
              className="text-button"
              onClick={() => setImage("")}
            >
              <X size={14} /> Remover foto
            </button>
          )}
        </div>
      </div>
      {error && <small role="alert">{error}</small>}
    </div>
  );
}
