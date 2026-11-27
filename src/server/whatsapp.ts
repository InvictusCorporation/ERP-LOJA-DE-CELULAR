import { randomUUID } from "node:crypto";
import { Database, Tx } from "./db";
import { whatsappPhone } from "../shared/pos-receipt";
type Config = {
  tenant: string;
  version: string;
  phoneId: string;
  token: string;
  template: string;
  language: string;
};
export function whatsappConfig(
  env: NodeJS.ProcessEnv = process.env,
): Config | null {
  const {
    WHATSAPP_ENABLED: enabled,
    WHATSAPP_TENANT_ID: tenant,
    WHATSAPP_API_VERSION: version,
    WHATSAPP_PHONE_NUMBER_ID: phoneId,
    WHATSAPP_ACCESS_TOKEN: token,
    WHATSAPP_READY_TEMPLATE: template,
  } = env;
  const language = env.WHATSAPP_TEMPLATE_LANGUAGE || "pt_BR";
  if (
    enabled !== "true" ||
    !tenant ||
    !version ||
    !phoneId ||
    !token ||
    !token.trim() ||
    token.length > 4096 ||
    /[\r\n]/.test(token) ||
    !template ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      tenant,
    ) ||
    !/^v\d{1,3}\.0$/.test(version) ||
    !/^\d{5,30}$/.test(phoneId) ||
    !/^[a-z0-9_]{1,512}$/.test(template) ||
    !/^[a-z]{2,3}(?:_[A-Z]{2})?$/.test(language)
  )
    return null;
  return { tenant, version, phoneId, token, template, language };
}
export async function queueReadyNotice(
  tx: Tx,
  tenant: string,
  branch: string,
  order: string,
) {
  await tx.query(
    `INSERT INTO repair_notifications(id,tenant_id,branch_id,order_id,ready_at) SELECT $1,$2,$3,id,ready_at FROM repair_orders WHERE id=$4 AND status='ready' ON CONFLICT(tenant_id,order_id,ready_at) DO NOTHING RETURNING id`,
    [randomUUID(), tenant, branch, order],
  );
}
export async function runWhatsAppQueue(
  db: Database,
  config: Config,
  send: typeof fetch = fetch,
) {
  // One explicit tenant per provider credential. No global business-data query.
  const job: Record<string, any> | null = await db.transaction(
    config.tenant,
    async (tx) => {
      await tx.query(
        "UPDATE repair_notifications SET state='uncertain',last_error='process_interrupted',updated_at=now() WHERE state='sending' AND claimed_at<now()-interval '2 minutes' RETURNING id",
      );
      const [n] = await tx.query(
        `SELECT n.*,o.status AS order_status,o.ready_at AS current_ready_at,o.ready_at=n.ready_at AS same_cycle,o.code,o.brand,o.model,c.name AS customer_name,c.phone,c.active,c.contact_permission,t.name AS company_name,b.active AS branch_active FROM repair_notifications n JOIN repair_orders o ON o.id=n.order_id JOIN customers c ON c.id=o.customer_id JOIN tenants t ON t.id=n.tenant_id JOIN branches b ON b.id=n.branch_id WHERE n.state='queued' ORDER BY n.created_at,n.id LIMIT 1 FOR UPDATE OF n SKIP LOCKED`,
      );
      if (!n) return null;
      if (n.order_status !== "ready" || !n.same_cycle || !n.branch_active) {
        await tx.query(
          "UPDATE repair_notifications SET state='cancelled',last_error='order_no_longer_ready',updated_at=now() WHERE id=$1 RETURNING id",
          [n.id],
        );
        return null;
      }
      let phone = "";
      try {
        phone = whatsappPhone(n.phone);
      } catch {}
      if (!n.active || !n.contact_permission || !phone) {
        await tx.query(
          "UPDATE repair_notifications SET state='blocked',last_error='contact_not_authorized_or_invalid',updated_at=now() WHERE id=$1 RETURNING id",
          [n.id],
        );
        return null;
      }
      await tx.query(
        "UPDATE repair_notifications SET state='sending',attempts=attempts+1,claimed_at=now(),updated_at=now() WHERE id=$1 RETURNING id",
        [n.id],
      );
      return { ...n, phone };
    },
  );
  if (!job) return;
  let state = "uncertain",
    error = "provider_result_unknown",
    messageId: string | null = null;
  try {
    const response = await send(
      `https://graph.facebook.com/${config.version}/${config.phoneId}/messages`,
      {
        method: "POST",
        redirect: "error",
        signal: AbortSignal.timeout(10000),
        headers: {
          authorization: `Bearer ${config.token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          recipient_type: "individual",
          to: job.phone,
          type: "template",
          template: {
            name: config.template,
            language: { code: config.language },
            components: [
              {
                type: "body",
                parameters: [
                  job.customer_name,
                  job.company_name,
                  job.code,
                  [job.brand, job.model].filter(Boolean).join(" "),
                ].map((text) => ({ type: "text", text })),
              },
            ],
          },
        }),
      },
    );
    const data = await response.json().catch(() => null);
    if (
      response.ok &&
      typeof data?.messages?.[0]?.id === "string" &&
      data.messages[0].id.length <= 500
    ) {
      state = "accepted";
      error = "";
      messageId = data.messages[0].id;
    } else if (response.status >= 400 && response.status < 500) {
      state = "failed";
      error = "provider_rejected_" + response.status;
    }
    // A timeout/5xx/malformed success can hide an accepted send. Never resend blindly.
  } catch {}
  await db.transaction(config.tenant, async (tx) => {
    const changed = await tx.query(
      "UPDATE repair_notifications SET state=$1,last_error=$2,provider_message_id=$3,updated_at=now() WHERE id=$4 AND state='sending' RETURNING id",
      [state, error, messageId, job.id],
    );
    if (changed.length)
      await tx.query(
        "INSERT INTO audit_events(id,tenant_id,branch_id,action,entity_id,details) VALUES($1,$2,$3,$4,$5,$6::jsonb) RETURNING id",
        [
          randomUUID(),
          config.tenant,
          job.branch_id,
          "notification.whatsapp." + state,
          job.id,
          JSON.stringify({ state, provider_message_id: messageId, error }),
        ],
      );
  });
}
export function startWhatsAppWorker(db: Database) {
  const config = whatsappConfig();
  if (!config) return () => {};
  let running = false,
    stopping = false;
  let done: Promise<void> = Promise.resolve();
  const tick = () => {
    if (running || stopping) return;
    running = true;
    done = runWhatsAppQueue(db, config)
      .catch(() => {
        console.error(
          "Fila WhatsApp: processamento pendente; confira o estado na assistência.",
        );
      })
      .finally(() => {
        running = false;
      });
  };
  const timer = setInterval(tick, 15000);
  timer.unref();
  tick();
  return async () => {
    stopping = true;
    clearInterval(timer);
    await done;
  };
}
