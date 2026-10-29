# Módulo 5 — Gestão Financeira

Entrega concluída em 29/10/2026, após autorização para continuar a sequência. Os módulos 1 a 4 permanecem disponíveis. O módulo 6, Crediário Próprio, aguarda autorização.

## Funcionalidades

- Contas a pagar e receber com competência, vencimento, contraparte, centro de custo e filial. Baixas parciais ou totais, cancelamento de título manual sem baixas ativas e estornos compensatórios.
- Contas financeiras por filial, saldo inicial, transferências atômicas, ajustes patrimoniais justificados, centros compartilhados e inativação sem exclusão de histórico.
- Conciliação manual por conta, valor exato, data e referência do extrato/comprovante. Desfazer mantém o registro e exige justificativa. Valores monetários originais não são alterados.
- Recebimentos e devoluções do PDV integrados uma única vez na transação original. Entram sem conta presumida; a conciliação classifica a conta. Abertura, sangria e suprimento do PDV não são novas receitas/despesas financeiras.
- Serviço novo entregue com reparo gera recebível pela mão de obra aprovada e peças líquidas usadas. Entregas recusadas/canceladas não geram cobrança de reparo. Serviços legados exigem conferência do saldo antes de aparecer em aberto ou na previsão.
- Fluxo realizado e previsto, atrasos, DRE gerencial, custos e margem, resultados por filial, consolidação das unidades autorizadas e exportação CSV.

## Critérios dos valores

Títulos manuais distinguem operacional de patrimonial. Uma compra de estoque pode manter contas a pagar e baixas sem repetir despesas na DRE, que já utiliza o custo da mercadoria vendida. Movimentos de capital e outros títulos patrimoniais também ficam fora do resultado; seus saldos e pagamentos continuam no financeiro.

A DRE usa competência: venda na operação, devolução na sua data, serviço na entrega e títulos manuais na competência informada. Custos usam snapshots do PDV e mão de obra/peças da assistência. Baixar um título não reconhece a receita/despesa novamente. Transferências, saldos iniciais e ajustes patrimoniais ficam fora da DRE. Cancelar título manual sem baixas exclui sua competência da DRE, preservando a trilha do cancelamento.

O fluxo realizado mostra movimentos registrados, incluindo PDV sem conta. O saldo de uma conta considera movimentos próprios e do PDV classificados nela. A previsão usa apenas o saldo aberto confirmado por vencimento. Taxas e diferenças são títulos separados. Nenhuma conciliação bancária, cobrança Pix/cartão ou envio de dinheiro é realizado automaticamente.

Serviços anteriores podem ter sido pagos fora do ERP. Seus títulos começam com saldo a conferir e ficam fora do aberto/previsto. A conferência registra o que ainda falta receber; o valor recebido antes da implantação atualiza o título sem criar entrada fictícia no caixa atual. A referência e o autor permanecem no histórico. Recebimentos posteriores usam baixas normais. O saldo inicial das contas deve considerar os movimentos históricos que serão classificados, evitando duplicação patrimonial.

## Segurança e atualização

Proprietário e gerente têm acesso, limitado às filiais autorizadas. Caixa, técnico e estoquista não acessam o financeiro. RLS isola empresas, chaves compostas protegem vínculos e bloqueios/versões/idempotência impedem duplicação ou baixa em excesso. Ledger e baixas são imutáveis para a role de runtime. Conciliação só permite anular suas colunas de vigência, mantendo conta, valor e referência originais. Estornos criam novos movimentos.

As migrações `202610280006_finance`, `202610280007_finance_opening_review` e `202610290008_finance_title_classification` preservam dados anteriores. A cópia offline anterior à atualização está em `backups/pre-modulo5-20261028`, fora do Git. Migrações aplicadas não foram substituídas.

## Verificação e limites

Validação local concluída: **67 testes de API/banco e cinco fluxos completos de navegador**, com os módulos 1 a 5. As telas financeiras foram inspecionadas em computador e celular; foram testadas a recuperação de período inválido e a classificação patrimonial sem duplicação de despesas.

Testes cobrem versão, idempotência, pagamentos concorrentes, baixas parciais, estornos, conciliação/desfazer, fontes do PDV e assistência, competência sem duplicação, custos, filial/consolidado, permissões, RLS, imutabilidade e importação de registros legados. O navegador verifica o fluxo financeiro e o reenvio após perda de resposta, exportação CSV, persistência e tela móvel, junto aos quatro módulos anteriores.

A DRE é gerencial: não apura tributos nem substitui demonstração contábil. PostgreSQL externo, identidade central e recuperação na infraestrutura escolhida continuam dependentes de homologação. Integrações bancárias, TEF, cobrança automática, fiscal, crediário e relatórios gerais futuros não foram antecipados.
