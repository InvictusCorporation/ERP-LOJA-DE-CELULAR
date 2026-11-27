# Comprovantes do caixa e aviso de assistência — 26/11/2026

## Comprovante da Frente de caixa

Depois de finalizar a venda, o comprovante possui **Imprimir**, **Baixar comprovante** e, para perfis com consulta de cliente, **Enviar pelo WhatsApp**. O histórico de vendas também permite reabrir o comprovante.

A impressão usa a janela do navegador e o leiaute existente de 80 mm, sem menu, ações ou prévia de WhatsApp no papel. O operador escolhe a impressora ou o destino PDF e confirma na janela. A validação automatizada verifica a chamada de impressão e a composição para papel; não presume que uma impressora física esteja instalada.

Download e WhatsApp usam o mesmo texto: empresa, filial, venda, cliente quando vinculado, data, itens/identificadores, garantia, subtotal, desconto, total, pagamentos, troco e eventuais devoluções. Continua sendo um **comprovante não fiscal**.

O botão WhatsApp busca novamente a venda e a preferência atual do cliente. Uma venda com cliente vinculado utiliza somente o telefone atual do cadastro, com autorização de contato e cliente ativo. Não permite substituir o número para contornar um bloqueio. Uma venda sem cliente vinculado permite informar um número para aquele comprovante, sem gravá-lo no cadastro. O operador confere destinatário e solicitação do cliente antes de abrir o aplicativo. O envio é confirmado no próprio WhatsApp; o ERP não registra essa ação como mensagem entregue.

O link é fixado em `https://wa.me/`, com telefone internacional normalizado e mensagem codificada. Para textos acima do limite conservador de 12 mil caracteres da interface, a opção é baixar o arquivo completo e anexá-lo manualmente; nenhum conteúdo é truncado em silêncio.

## Aviso automático de aparelho pronto

A integração foi preparada para a **Cloud API oficial da Meta**, conforme escolha do usuário. Não foram fornecidas credenciais nem conectado um número comercial; portanto, envios reais permanecem desativados.

Ao concluir um reparo aprovado, o mesmo commit que coloca a ordem em `ready` cria um registro na fila `repair_notifications`. A chave única por empresa, ordem e instante da conclusão impede duplicação no reenvio da mesma operação ou por atualização da tela. Um novo ciclo real de conclusão pode criar outro aviso; o anterior deixa de ser elegível se não corresponder ao `ready_at` atual.

O processador roda no servidor a cada 15 segundos, somente quando houver configuração completa e `WHATSAPP_ENABLED=true`. Cada conjunto de credenciais é limitado a **um tenant explícito**. O processador não enumera nem consulta dados comerciais de outras empresas. Antes de enviar, verifica novamente filial ativa, etapa atual da ordem, cliente ativo, preferência de contato e telefone atual. Não envia IMEI, diagnóstico, fotos nem valores financeiros no aviso de retirada.

Mensagem sugerida para cadastrar como template utilitário com parâmetros posicionais no corpo:

> Olá {{1}}! A {{2}} informa que o aparelho da ordem {{3}} ({{4}}) está pronto para retirada. Entre em contato com a loja para combinar a retirada.

Parâmetros na ordem: nome atual do cliente; nome da empresa; código da ordem; marca e modelo. O template aprovado deve usar exatamente esses quatro parâmetros no corpo, sem exigir cabeçalho ou botões dinâmicos. A aprovação e a configuração do número acontecem na conta Meta da loja.

## Configuração para ativação posterior

Injetar no ambiente privado do servidor, seguindo `.env.example`:

- `WHATSAPP_ENABLED`: `true` somente após validar a conta e o template.
- `WHATSAPP_TENANT_ID`: UUID da empresa deste ERP, exibido nas configurações do ambiente.
- `WHATSAPP_API_VERSION`: versão da Graph API suportada pela conta, no formato `vNN.0`; sem versão implícita no código.
- `WHATSAPP_PHONE_NUMBER_ID`: identificador do número comercial na Meta, não o telefone do cliente.
- `WHATSAPP_ACCESS_TOKEN`: credencial de servidor com escopo adequado para o número configurado. Nunca inserir no Git, navegador, documentação preenchida ou chat.
- `WHATSAPP_READY_TEMPLATE`: nome do template de aparelho pronto aprovado.
- `WHATSAPP_TEMPLATE_LANGUAGE`: idioma aprovado, por exemplo `pt_BR`.

Após aplicar a migração 17 e configurar o ambiente, reiniciar a API. Confirmar previamente o destino dos avisos pendentes: ordens que continuam prontas poderão ser processadas ao habilitar a integração. Na demonstração em memória, os envios são explicitamente desativados.

## Estados e falhas

| Estado | Significado |
| --- | --- |
| Na fila / aguardando configuração | Criado localmente; ainda não houve aceitação do provedor. |
| Processando | Um único processador assumiu a tentativa. |
| Aceito pelo WhatsApp | A API devolveu identificador; **não comprova entrega nem leitura**. |
| Bloqueado | Preferência de contato, telefone ou cliente impedem o envio. |
| Recusado pelo serviço | Resposta HTTP 4xx conhecida; após corrigir a causa, a gestão pode retomar explicitamente. |
| Resultado incerto | Timeout, resposta 5xx, resposta de sucesso incompleta ou processo interrompido. Não há reenvio automático. |
| Cancelado | Ordem não está mais pronta naquele ciclo ou a filial foi inativada. |

Não é possível prometer entrega exatamente uma vez apenas com a resposta HTTP de uma API externa. Por isso, resultado incerto exige conferência no provedor, e não libera o botão de repetição. A aceitação/recusa/incerteza é registrada também na auditoria, sem token ou telefone no log. Webhooks de confirmação de entrega/leitura e tratamento de respostas recebidas não fazem parte desta etapa; a tela não inventa esses estados.

## Verificação e aprendizados

- Testes de caixa, CRM e assistência cobrem as operações existentes e a criação da fila na conclusão real de reparo.
- Testes específicos usam um provedor simulado, sem fazer requisições reais à Meta: concorrência, deduplicação, bloqueio de contato, entrega posterior do aparelho, retomada explícita de recusa, timeout e isolamento por tenant.
- O navegador confere impressão, leiaute de papel, download e igualdade do texto para WhatsApp. A navegação externa é interceptada no teste; nenhuma mensagem é enviada a um cliente de verdade.
- O telefone da entrada da assistência é um snapshot histórico; o destino de uma nova notificação precisa usar o cadastro atual e sua preferência vigente.
- Gravar na fila antes de confirmar a transação da ordem poderia enviar um aviso de um reparo que sofreu rollback. Fila e conclusão são persistidas juntas, e o HTTP externo acontece somente depois do commit.
- Uma resposta perdida não equivale a falha confirmada. Repetir sem verificar pode mandar avisos duplicados; a fila preserva o estado incerto.

Referências primárias: [WhatsApp — Click to chat](https://faq.whatsapp.com/5913398998672934/), [coleção oficial da Meta — mensagem com template](https://www.postman.com/meta/whatsapp-business-platform/request/o65u5m5/send-message-template-text), [Meta — referência de templates](https://developers.facebook.com/docs/graph-api/reference/whats-app-business-hsm/).

Resultado local: **46 verificações pertinentes de API/banco/formatação aprovadas**, incluindo a repetição dos testes específicos após acrescentar auditoria e recuperação de processo interrompido; **três fluxos de navegador aprovados** (caixa, assistência e CRM), com repetição final do caixa e prévia para WhatsApp em 390 px. TypeScript e compilação de produção aprovados. Evidências e comprovantes fictícios em `.data/qa-whatsapp-20261126`, ignorados pelo Git. Não houve impressão em equipamento físico nem envio real de mensagem a cliente.
