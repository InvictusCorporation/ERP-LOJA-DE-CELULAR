# Entrega — módulo 10: Gestão de Filiais

Versão 0.10.0. Continuação autorizada após os módulos 1 a 9. Módulos 11 e 12 permanecem pendentes.

## Entregue

- Cadastro único de filiais, com nome, código opcional por empresa, contatos, endereço, versão, motivo de alteração e situação ativa/inativa.
- Cadastro dentro da empresa já provisionada pelo proprietário, também no runtime de produção, sob RLS. Criação do caixa principal e acesso dos proprietários na mesma transação; demais funcionários mantêm atribuição explícita.
- Visão da unidade com saldo físico, unidades identificadas, caixas cadastrados/abertos e funcionários ativos com acesso. Quantidade identificada é subconjunto do estoque; equipe com acesso não equivale a presença ou jornada.
- Consulta paginada de estoque por unidade e atalhos para inventário, caixas/vendas e equipe, reutilizando os módulos anteriores.
- Resultados individuais e comparativos/consolidados pelo mesmo componente e API de Relatórios Gerenciais, com seus filtros, CSV, impressão e regras de cálculo.
- Transferência de produtos por quantidade e por IMEI/série, com conferência manual de saída e recebimento, atualização atômica das duas filiais, rastreabilidade e documento interno imprimível.
- Correção integral com movimentos compensatórios em ambas as filiais, preservando registros originais, exigindo saldo e integridade das unidades.
- Inativação condicionada à resolução de pendências, reativação e histórico preservado. Operações recusadas em unidades inativas, inclusive de telas antigas.
- Busca, filtros e paginação de 30 registros, interface responsiva e impressão sem espaço superior indevido.

## Transferências e custos

Uma transferência representa mercadoria cuja saída e recebimento já foram conferidos. São aceitos até 30 produtos e 200 unidades identificadas por operação. Cada produto por quantidade aparece uma vez no pedido; cada unidade física precisa estar disponível na origem. O servidor determina nomes, SKUs, custos e disponibilidade, sem confiar nesses valores enviados pelo navegador.

Cada item gera saída e entrada vinculadas no ledger existente. Unidades mantêm o mesmo ID, IMEI, série, procedência e custo de aquisição, mudando somente a localização física. O custo de catálogo de produtos por quantidade é preservado como referência no item; não há média ponderada nem alteração automática do cadastro. Valores de custo no endpoint de detalhe só são devolvidos quando há permissão de custo. A transferência não é venda, receita, despesa, pagamento ou novo título financeiro. Dívidas de compras continuam na origem da compra.

O comprovante usa nomes das filiais e dos produtos preservados na operação. É documento interno de conferência, não fiscal. Não há emissão/transmissão de documento fiscal, integração com transportadora, mercadoria em trânsito, recebimento parcial ou conferência independente por dois operadores nesta etapa. Não registre mercadoria ainda em trânsito como recebida.

## Correção e concorrência

Correção é integral. O destino precisa ter a quantidade total atual de cada produto. Para quantidade, não há identidade de lote/FIFO: saldo reposto pode atender à correção; ela não desfaz uma venda ou atribui origem individual a mercadorias fungíveis. Para unidades identificadas, localização, situação em estoque e revisão física precisam corresponder à transferência original. Qualquer atualização posterior de unidade avança sua revisão; uma saída/entrada ou ida/volta posterior não se torna elegível só por ter voltado ao destino.

Se houve movimento posterior, use nova transferência de retorno quando a unidade estiver disponível. Retorno parcial também é nova transferência. Não estorne uma perna pelo fluxo genérico de estoque e não edite a unidade diretamente no banco. O sistema recusa essas correções isoladas.

Produtos são bloqueados em ordem, e todos os itens são validados antes dos lançamentos. Quantidade insuficiente ou unidade inválida desfaz toda a transação. Idempotência impede duplicação após resposta perdida; repetir com os mesmos dados usa a mesma chave no cliente. Antes de alterar dados de uma operação de resultado incerto, confira seu histórico. A correção usa trava consultiva por transferência e unicidade do registro compensatório; cabeçalhos e itens continuam sem UPDATE/DELETE na role runtime.

## Acesso e situação da filial

Cadastro e situação exigem proprietário com `branches`, direito reservado ao perfil. `branch_read` consulta a gestão; `branch_transfer` depende de `branch_read` e `stock`. Proprietário, administrador e gerente recebem leitura/transferência; financeiro recebe leitura; estoquista recebe leitura/transferência, sem custo por padrão. Exceções individuais do módulo 9 podem restringir os direitos não reservados.

Transferência, detalhe e correção exigem acesso às duas filiais. O histórico oculta operações em que alguma das unidades esteja fora do acesso. Custos respeitam sua permissão específica. A API e as novas tabelas mantêm isolamento de empresa, com parâmetros vinculados, FKs compostas e RLS.

Antes de inativar, não pode haver estoque disponível, caixa aberto, ordem aguardando encerramento/retirada, compra em rascunho/confirmada/parcial, pendência CRM, oferta de crédito vigente, título aberto/a conferir, conta financeira ativa/com saldo ou movimento financeiro sem conta. Funcionário ativo não pode manter a unidade como filial principal ou único acesso ativo. Deve restar uma filial ativa na empresa. Reatribuição, encerramento e conciliação usam os módulos de origem.

Filial inativa sai das opções de operação em ME, mas seus IDs autorizados e dados antigos permanecem disponíveis para consultas pelo painel e relatórios. Reativar reutiliza o cadastro e seus históricos. Não há exclusão física. Edição de metadados e logs de acesso a documentos permanecem possíveis; novos lançamentos operacionais são bloqueados.

Triggers nos fluxos de estoque, unidades, caixas/PDV, ordens, financeiro, crediário, compras e pendências CRM bloqueiam escritas em filiais inativas. Usam bloqueio compartilhado da filial antiga/nova, coordenado com a inativação. Atendimentos comerciais do CRM vinculados a filial verificam também sua situação sob bloqueio compartilhado, sem depender de um lançamento de estoque ou financeiro. Operação que já obteve o bloqueio conclui antes da decisão de inativar, que verifica seus efeitos confirmados. Metadados compartilhados da empresa não se tornam exclusivos de uma unidade.

## Persistência e operação

Migração `202611010013_branches`. Preserva cadastros e saldos anteriores, acrescenta metadados, transferências, vínculos ao ledger, revisão física de unidades e proteção de operação por filial. Não modifica migrações já aplicadas. Backup offline anterior em `backups/pre-modulo10-20261101/invictus`, fora do Git.

Criar filial dentro da empresa existente usa a transação da role runtime. Criar empresa/identidades globais novas continua pelo provisionamento administrativo. Não há DNS, assinatura, personalização comercial de domínio ou implantação de servidor nesta etapa. Nenhum projeto externo ou VPS foi alterado.

Homologue privilégios, triggers, concorrência, consultas e restauração no PostgreSQL externo antes da produção. Testes locais exercitam RLS e transações no PostgreSQL embarcado, sem comprovar carga e infraestrutura externas.

## Aprendizados incorporados

- Permitir transferência não dispensa acesso à origem e ao destino; consultar somente uma unidade não deve revelar documento da outra.
- Duas movimentações independentes podem duplicar ou perder estoque. Saída, entrada, localização física, documento e trilha precisam ser confirmados na mesma transação.
- Ordenação de horário não prova ausência de movimentação posterior. Revisão física monotônica detecta alterações mesmo quando a unidade volta à mesma localização/situação.
- Uma tabela imutável não precisa receber UPDATE apenas para obter bloqueio de linha. Trava consultiva por entidade serializa a correção preservando seus privilégios.
- Ocultar filial inativa no seletor não impede uma tela antiga de enviar requisições. A situação precisa ser conferida dentro da transação e coordenada com a inativação.
- Eventos comerciais que não movimentam estoque/financeiro precisam de sua própria verificação de filial ativa. Logs de leitura documental são diferentes de novo atendimento comercial.
- Pesquisa de IMEI/série e botões de paginação dentro do formulário não podem enviar a transferência implicitamente. Enter na pesquisa é interceptado, e paginação/repetição usam botões que não submetem o formulário.
- Custos e relatórios existentes devem ser reutilizados; redistribuição interna não é nova receita. Contagem de funcionários com acesso não representa frequência de ponto.


## Validação

**139 testes de API/banco/cálculos verificados nas suítes**, incluindo regressão dos módulos anteriores e 14 verificações da nova suíte de filiais. Cobrem criação e acesso automático dos proprietários, caixa por filial, código/versão/idempotência, transferência mista, conservação de quantidade/custo, ausência de faturamento, correção integral, revisão física após saída/entrada posterior, venda/devolução de unidade transferida, rollback, disputa pela última unidade, acesso às duas filiais, custo oculto, filial inativa em tela antiga, pendências de equipe/caixa/financeiro, CRM em unidade inativa, concorrência entre inativação e entrada e imutabilidade/RLS das transferências.

**11 fluxos de navegador aprovados**, em grupos de 5 + 5 + 1 para respeitar o limite de provisionamento. O fluxo de filiais cadastra pela interface, transfere quantidade/unidade, simula resposta perdida após gravar e repete sem duplicação, imprime, corrige, consulta estoque/resultados/consolidado, inativa/reativa, verifica recusa de tela antiga e oculta a gestão para caixa sem direito. Enter na pesquisa não submete operação confirmada. Capturas de computador, celular em 390 px e impressão foram inspecionadas visualmente. Todas as empresas/registros desses testes são sintéticos em .data/e2e, separados da base da loja.

Verificação de tipos e compilação de produção aprovadas. A execução local da loja permanece separada dos bancos sintéticos de teste.
