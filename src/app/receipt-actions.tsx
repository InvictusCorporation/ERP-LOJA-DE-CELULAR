"use client";
import { useState } from "react";
import { Printer, Download, MessageCircle, X, Copy } from "lucide-react";
import { receiptText, receiptWhatsAppUrl } from "../shared/pos-receipt";
type Row = Record<string, any>;
export default function ReceiptActions({
  receipt,
  canContact,
  onNotice,
}: {
  receipt: Row;
  canContact: boolean;
  onNotice: (message: string, error?: boolean) => void;
}) {
  const [contact, setContact] = useState<Row | null>(null),
    [phone, setPhone] = useState(""),
    [text, setText] = useState(""),
    [confirmed, setConfirmed] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  function download() {
    const url = URL.createObjectURL(
      new Blob([receiptText(receipt)], { type: "text/plain;charset=utf-8" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = `comprovante-${receipt.sale.id}.txt`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async function prepare() {
    if (busy) return;
    setBusy(true);
    setError("");
    setConfirmed(false);
    setContact(null);
    try {
      const read = async (path: string) => {
        const r = await fetch("/api" + path, { cache: "no-store" });
        const d = await r.json();
        if (!r.ok) throw Error(d.error);
        return d;
      };
      const [current, destination] = await Promise.all([
        read(`/pos/sales/${receipt.sale.id}`),
        read(`/pos/sales/${receipt.sale.id}/receipt-contact`),
      ]);
      setText(receiptText(current));
      setContact(destination);
      setPhone(destination.phone || "");
    } catch (e: any) {
      onNotice(e.message || "Não foi possível preparar o comprovante.", true);
    } finally {
      setBusy(false);
    }
  }
  let href = "";
  try {
    if (contact?.state !== "blocked" && text.length <= 12000)
      href = receiptWhatsAppUrl(phone, text);
  } catch {}
  return (
    <>
      <button
        type="button"
        className="secondary"
        onClick={() => window.print()}
      >
        <Printer size={16} /> Imprimir
      </button>
      <button type="button" className="secondary" onClick={download}>
        <Download size={16} /> Baixar comprovante
      </button>
      {canContact && (
        <button
          type="button"
          className="secondary"
          disabled={busy}
          onClick={() => void prepare()}
        >
          <MessageCircle size={16} />{" "}
          {busy ? "Preparando…" : "Enviar pelo WhatsApp"}
        </button>
      )}
      {contact && (
        <section
          className="pos-whatsapp-preview"
          role="region"
          aria-label="Conferir comprovante para WhatsApp"
        >
          <header>
            <h3>Comprovante pelo WhatsApp</h3>
            <button
              type="button"
              className="icon-button"
              aria-label="Fechar prévia do WhatsApp"
              onClick={() => setContact(null)}
            >
              <X size={17} />
            </button>
          </header>
          {contact.state === "blocked" ? (
            <p role="alert">{contact.reason}</p>
          ) : (
            <>
              <label>
                WhatsApp do cliente
                <input
                  aria-label="WhatsApp do cliente"
                  autoFocus
                  inputMode="tel"
                  autoComplete="off"
                  maxLength={30}
                  placeholder="DDD + número ou +código do país"
                  value={phone}
                  readOnly={contact.state === "ready"}
                  onChange={(e) => {
                    setPhone(e.target.value);
                    setConfirmed(false);
                  }}
                />
              </label>
              {contact.state === "ready" && (
                <p>
                  Telefone atual de {contact.name}. Para corrigir, atualize o
                  cadastro do cliente.
                </p>
              )}
              {contact.state === "manual" && (
                <p>
                  Esta venda não tem cliente vinculado. Informe o número
                  solicitado pelo cliente apenas para este comprovante; ele não
                  será salvo no cadastro.
                </p>
              )}
              <label>
                Mensagem do comprovante
                <textarea
                  aria-label="Mensagem do comprovante"
                  readOnly
                  value={text}
                  rows={9}
                />
              </label>
              <label className="check-label">
                <input
                  type="checkbox"
                  checked={confirmed}
                  onChange={(e) => setConfirmed(e.target.checked)}
                />{" "}
                Conferi o destinatário e o cliente solicitou este comprovante
                por WhatsApp.
              </label>
              {text.length > 12000 ? (
                <p>
                  Comprovante extenso. Baixe o arquivo e anexe manualmente no
                  WhatsApp.
                </p>
              ) : (
                !href && <p>Informe um número válido para preparar o envio.</p>
              )}
              <div className="pos-whatsapp-buttons">
                <button
                  type="button"
                  className="secondary"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(text);
                      onNotice("Texto do comprovante copiado.");
                    } catch {
                      setError("Selecione e copie o texto da prévia.");
                    }
                  }}
                >
                  <Copy size={15} /> Copiar comprovante
                </button>
                {confirmed && href ? (
                  <a
                    className="primary"
                    href={href}
                    target="_blank"
                    rel="noopener noreferrer"
                    referrerPolicy="no-referrer"
                  >
                    Abrir WhatsApp com comprovante
                  </a>
                ) : (
                  <button type="button" className="primary" disabled>
                    Abrir WhatsApp com comprovante
                  </button>
                )}
              </div>
              <small>
                O WhatsApp abre com o texto preparado. Confira e toque em Enviar
                no WhatsApp. Nenhum envio é feito automaticamente por este
                botão.
              </small>
            </>
          )}
          {error && <p role="alert">{error}</p>}
        </section>
      )}
    </>
  );
}
