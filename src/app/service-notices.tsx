"use client";
import { useEffect } from "react";
type Row = Record<string, any>;
export default function ServiceNotices({
  order,
  notifications,
  manage,
  busy,
  mutate,
  reload,
  onNotice,
}: {
  order: Row;
  notifications: Row;
  manage: boolean;
  busy: boolean;
  mutate: (path: string, body: unknown) => Promise<any>;
  reload: () => Promise<void>;
  onNotice: (message: string, error?: boolean) => void;
}) {
  const pending =
    notifications.configured &&
    notifications.items.some((n: Row) =>
      ["queued", "sending"].includes(n.state),
    );
  useEffect(() => {
    if (!pending) return;
    const timer = setInterval(() => void reload(), 15000);
    return () => clearInterval(timer);
  }, [pending, reload]);
  const labels: Record<string, string> = {
    queued: notifications.configured
      ? "Na fila para envio"
      : "Aguardando configuração",
    sending: "Processando envio",
    accepted: "Aceito pelo WhatsApp · entrega não confirmada",
    blocked: "Bloqueado · confira autorização e telefone no CRM",
    failed: "Recusado pelo serviço · confira a configuração",
    uncertain: "Resultado incerto · conferir no provedor antes de reenviar",
    cancelled: "Cancelado · aparelho fora desta etapa de retirada",
  };
  return (
    <section
      role="region"
      className="service-whatsapp-notices"
      aria-label="Aviso automático de aparelho pronto"
    >
      <div>
        <strong>Aviso automático pelo WhatsApp</strong>
        <p>
          {notifications.configured
            ? "Integração configurada. O aviso entra na fila ao concluir o serviço."
            : "Aguardando conectar o WhatsApp Business da loja. Nenhuma mensagem é enviada enquanto não houver configuração."}
        </p>
      </div>
      {notifications.items.length ? (
        notifications.items.map((n: Row) => (
          <article key={n.id}>
            <strong>{labels[n.state] || n.state}</strong>
            <small>
              {n.attempts} tentativa(s) · Atualizado em{" "}
              {new Date(n.updated_at).toLocaleString("pt-BR", {
                timeZone: "America/Fortaleza",
              })}
            </small>
            {manage &&
              order.status === "ready" &&
              ["blocked", "failed"].includes(n.state) && (
                <button
                  className="secondary small"
                  disabled={busy}
                  onClick={async () => {
                    try {
                      await mutate(`/repairs/${order.id}/notification-retry`, {
                        notification_id: n.id,
                      });
                      await reload();
                      onNotice("Aviso recolocado na fila.");
                    } catch (e: any) {
                      onNotice(e.message, true);
                    }
                  }}
                >
                  Retomar aviso
                </button>
              )}
          </article>
        ))
      ) : (
        <small>
          O aviso será criado quando o serviço for concluído e a ordem ficar
          pronta para retirada.
        </small>
      )}
      <button
        className="text-button"
        type="button"
        onClick={() => void reload()}
      >
        Atualizar situação do aviso
      </button>
    </section>
  );
}
