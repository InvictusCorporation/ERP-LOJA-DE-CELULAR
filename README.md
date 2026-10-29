# Invictus ERP Mobile

Módulos disponíveis: **1 — Produtos e Estoque**, **2 — Frente de Caixa (PDV)**, **3 — Assistência Técnica**, **4 — CRM e Clientes**, **5 — Gestão Financeira** e **6 — Crediário Próprio**. O desenvolvimento segue a ordem numérica de 1 a 12, com autorização antes de cada etapa. Os módulos 7–12 ainda não estão implementados. O ambiente começa vazio e não contém contas ou mercadorias fictícias pré-cadastradas.

## Executar localmente

Requisitos: Node.js 24 e pnpm 11.

```powershell
pnpm install
pnpm exec prisma generate
pnpm dev
```

Abra http://localhost:3000 e escolha **Primeiro acesso? Criar empresa local**. Cadastre a empresa, a primeira filial e uma senha com pelo menos 12 caracteres. Entre com os dados cadastrados.

O banco PostgreSQL embarcado (PGlite) fica em `.data/invictus`. Os registros sobrevivem ao reinício da aplicação. Essa opção permite demonstração e desenvolvimento sem Docker; **produção exige PostgreSQL externo**, migrações e provisionamento administrativo.

## Fluxo de demonstração

1. Em **Cadastros auxiliares**, crie categorias, marcas, modelos e fornecedores.
2. Em **Produtos**, cadastre cada variação com seu SKU, cor, capacidade, preço e garantia. Celulares podem usar controle individual.
3. Pela ação de movimentar, registre uma entrada. Para aparelhos, informe IMEI válido ou série, procedência e custo individual.
4. Consulte **Aparelhos e IMEIs** e **Movimentações**.
5. Em **Inventário**, configure o estoque mínimo e registre uma contagem física. Divergências de aparelhos exigem reconciliar as unidades individualmente antes de concluir a contagem.
6. Confira os indicadores e a auditoria. Recarregue a página para confirmar a persistência.

Em **Configurações**, o proprietário pode cadastrar filiais básicas e acessos locais. Os perfis mínimos são proprietário, gerente, estoquista, consulta, operador de caixa e técnico. O operador pode vender e movimentar seu caixa, mas não pode conceder descontos ou autorizar devoluções. Técnicos acessam apenas as ordens atribuídas a eles, sem custos e margens comerciais. A gestão completa de funcionários e filiais pertence a etapas futuras.

## Demonstrar o PDV

1. Abra **Frente de caixa**, selecione um caixa e informe o saldo inicial em dinheiro.
2. Pesquise produtos ou leia um código de barras com um leitor que envie Enter. Aparelhos exigem selecionar sua unidade física.
3. Confira quantidades, preços e descontos. Apenas proprietário/gerente concedem desconto nesta etapa.
4. Escolha **Receber e finalizar**. Divida o pagamento entre dinheiro, Pix, débito e crédito; confira os pagamentos externos e informe suas referências. O troco é calculado somente sobre dinheiro.
5. Imprima ou baixe o comprovante não fiscal. Consulte as vendas em **Histórico**.
6. Para corrigir uma venda, use **Devolver itens** ou **Cancelar venda** no comprovante. O estoque e os pagamentos recebem registros compensatórios. A devolução respeita o desconto e as formas de pagamento originais.
7. Em **Meu caixa**, registre sangrias/suprimentos e confira o dinheiro físico antes de fechar. Diferenças exigem justificativa. Consulte os fechamentos e resultados em **Por operador**.

Pix e cartões são **registros manuais de conferência**, sem cobrança automática, integração bancária ou TEF. Comprovantes não substituem documentos fiscais. O cliente pode ser selecionado no fechamento da venda. O crediário utiliza ofertas aprovadas e contas a receber; emissão fiscal pertence ao módulo 11.

O banco local aplica migrações incrementais automaticamente na abertura, preservando os registros da versão anterior. Em produção, execute `pnpm db:migrate` com a conta administrativa antes de iniciar a API atualizada.

## Demonstrar a assistência técnica

1. Em **Assistência técnica**, abra uma ordem com cliente, aparelho, defeito, estado físico e acessórios recebidos. Escolha um técnico com acesso à filial.
2. Registre diagnóstico e fotos. Fotos ficam privadas, são convertidas em JPEG sem metadados e acompanham o backup do banco.
3. Como proprietário ou gerente, prepare o orçamento com mão de obra, peças e garantia. Registre a decisão do cliente e a referência do contato. A aprovação é manual, sem envio automático de mensagens.
4. Consuma somente peças aprovadas e disponíveis no estoque. Devoluções de peças são feitas na própria ordem. Revisar um orçamento exige devolver as peças já consumidas e obter nova aprovação.
5. Conclua o reparo com o relatório de testes. Uma devolução de peça após a conclusão reabre o serviço para nova conferência.
6. Registre a entrega e o responsável pela retirada. Imprima ou baixe o comprovante não fiscal; a garantia começa na entrega. A ordem entregue fica preservada para consulta.

O valor do serviço considera mão de obra e peças efetivamente utilizadas, respeitando o orçamento aprovado. O comprovante de entrega não registra pagamento. Recebimentos e integração financeira pertencem ao módulo financeiro. A assistência e o CRM utilizam o mesmo cadastro de clientes.

## Demonstrar o CRM

1. Em **CRM e clientes**, pesquise ou cadastre um cliente. Os clientes da assistência já aparecem na mesma base. Proprietário e gerente podem gerir os cadastros; caixa dispõe apenas de busca mínima para identificar a venda.
2. Abra o cliente para consultar compras, aparelhos, serviços, prazos de garantia e atividades nas filiais autorizadas. As compras aparecem por item e consideram devoluções. Vendas antigas sem cliente permanecem sem vínculo; o sistema não tenta inferir a identidade do comprador.
3. Registre a preferência de contato comercial, com evidência ou motivo. O cadastro não concede permissão automaticamente. A revogação bloqueia a preparação de contato e novos registros comerciais por telefone, e-mail ou WhatsApp.
4. Registre atendimentos e próximos passos. **Preparar WhatsApp** oferece um link para atendimento manual após confirmação do telefone; nenhuma mensagem é enviada pelo ERP.
5. Crie oportunidades, informe valor, responsável e previsão. Acompanhe as etapas Novo contato, Em conversa, Proposta, Ganha e Perdida. Encerramentos e reaberturas exigem motivo. Marcar como ganha não realiza uma venda.
6. Crie lembretes com data e hora de Fortaleza. A agenda exibe pendentes e atrasados; atualize o registro para concluir, cancelar ou reagendar. Os lembretes são internos, sem notificações externas.
7. Para encerrar um relacionamento, finalize lembretes e oportunidades e arquive o cliente. Os históricos permanecem consultáveis; reative o cadastro para novos negócios.

## Demonstrar o financeiro

1. Em **Gestão financeira → Contas e centros**, cadastre contas por filial e centros de custo compartilhados. Informe o saldo inicial sem incluir novamente recebimentos que ainda serão classificados no ERP.
2. Lance **Contas a pagar** e **Contas a receber**, com contraparte, competência, vencimento e centro. Escolha o tratamento: operacional reconhece receita/despesa por competência; **Patrimonial / estoque** mantém saldo e fluxo, sem repetir custos na DRE. A baixa registra o recebimento ou pagamento.
3. Abra o título e registre uma baixa total ou parcial na conta da mesma filial, com data realizada e referência. Reenvios não duplicam o movimento; pagamentos acima do saldo aberto são recusados.
4. Consulte **Movimentos e conciliação**, confira valor, conta e referência com o extrato ou comprovante e concilie. A conciliação é manual, sem conexão bancária. Desfazer preserva a trilha; para estornar uma baixa, desfaça primeiro sua conciliação. O estorno cria movimento compensatório.
5. Recebimentos e devoluções do PDV entram automaticamente uma vez, inicialmente **sem conta financeira**. Ao conciliar, escolha a conta efetiva. Essas operações já constam no fluxo registrado; classificá-las não cria nova receita. Aberturas de caixa, sangrias e suprimentos do PDV não são novas receitas/despesas financeiras. Represente transferências patrimoniais entre contas pela operação própria.
6. Serviços novos entregues com reparo geram um recebível pelo valor real de mão de obra e peças usadas. Serviços anteriores ao financeiro aparecem com **saldo a conferir**. No filtro **Conferir saldos anteriores**, abra o título, confira os comprovantes e informe somente o saldo ainda aberto. Recebimentos externos anteriores não criam entradas fictícias nas contas atuais. Esses títulos ficam fora dos valores em aberto e previstos até a conferência.
7. No **Painel e resultados**, compare DRE gerencial por competência, fluxo realizado, previsão por vencimento, valores atrasados, resultados por filial e centros de custo. Escolha **Consolidado** para reunir somente suas filiais autorizadas. Exporte o relatório ou a página de movimentos em CSV.

Transferências, saldos iniciais e ajustes patrimoniais não compõem a DRE. As devoluções reduzem receita e custo na data da devolução; serviços são reconhecidos na entrega. Taxas de cartão e outras despesas são lançadas separadamente. A DRE é gerencial e não realiza apuração fiscal ou demonstração contábil. Proprietário e gerente têm acesso; caixa, técnico e estoquista não recebem permissão financeira.

## Demonstrar o crediário

1. Como proprietário, abra **Crediário próprio → Condições comerciais**. Registre fornecedor, limites de taxas, termos e referência da revisão jurídica. Habilite novas ofertas somente após a revisão real. O sistema começa com crédito desabilitado.
2. Cadastre o comprador no CRM. Em **Clientes e análise**, informe CPF válido, endereço, limite de principal e avaliação responsável com referência da consulta externa. A aprovação é manual, sem pontuação ou consulta automática a bureaus.
3. Em **Ofertas aprovadas**, simule preço sem financiamento, entrada, parcelas, taxa e primeiro vencimento. Confira juros, CET mensal/anual e calendário; registre a aprovação. A oferta reserva o limite até uso, cancelamento ou expiração e possui documento para conferência do comprador.
4. No PDV, monte um carrinho com o mesmo valor e filial da oferta. Escolha **Crediário aprovado**, selecione a oferta e registre somente a entrada como pagamento. Confira o contrato com o comprador, registre o aceite manual e entregue sua cópia. O contrato fica disponível no comprovante e no crediário.
5. Abra o contrato e **Receber parcela** para registrar um pagamento total ou parcial na conta financeira da filial. O sistema discrimina principal, juros, abatimento proporcional por antecipação, multa e mora. O recebimento é na data atual e não repete a receita da venda na DRE. Estornos preservam recibos e dependem de desfazer eventual conciliação.
6. **Renegociar principal aberto** cria uma revisão com nova aceitação e avaliação. Recebimentos anteriores permanecem; juros e encargos ainda não recebidos são dispensados, sem capitalização. **Cobrança** lista atrasos por faixa e permite exportar a página CSV; não envia mensagens.
7. A devolução de venda financiada exige **cancelamento integral**, restituição da entrada e das parcelas recebidas e retorno de todos os itens. Para manter parte dos produtos, cancele e registre nova venda. O cancelamento é bloqueado enquanto alguma parcela recebida estiver conciliada.

O método utiliza juros simples por principal de cada parcela, dias corridos/base 30 e vencimentos mensais; os valores das parcelas podem variar. Não há tarifas ou seguros adicionais. Limites do formulário são técnicos e não substituem a revisão das condições aplicáveis à empresa. Documentos registram aceite manual, sem assinatura eletrônica ou comprovação de quitação. Veja o [relatório do módulo 6](docs/ENTREGA-MODULO-6.md).

## Verificações

```powershell
pnpm typecheck
pnpm test
pnpm exec playwright install chromium
pnpm test:e2e
pnpm build
```

Os testes de API usam PostgreSQL embarcado real, role sem privilégios de proprietário e políticas RLS. O teste de navegador cria uma empresa claramente identificada como teste. Para manter a demonstração separada, use `DATA_DIR=.data/e2e` ao iniciar a aplicação para esse teste.

`pnpm test:e2e` executa os cinco fluxos anteriores e o crediário em dois grupos, reiniciando o servidor entre eles para respeitar o limite de cinco criações locais por IP em 15 minutos. Execute com a aplicação local parada e a base de teste configurada; o limite de segurança do produto permanece ativo.

## Documentação

- [Arquitetura e limites](docs/ARQUITETURA.md)
- [Operação, produção e backup](docs/OPERACAO.md)
- [Relatório de implementação](docs/ENTREGA-MODULO-1.md)
- [Relatório do PDV](docs/ENTREGA-MODULO-2.md)
- [Relatório da assistência técnica](docs/ENTREGA-MODULO-3.md)
- [Relatório do CRM](docs/ENTREGA-MODULO-4.md)
- [Relatório financeiro](docs/ENTREGA-MODULO-5.md)
- [Relatório do crediário](docs/ENTREGA-MODULO-6.md)

Integrações de identidade, white label, assinaturas e ponto dependem da análise dos projetos existentes da Invictus. Não foi criado um segundo sistema de ponto.
