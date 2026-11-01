"use client";
import { useEffect, useId, useRef, useState } from "react";
import { Camera, ScanBarcode, X } from "lucide-react";
import "./product-fields.css";

export function ProductStockControl({ individual }: { individual: boolean }) {
  const id = useId();
  return (
    <div className="field product-stock-control">
      <label htmlFor={id}>Controle de estoque do produto</label>
      <select
        id={id}
        name="stock_control"
        defaultValue={individual ? "individual" : "quantity"}
      >
        <option value="quantity">Produto por quantidade</option>
        <option value="individual">
          Produto com controle individual — IMEI ou série
        </option>
      </select>
      <small>
        Cadastre qualquer produto. Escolha quantidade para controlar o saldo ou
        controle individual para identificar e rastrear cada unidade.
      </small>
    </div>
  );
}

export default function ProductBarcode({
  initialValue = "",
}: {
  initialValue?: string;
}) {
  const id = useId(),
    input = useRef<HTMLInputElement>(null),
    video = useRef<HTMLVideoElement>(null);
  const [value, setValue] = useState(initialValue || ""),
    [camera, setCamera] = useState(false);
  const [message, setMessage] = useState(""),
    [error, setError] = useState("");
  useEffect(() => {
    if (!camera || !video.current) return;
    const preview = video.current;
    let alive = true,
      found = false,
      controls: { stop: () => void } | undefined;
    let ownedStream: MediaStream | undefined;
    const stopMedia = () => {
      ownedStream?.getTracks().forEach((track) => track.stop());
      const stream = preview.srcObject as MediaStream | null;
      stream?.getTracks().forEach((track) => track.stop());
      preview.srcObject = null;
    };
    void (async () => {
      try {
        if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia)
          throw new Error(
            "A câmera precisa de HTTPS ou localhost. Você também pode usar um leitor ou digitar o código.",
          );
        const { BrowserMultiFormatOneDReader } = await import("@zxing/browser");
        if (!alive) return;
        const reader = new BrowserMultiFormatOneDReader();
        ownedStream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            facingMode: { ideal: "environment" },
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
        });
        if (!alive) {
          stopMedia();
          return;
        }
        controls = await reader.decodeFromStream(
          ownedStream,
          preview,
          (result, _error, control) => {
            if (!alive || found) {
              if (!alive) control.stop();
              return;
            }
            if (!result) return;
            const code = result.getText().trim();
            if (!code || code.length > 80 || /[\x00-\x1f\x7f]/.test(code))
              return;
            found = true;
            control.stop();
            stopMedia();
            setValue(code);
            setCamera(false);
            setMessage(
              "Código capturado. Complete os dados e salve o produto.",
            );
            input.current?.focus();
          },
        );
        if (!alive) {
          controls.stop();
          stopMedia();
        }
      } catch (e: any) {
        stopMedia();
        if (!alive) return;
        const text =
          e?.name === "NotAllowedError"
            ? "Acesso à câmera não permitido. Autorize no navegador ou use um leitor ou a digitação."
            : e?.name === "NotFoundError"
              ? "Nenhuma câmera encontrada. Use um leitor de código de barras ou digite o código."
              : e?.name === "NotReadableError"
                ? "A câmera está ocupada ou indisponível. Feche outros aplicativos ou use um leitor."
                : e?.message ||
                  "Não foi possível abrir a câmera. Use um leitor ou digite o código.";
        setError(text);
        setCamera(false);
      }
    })();
    return () => {
      alive = false;
      controls?.stop();
      stopMedia();
    };
  }, [camera]);
  return (
    <div className="field product-barcode">
      <label htmlFor={id}>Código de barras</label>
      <div className="product-barcode-input">
        <input
          id={id}
          ref={input}
          name="barcode"
          value={value}
          maxLength={80}
          autoComplete="off"
          placeholder="Escaneie a embalagem ou digite o código"
          onChange={(e) => {
            setValue(e.target.value);
            setMessage("");
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              setMessage(
                value
                  ? "Código recebido do leitor. Complete os dados e salve o produto."
                  : "Aponte o leitor para o código da embalagem.",
              );
            }
          }}
        />
        <button
          type="button"
          className="secondary small"
          onClick={() => {
            setCamera(false);
            setError("");
            setMessage(
              "Aponte o leitor conectado para a embalagem. O código aparecerá neste campo.",
            );
            input.current?.focus();
            input.current?.select();
          }}
        >
          <ScanBarcode size={17} /> Usar leitor
        </button>
        <button
          type="button"
          className="secondary small"
          onClick={() => {
            setError("");
            setMessage("");
            setCamera((v) => !v);
          }}
        >
          {camera ? <X size={17} /> : <Camera size={17} />}{" "}
          {camera ? "Fechar câmera" : "Escanear com câmera"}
        </button>
      </div>
      <small>
        A leitura preenche o código da embalagem. Informe nome, categoria e
        preços antes de salvar. A imagem da câmera é processada neste navegador.
      </small>
      {camera && (
        <div className="product-camera">
          <video
            ref={video}
            autoPlay
            muted
            playsInline
            aria-label="Câmera para ler código do produto"
          />
          <p>
            Aponte a câmera para o código de barras e mantenha a embalagem
            iluminada e estável.
          </p>
        </div>
      )}
      {message && (
        <p className="product-scan-message" role="status">
          {message}
        </p>
      )}
      {error && (
        <p className="product-scan-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
