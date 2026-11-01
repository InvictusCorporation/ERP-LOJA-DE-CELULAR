# Invictus ERP Mobile

Módulos disponíveis: **1 — Produtos e Estoque**, **2 — Frente de Caixa (PDV)**, **3 — Assistência Técnica**, **4 — CRM e Clientes**, **5 — Gestão Financeira**, **6 — Crediário Próprio**, **7 — Compras e Fornecedores**, **8 — Relatórios Gerenciais**, **9 — Funcionários e Permissões** e **10 — Gestão de Filiais**. O desenvolvimento segue a ordem numérica de 1 a 12, com autorização antes de cada etapa. Os módulos 11–12 ainda não estão implementados. O ambiente começa vazio e não contém contas ou mercadorias fictícias pré-cadastradas.

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
   O cadastro é livre para qualquer produto, sem lista fechada de tipos. Escolha **Produto por quantidade** para controlar o saldo ou **Produto com controle individual — IMEI ou série** para rastrear cada unidade. Nome e categorias são livres; marca, modelo e especificação são opcionais. Crie suas próprias categorias em Cadastros auxiliares.
   No cadastro, **Usar leitor** direciona a leitura USB/Bluetooth que funciona como teclado para o código de barras; Enter confirma a leitura sem enviar o formulário. **Escanear com câmera** lê a embalagem no navegador, mediante autorização e HTTPS ou localhost. A imagem não é enviada ao servidor; a câmera é desligada após a captura ou ao fechar. Confira nome, categoria e preços antes de salvar. A digitação permanece disponível.
3. Pela ação de movimentar, registre uma entrada. Para aparelhos, informe IMEI válido ou série, procedência e custo individual.
4. Consulte **Aparelhos e IMEIs** e **Movimentações**.
5. Em **Inventário**, configure o estoque mínimo e registre uma contagem física. Divergências de aparelhos exigem reconciliar as unidades individualmente antes de concluir a contagem.
6. Confira os indicadores e a auditoria. Recarregue a página para confirmar a persistência.

Em **Gestão de filiais**, o proprietário cadastra e administra suas unidades. Em **Funcionários e permissões**, proprietário e administrador gerem a equipe. Os perfis padrão são proprietário, administrador, gerente, vendedor, operador de caixa, técnico, financeiro, estoquista e consulta. O caixa vende e movimenta seu caixa sem descontos/devoluções por padrão; técnicos trabalham em ordens atribuídas, sem custos comerciais por padrão. Exceções individuais são conferidas pelo servidor e suas dependências. Estoquistas também podem transferir mercadorias entre duas filiais autorizadas; a configuração individual pode restringir essa ação.

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

## Demonstrar compras e fornecedores

1. Em **Compras e fornecedores → Fornecedores**, cadastre ou revise os dados do fornecedor. O cadastro reaproveita fornecedores de Cadastros auxiliares, sem duplicá-los. Inativar impede novos pedidos e confirmações; os pedidos já confirmados e seus históricos permanecem.
2. Em **Pedidos e recebimentos**, crie um pedido por filial. Selecione fornecedor e produtos livres do catálogo, informe quantidades, custos unitários positivos e previsão. Salve o rascunho e revise-o antes de **Confirmar pedido**. A confirmação preserva os itens e condições, sem enviar mensagens, movimentar estoque ou registrar pagamento.
3. Em **Conferir recebimento**, informe referência única por fornecedor e entrega, vencimento e somente as quantidades fisicamente recebidas. Entregas parciais deixam o saldo pendente. Produtos individuais exigem uma série ou IMEI válido e procedência por unidade; são aceitas até 200 unidades identificadas por operação.
4. A confirmação grava entrada de estoque e uma conta a pagar patrimonial pelo valor recebido na mesma transação. Marque a atualização do custo para usar o último custo de compra no cadastro; não há média ponderada. Custos históricos de vendas permanecem preservados. Compras de mercadoria não duplicam despesa na DRE.
5. Pague o título em **Gestão financeira → Contas a pagar**. As baixas podem ser parciais e seguem o fluxo existente de contas, conciliação e estorno. O título mantém origem e valor do recebimento.
6. Consulte histórico, quantidades por entrega, séries/IMEIs, contas e trilha do pedido. Imprima o pedido e a conferência do recebimento; exporte a página de pedidos ou fornecedores em CSV. Documentos são internos, sem emissão ou validação fiscal.
7. **Cancelar saldo pendente** encerra somente a parte não entregue. Para corrigir uma entrega inteira, estorne primeiro eventuais pagamentos no financeiro e use **Estornar recebimento** em Compras. O sistema compensa quantidades e cancela somente o título daquela entrega; unidades movimentadas depois do recebimento ou saldo insuficiente bloqueiam a operação. O custo de catálogo não é restaurado automaticamente e deve ser revisado no cadastro quando necessário.

Proprietário e gerente acessam Compras nas filiais autorizadas. Devoluções comerciais parciais ao fornecedor, importação de XML e emissão fiscal não foram implementadas nesta etapa. Veja o [relatório do módulo 7](docs/ENTREGA-MODULO-7.md).

## Verificações

```powershell
pnpm typecheck
pnpm test
pnpm exec playwright install chromium
pnpm test:e2e
pnpm build
```

Os testes de API usam PostgreSQL embarcado real, role sem privilégios de proprietário e políticas RLS. O teste de navegador cria uma empresa claramente identificada como teste. Para manter a demonstração separada, use `DATA_DIR=.data/e2e` ao iniciar a aplicação para esse teste.

`pnpm test:e2e` executa os cinco fluxos iniciais e, no segundo grupo, crediário, cadastro com escaneamento e compras, reiniciando o servidor entre os grupos para respeitar o limite de cinco criações locais por IP em 15 minutos. Execute com a aplicação local parada e a base de teste configurada; o limite de segurança do produto permanece ativo.

## Documentação

- [Arquitetura e limites](docs/ARQUITETURA.md)
- [Operação, produção e backup](docs/OPERACAO.md)
- [Relatório de implementação](docs/ENTREGA-MODULO-1.md)
- [Relatório do PDV](docs/ENTREGA-MODULO-2.md)
- [Relatório da assistência técnica](docs/ENTREGA-MODULO-3.md)
- [Relatório do CRM](docs/ENTREGA-MODULO-4.md)
- [Relatório financeiro](docs/ENTREGA-MODULO-5.md)
- [Relatório do crediário](docs/ENTREGA-MODULO-6.md)
- [Relatório de compras e fornecedores](docs/ENTREGA-MODULO-7.md)

Integrações de identidade, white label, assinaturas e ponto dependem da análise dos projetos existentes da Invictus. Não foi criado um segundo sistema de ponto.

## Demonstrar relatórios gerenciais

1. Como proprietário ou gerente, entre em **Relatórios gerenciais**. Escolha as filiais autorizadas e um período de até 366 dias, terminando até hoje; clique em **Aplicar filtros**.
2. Consulte faturamento diário/mensal, lucro bruto operacional, resultado gerencial da DRE, ticket e comparativo de filiais. Dias sem movimento aparecem zerados.
3. Em **Produtos vendidos**, consulte quantidades, devoluções, receita, custos históricos e margem. Ordene por quantidade, receita ou lucro e pesquise nome/SKU.
4. Veja **Vendedores**, **Técnicos** e **Serviços realizados**. Ticket considera vendas criadas no período que ainda mantêm saldo positivo, após todas as devoluções conhecidas hoje. Devoluções na receita são reconhecidas na data em que ocorreram.
5. **Produtos parados** e **Inadimplência** são posições atuais, independentemente das datas da visão consolidada. Reposição reinicia a inatividade por produto/filial. A inadimplência usa saldo nominal vencido dos planos vigentes; não inclui encargos ainda não lançados.
6. Exporte CSV ou abra **Imprimir**. Tabelas paginadas exportam/imprimem a página atual (até 30 registros); inadimplência acrescenta o consolidado de todas as filiais selecionadas. A visão consolidada exporta toda a série do período limitado e o comparativo.

O tempo dos técnicos mede dias corridos até conclusão, incluindo espera, sem controle de horas trabalhadas. Margens dependem dos custos informados e não são apuração fiscal. Consulte [entrega do módulo 8](docs/ENTREGA-MODULO-8.md) para definições e limites.


## Demonstrar funcionários e permissões

1. Como proprietário, abra **Funcionários e permissões**. Contas anteriores já aparecem na equipe; não é preciso cadastrá-las novamente.
2. No ambiente local, use **Novo funcionário**: nome na empresa, e-mail, senha inicial com pelo menos 12 caracteres, matrícula opcional, cargo, função, filial de trabalho e filiais autorizadas. Em produção, novas contas continuam sendo provisionadas pela central; o módulo gerencia seus vínculos existentes.
3. Escolha o perfil e revise as exceções individuais entre padrão, permitir e bloquear. A coluna **Acesso efetivo** considera dependências: bloquear uma permissão retira também ações dependentes. Gestão de usuários, cadastro e situação de filiais e política de crédito são reservados ao perfil.
4. Administradores gerem funcionários comuns somente dentro de seu acesso completo e sem conceder direitos que não possuem. Apenas o proprietário gere administradores. Não se pode retirar o próprio acesso nem rebaixar/inativar o proprietário pelo ERP.
5. Para mudar um cadastro, informe o motivo. As sessões anteriores daquele funcionário nesta empresa são encerradas; ele precisa entrar novamente. A inativação preserva vendas, serviços e histórico. Caixas abertos e pendências atribuídas precisam ser encerrados ou reatribuídos antes da perda de acesso correspondente.
6. Consulte **Histórico de operações**, filtre ativos/inativos e exporte o CSV da página atual (até 30 registros).
7. Para preparar o ponto, informe o identificador externo e use **Exportar vínculo do ponto**. O JSON inclui os IDs estáveis do vínculo/usuário, empresa, filial, situação e versão. Não envia dados, não contém jornada e não sincroniza frequência. A conexão com o projeto existente será tratada no módulo 12, após disponibilização de seu repositório.

Nome, cargo e função são específicos da empresa. Alterações não modificam a identidade global de uma conta compartilhada nem seus acessos em outra empresa. E-mail e senha existentes continuam sob administração da central.


## Demonstrar gestão de filiais

1. Abra **Gestão de filiais**. O proprietário cadastra/edita nome, código opcional, contato e endereço, sem duplicar unidades existentes. A criação fornece um caixa principal e concede acesso aos proprietários da empresa; acessos dos demais funcionários são definidos em Funcionários e permissões.
2. Em **Abrir filial**, consulte estoque, unidades identificadas, caixas cadastrados/abertos e equipe com acesso. A quantidade identificada é parte do estoque total; a equipe não representa presença ou jornada.
3. Use os atalhos de inventário, caixas/vendas e equipe. **Resultados e comparativos** reutiliza os Relatórios Gerenciais, com posição individual e consolidação das filiais autorizadas, CSV e impressão.
4. Em **Transferências → Nova transferência**, escolha origem e destino ativos, adicione produtos por quantidade ou selecione cada série/IMEI. Até 30 produtos e 200 unidades identificadas por operação. Confira a saída e o recebimento antes de concluir: a atualização das duas filiais é atômica, sem etapa de trânsito ou confirmação parcial.
5. Consulte o documento interno de conferência e use **Imprimir transferência**. Não há receita, despesa, pagamento ou emissão fiscal nessa operação. Identificadores e custo de aquisição das unidades são preservados.
6. Para corrigir, confira o retorno integral e informe o motivo. O destino precisa ter todo o saldo, e unidades identificadas não podem ter alterações posteriores. O sistema preserva os registros e grava compensações; para movimentação posterior ou retorno parcial, registre uma nova transferência de retorno.
7. Para inativar, resolva estoque, caixas, ordens, compras, CRM, ofertas vigentes, títulos, contas e movimentos financeiros sem conta. Reatribua a filial de trabalho da equipe quando necessário. Deve restar ao menos uma filial ativa. Dados anteriores ficam consultáveis; novas operações na unidade inativa são recusadas, inclusive em telas abertas anteriormente.

Criar uma filial na empresa já provisionada funciona pelo proprietário também no runtime de produção, sob RLS; criar a empresa e identidades globais continua no provisionamento administrativo. Não há subdomínio, assinatura, remessa fiscal ou implantação externa automática. Veja [entrega do módulo 10](docs/ENTREGA-MODULO-10.md).
