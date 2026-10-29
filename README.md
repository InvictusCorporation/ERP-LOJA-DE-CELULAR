# Invictus ERP Mobile

Módulos disponíveis: **1 — Produtos e Estoque**, **2 — Frente de Caixa (PDV)**, **3 — Assistência Técnica** e **4 — CRM e Clientes**. O desenvolvimento segue a ordem numérica de 1 a 12, com autorização antes de cada etapa. Os módulos 5–12 ainda não estão implementados. O ambiente começa vazio e não contém contas ou mercadorias fictícias pré-cadastradas.

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

Pix e cartões são **registros manuais de conferência**, sem cobrança automática, integração bancária ou TEF. Comprovantes não substituem documentos fiscais. O cliente pode ser selecionado no fechamento da venda. Crediário, contas a receber e emissão fiscal serão integrados nos módulos correspondentes.

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

## Verificações

```powershell
pnpm typecheck
pnpm test
pnpm exec playwright install chromium
pnpm test:e2e
pnpm build
```

Os testes de API usam PostgreSQL embarcado real, role sem privilégios de proprietário e políticas RLS. O teste de navegador cria uma empresa claramente identificada como teste. Para manter a demonstração separada, use `DATA_DIR=.data/e2e` ao iniciar a aplicação para esse teste.

## Documentação

- [Arquitetura e limites](docs/ARQUITETURA.md)
- [Operação, produção e backup](docs/OPERACAO.md)
- [Relatório de implementação](docs/ENTREGA-MODULO-1.md)
- [Relatório do PDV](docs/ENTREGA-MODULO-2.md)
- [Relatório da assistência técnica](docs/ENTREGA-MODULO-3.md)
- [Relatório do CRM](docs/ENTREGA-MODULO-4.md)

Integrações de identidade, white label, assinaturas e ponto dependem da análise dos projetos existentes da Invictus. Não foi criado um segundo sistema de ponto.
