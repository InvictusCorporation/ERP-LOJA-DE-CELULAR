# Entrega — módulo 8: Relatórios Gerenciais

Versão 0.8.0. Continuação dos módulos 1 a 7. O próximo módulo é **9**, ainda não iniciado.

## Entregue

- Faturamento diário e mensal, dias sem movimento zerados, lucro bruto operacional, margem, resultado gerencial da DRE e ticket médio.
- Comparativo de filiais e consolidação somente das unidades autorizadas.
- Produtos vendidos com quantidades brutas, devoluções, saldo líquido, receita, custo histórico e margem; busca por nome/SKU e ordenação por quantidade, receita ou lucro.
- Produtos parados por filial, saldo positivo, última venda líquida, última entrada, dias sem atividade e custo estimado de estoque.
- Desempenho dos vendedores com vendas registradas/mantidas, devoluções atribuídas ao operador original, receita, lucro, margem e ticket.
- Técnicos: conclusões e entregas no período, tempo corrido até conclusão, ordens abertas e atrasadas atualmente. Lista de serviços entregues com receita, custo, margem, responsável e filial.
- Inadimplência atual: saldo nominal aberto/vencido, percentual e faixas de 1–30, 31–60, 61–90 e mais de 90 dias. Consolidado de todas as filiais selecionadas, além do detalhamento paginado.
- Filtros aplicados explicitamente, atualização, paginação, CSV e impressão, estados vazios/erro e uso em telas pequenas.

## Definições que afetam a leitura

**Faturamento líquido operacional** = vendas − devoluções + serviços entregues com resultado pronto. **Lucro bruto operacional** deduz CMV e custo dos serviços. A **DRE gerencial** acrescenta receitas manuais e do crediário e desconta despesas operacionais por competência, reutilizando os mesmos fatos e cálculo do Financeiro. Recebimentos, transferências, saldos iniciais e compras de estoque não geram receita ou despesa novamente.

Vendas entram na data da venda; devoluções e seu custo compensatório, na data da devolução. Um período pode conter receita/quantidade líquida negativa por devolver vendas anteriores. A situação atual de uma venda não apaga seus movimentos históricos. Custos históricos do PDV não são recalculados pelo custo atual do cadastro.

**Ticket das vendas** = saldo mantido das vendas criadas no período ÷ número dessas vendas com saldo positivo, considerando todas as devoluções conhecidas no momento da consulta. Vendas integralmente devolvidas/canceladas não entram no denominador. Essa coorte difere dos movimentos de devolução reconhecidos no período. Margens ficam sem valor quando a receita líquida não é positiva; ticket fica sem valor quando não há vendas mantidas.

**Estoque parado** é uma posição atual: saldo positivo sem venda líquida ou entrada há pelo menos N dias (1–730). Última venda considera itens com quantidade ainda mantida após devoluções. Reposição, entrada por devolução ou ajuste positivo reiniciam o prazo por produto/filial. Produtos novos não são classificados como parados apenas por nunca terem vendido. Não há rastreamento FIFO da idade de cada unidade. Custo estimado usa custo atual do cadastro para quantidade e aquisição das unidades disponíveis para controle individual.

**Técnicos**: conclusão usa a última data em que a ordem ficou pronta e considera ordens prontas ou entregues com reparo realizado. Entrega usa seu próprio dia e resultado pronto. A atribuição é ao responsável atual. Tempo é a média de dias corridos entre abertura e conclusão, incluindo espera, e não representa horas trabalhadas, produtividade por jornada ou controle de ponto. Abertas incluem ordens ainda aguardando retirada; atrasadas em execução excluem prontas, recusadas e canceladas.

**Serviços** incluem mão de obra aprovada e peças líquidas efetivamente utilizadas, após devoluções. Ordens recusadas/canceladas não geram receita de reparo. A consulta não retorna telefone, CPF, IMEI ou nome de cliente.

**Inadimplência** considera contratos ativos e apenas seus planos vigentes, títulos não cancelados/conferidos e baixas válidas após estornos. O abatimento nominal considera pagamento + desconto − encargos. Vencido significa vencimento anterior a hoje; parcelas vencendo hoje não estão atrasadas. Percentual = saldo nominal vencido ÷ saldo nominal aberto. Encargos ainda não lançados não são estimados no saldo gerencial. Renegociações não duplicam planos antigos. Estoque/crédito não reconstroem o saldo na data final de um período passado.

## Segurança e limites

Consultas GET somente para proprietário e gerente, com RLS por empresa e validação de cada filial selecionada. Caixa, técnico, estoque e consulta não recebem dados gerenciais. Não há gravação de operações pelo módulo. SQL parametrizado, ordenações permitidas, limite de 10 segundos por consulta e checagem de inteiros seguros.

Período de até 366 dias inclusivos, datas válidas entre 2000 e 2199 e sem futuro. Horário de Fortaleza. As abas consultam posições independentes, identificadas pela geração; não representam um fechamento contábil imutável. Corrija fontes pelo módulo de origem e atualize os relatórios.

Tabelas usam 30 registros por página; CSV/impressão cobrem a página atual. Inadimplência acrescenta um consolidado que inclui todas as filiais selecionadas, mesmo fora da página. A visão consolidada exporta a série completa do período limitado e as filiais. Textos de CSV recebem proteção contra fórmulas. Documentos são gerenciais e não fiscais. Margens dependem dos custos cadastrados, sem rateio de despesas por produto/vendedor.

## Operação e aprendizados

Migração `202611010011_reports` adiciona somente índices. Backup offline anterior em `backups/pre-modulo8-20261101/invictus`, fora do Git. Migrações antigas foram preservadas. Não houve implantação em servidor externo.

Cada resposta da interface é vinculada à chave de sua consulta (aba, filtros aplicados, página e atualização). Limpar dados somente dentro de um efeito deixa um render intermediário usar a resposta da aba anterior; esse caso foi encontrado no teste de troca de abas e corrigido. Respostas substituídas não alteram a tela e controles de exportação ficam indisponíveis sem dados correspondentes.

Impressão usa um portal no body para evitar espaço herdado do painel. Testes de impressão inspecionam o elemento por seletor estável, pois regras de visibilidade podem retirar o contêiner externo da árvore de acessibilidade, mantendo o documento imprimível. Mensagens de erro são buscadas dentro do painel, evitando confusão com o anunciador de navegação do Next.js.

Filtros em edição não mudam o cabeçalho de dados já consultados. Séries longas precisam permitir barras com largura fracionária e tabelas precisam rolagem própria para não ampliar a página em celular. Fixtures históricas usam horário intermediário do dia para não deslocar a data de Fortaleza ao gravar meia-noite UTC.

Homologação de carga, planos de consulta e migração no PostgreSQL externo permanece necessária antes da produção.


## Validação da entrega

Regressão de API, banco, persistência e cálculos: **110 testes aprovados**. Inclui vendas/devoluções em períodos diferentes, ticket líquido e cancelamento integral, vendedor original, custo histórico, serviços com devolução de peças, estoque reposto/novo/parado por filial, paginação acima de 30 produtos, busca literal, RLS/perfis, datas e limite de período e ausência de escritas ao consultar.

As suítes Financeiro e Crediário também comparam seus resultados com os novos relatórios durante competência, baixas, transferências, devoluções, serviços, antecipações, renegociações, estornos e cancelamentos. Faixas de atraso foram verificadas nos limites de 0, 1, 30, 31, 60, 61, 90 e 91 dias.

Navegador: **9 fluxos aprovados**, em grupos de 5 + 4 para respeitar o limite de provisionamento local. O fluxo de relatórios cobre dados reais de uma empresa de teste isolada, abas, filtros aplicados, CSV com proteção contra fórmula, impressão sem espaço superior indevido, filial vazia, falha/repetição de consulta, responsividade e série diária de 366 dias em 390 px. As capturas da interface e impressão foram inspecionadas visualmente. Nenhum dado fictício foi adicionado à empresa da loja.

Verificação de tipos e compilação de produção aprovadas. A execução local usa a base persistente da loja; testes de navegador usam exclusivamente .data/e2e.
