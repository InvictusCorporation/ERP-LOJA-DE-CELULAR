# Arquitetura — módulos 1 a 9

## Componentes

- Next.js/React: interface responsiva, servida na porta 3000.
- NestJS/Express: API na porta 4000, escutando somente loopback. O Next encaminha `/api` para a API na mesma origem.
- PostgreSQL de produção: Prisma como cliente transacional; consultas SQL parametrizadas, migrações SQL e RLS explícita.
- PGlite: PostgreSQL embarcado, persistente, para desenvolvimento e demonstração. Não é armazenamento em memória nem substituto de produção.

O monólito modular começou pelo domínio de estoque. Autenticação, segurança e banco estão separados da interface. Nenhuma credencial do banco é enviada ao navegador. A senha é derivada com scrypt e salt aleatório. Tokens de sessão são aleatórios, armazenados apenas por hash no banco e enviados em cookie HttpOnly/SameSite=Strict; produção exige HTTPS e Secure.

## Isolamento e transações

Tabelas de negócio usam RLS por empresa. A API estabelece `app.tenant_id` somente dentro da transação. Em modo embarcado, cada operação de negócio usa `SET LOCAL ROLE invictus_app`; em produção, a própria conexão deve autenticar nessa role. A aplicação recusa roles de produção diferentes, superusuárias ou com BYPASSRLS.

Usuários, vínculos e sessões formam o registro de identidade do servidor. Não são expostos por consultas livres. O endpoint de equipe é restrito ao proprietário e filtrado pela empresa da sessão. O provisionamento local usa a conexão administrativa somente em operações explícitas de criação de ambiente, filial e acesso. Esses endpoints de escrita são desabilitados em produção até a integração da central.

Permissões de filial são verificadas pela API. O catálogo é compartilhado pela empresa; saldos, inventários, aparelhos e movimentos pertencem a filiais. Chaves estrangeiras compostas impedem referências entre empresas. Há testes separados para RLS e autorização na API.

Movimentações usam bloqueio do produto e saldo, impedem saldo negativo e gravam saldo, ledger e auditoria atomicamente. Idempotência usa chave UUID, hash do comando e bloqueio transacional por empresa/chave. Reutilizar a chave com outro comando é conflito. O ledger e a auditoria não permitem UPDATE ou DELETE pela role da aplicação.

## Modelagem do catálogo

Cada variação vendável é um produto com SKU próprio, marca, modelo, cor e capacidade. Cada aparelho físico é uma unidade ligada ao produto, podendo conter vários IMEIs. IMEI tem validação de formato e dígito verificador. Série e IMEI são únicos dentro da empresa, inclusive após baixa; reentradas reutilizam a unidade existente.

Garantias são cadastradas como prazo em dias e termos do produto. Início e comprovantes de garantia vinculados à venda ou reparo dependem dos módulos correspondentes.

O valor de estoque exibido nesta etapa é uma estimativa pelo custo cadastrado do produto. A margem é `(venda − custo) / venda`; preço zero não tem margem percentual calculável. Custos individuais de aparelhos ficam disponíveis na rastreabilidade. Custeio contábil, média ponderada, DRE e resultados realizados pertencem à integração financeira futura.

## Integrações futuras

Identificadores internos de empresa, usuário e filial são UUIDs. A integração real deverá mapear os identificadores da central, definir a fonte responsável por cada cadastro e substituir o provisionamento local. O fluxo de autenticação local não deve ser mantido em paralelo com a identidade central sem necessidade confirmada.

O ponto existente terá autonomia comercial e técnica. Integração por contrato de API/eventos após inspeção do repositório; o ERP não implementa marcações ou cálculos de jornada nesta etapa.

Planos Básico/Profissional/Completo e Ponto independente permanecem planejados. Não existe cobrança recorrente, controle comercial de assinaturas ou personalização white label implementado nesta etapa.

## Mapa de módulos

Ordem definida pelo usuário: seguir **1, 2, 3, …, 12**, um módulo autorizado por vez. As bases mínimas de acesso, filial e pagamentos não equivalem à implementação integral dos módulos futuros.

1. Produtos e Estoque — implementado nesta etapa.
2. PDV — implementado: vendas, caixa, pagamentos, devoluções, comprovantes e relatórios por operador, integrado a clientes e financeiro.
3. Assistência Técnica — implementado: ordens, diagnóstico, fotos privadas, orçamentos, aprovação manual, peças, custos, entrega e garantia, com recebível gerado na entrega do reparo.
4. CRM — implementado: clientes compartilhados, compras/aparelhos/serviços, prazos de garantia, atividades, funil, responsáveis, lembretes e preferência de contato comercial.
5. Financeiro — implementado: pagar/receber, baixas e estornos, contas, centros, conciliação manual, fluxo realizado/previsto, DRE gerencial, margens e consolidação por filial.
6. Crediário — implementado: análise manual, limite com reserva de ofertas, venda financiada no PDV, contrato, parcelas, antecipação, recebimentos, estornos, renegociação e acompanhamento de atrasos integrados ao financeiro.
7. Compras — implementado: fornecedores compartilhados, rascunho/confirmação de pedidos, entregas parciais, conferência de unidades, estoque, contas a pagar, cancelamento de saldo e correção transacional de recebimentos.
8. Relatórios — implementado: séries diária/mensal, margens, ticket, produtos, equipe, serviços, posição atual de estoque/crédito e comparativos por filial.
9. Funcionários e Permissões — implementado: extensão dos vínculos existentes com cargo, função, filial, perfis, exceções individuais, histórico, inativação/reativação e contrato cadastral para o ponto.
10. Filiais — futuro; apenas cadastro básico e saldos separados nesta etapa.
11. Fiscal — futuro; integração homologada com provedor.
12. Ponto — futuro; reutilização do projeto existente e contratação independente.

## Compras e fornecedores

Fornecedores reutilizam `catalog_entries` com perfil complementar e versão, sem duplicar IDs. Pedidos são por filial: rascunhos editáveis têm linhas JSON; a confirmação grava linhas imutáveis e snapshot do fornecedor. Entregas preservam referência única por empresa/fornecedor, itens, quantidades e unidades, com IMEI/série e procedência no domínio existente de estoque. Eventos e correções de recebimento são registros adicionais imutáveis para a role de runtime. RLS e chaves compostas protegem empresas; a API valida filiais e restringe o módulo à gestão.

Recebimento bloqueia o pedido e produtos em ordem estável, confere saldo pendente e registra estoque/ledger e título a pagar na mesma transação. Versão e idempotência impedem duplicação após reenvio e excesso por concorrência. Títulos usam origem `purchase`, FK de recebimento e tratamento patrimonial, sem repetir CMV/despesa na DRE; pagamentos e estornos usam o financeiro existente. As movimentações não podem ser estornadas pelo estoque genérico, e os títulos não podem ser editados ou cancelados fora da origem.

Cancelamento do pedido encerra somente saldo pendente e preserva entregas/dívidas. Correção de recebimento é integral: exige ausência de baixas ativas, saldo suficiente e nenhuma movimentação posterior de unidades individuais, compensa o ledger e cancela o título da entrega. O custo opcional do catálogo segue o último recebimento confirmado, não média ponderada; não é restaurado automaticamente ao estornar. Documentos são de conferência e não fiscais. Devolução comercial parcial, XML e operações fiscais exigem etapas próprias.

## Crediário próprio

O módulo reutiliza clientes do CRM, venda/estoque do PDV e contas/ledger do financeiro. Perfil contém CPF e avaliação manual; ofertas congelam termos e dados do comprador, reservam principal e têm validade mínima de dois dias. Alteração das condições comerciais exige nova simulação antes de aprovar ou renegociar. Contrato e planos preservam revisões; parcelas, recibos, eventos de resultado e auditoria não admitem UPDATE/DELETE pela role da aplicação. RLS e referências compostas mantêm o isolamento por empresa; a API aplica filial e permissões adicionais. A busca do caixa não devolve CPF ou avaliação; o documento completo exige gestão ou o operador responsável pela venda, com auditoria de acesso.

Valores usam centavos inteiros, arredondamento por razão inteira e vencimentos mensais ancorados no dia original. Juros são simples por principal da parcela e dias/base 30. O CET decorre da taxa interna dos fluxos nas datas previstas. Antecipações abatem juros não decorridos; atraso calcula multa única sobre saldo no vencimento e mora simples sobre principal e dias efetivamente em aberto. Encargos vencidos são pagos primeiro, sem capitalização. Limites técnicos não equivalem a autorização jurídica de taxas.

Na venda a prazo, o caixa recebe somente a entrada; parcelas geram títulos patrimoniais, sem repetir a receita da mercadoria. Recebimentos reutilizam finance_settlements e finance_entries; redução nominal = dinheiro + abatimento − encargos. Juros previstos entram na competência do vencimento; antecipação realoca juros recebidos para a data do recebimento e elimina a parcela abatida. Multa/mora compõem receita quando recebidas. Estornos e renegociações usam eventos compensatórios. Renegociação considera só principal restante e preserva pagamentos; cancelamento integral compensa todos os planos e pagamentos, atomicamente com PDV/estoque, e é bloqueado por conciliação ativa.

## Transações do PDV

O PDV usa centavos inteiros. O servidor relê preços e disponibilidade, valida o total confirmado na interface, distribui descontos proporcionalmente com cálculo inteiro e grava venda, itens, pagamentos, estoque e auditoria na mesma transação. O registro do pagamento é separado do movimento de dinheiro no caixa: Pix/cartões não aumentam o saldo físico.

Cada caixa tem uma sessão por vez e cada operador tem no máximo uma sessão aberta por filial. Operações e fechamento bloqueiam a sessão; vendas bloqueiam produtos e saldos em ordem estável. Duas vendas não podem consumir a mesma última unidade. Chaves de idempotência protegem abertura, venda, sangria, suprimento, fechamento e devolução.

Cancelamentos e devoluções preservam a venda original. Quantidades e valores já devolvidos são considerados na próxima devolução. Os centavos de arredondamento são recuperados na última unidade; o total devolvido nunca supera o valor líquido original. Devoluções precisam de uma sessão própria aberta na filial, mesmo que a sessão original já tenha sido fechada.

Movimentos de estoque ligados ao PDV não podem ser estornados pelo endpoint genérico de estoque. Aparelhos vendidos retornam pelo fluxo de devolução para manter a coerência dos pagamentos. O papel de runtime não pode alterar ou excluir pagamentos, devoluções, itens ou lançamentos de dinheiro já registrados.

Relatórios são limitados pela empresa e filial. Operadores de caixa consultam suas próprias vendas e sessões; proprietário e gerente podem supervisionar a filial autorizada. O relatório básico por operador não substitui o futuro Módulo 8 de relatórios gerenciais.

## Ordens de serviço

As ordens preservam os dados recebidos do cliente e do aparelho. O cadastro mínimo compartilhado de clientes será reutilizado no CRM. Técnicos acessam somente suas ordens nas filiais autorizadas; custos e margens são restritos à gestão. Orçamentos e decisões do cliente são registros imutáveis. Mudanças de estado usam versão, bloqueio de linha e idempotência para impedir duplicação e sobrescrita por telas desatualizadas.

Peças movimentam o mesmo ledger do estoque em uma transação com a ordem. Consumo respeita o orçamento aprovado; devolução referencia o consumo original e seu custo. O estorno genérico de estoque recusa esses lançamentos. A conclusão exige relatório; devolver peças após concluir exige nova conclusão. Entrega encerra as escritas e inicia a garantia aprovada. Ordens recusadas ou canceladas permanecem aguardando retirada física, sem cobrança de reparo.

Fotos são bytes privados no banco, protegidos pelas mesmas verificações de empresa, filial e técnico. Aceitam JPEG, PNG e WebP de até 5 MB e 20 megapixels. O servidor remove metadados, corrige orientação e limita a imagem a 1600 pixels e 1,5 MB em JPEG. Cada ordem aceita até 12 fotos. O backup inclui as imagens; não há bucket público ou integração com armazenamento de objetos nesta versão.

O preço final usa a mão de obra aprovada e peças líquidas efetivamente consumidas. Custos de mão de obra e peças permitem acompanhamento operacional, sem substituir custeio contábil ou DRE. O comprovante de entrega não é recibo de pagamento nem documento fiscal.

## CRM e clientes

O módulo 4 amplia a tabela `customers` da assistência com localidade, observações, arquivamento e versão. Não cria um cadastro paralelo. A base pertence à empresa e é compartilhada entre filiais; proprietário e gerente podem administrá-la. Históricos transacionais, funil, agenda e atendimentos são filtrados pelas filiais autorizadas. Caixa consulta somente identificador, nome e quatro últimos dígitos do telefone na busca para venda; técnicos e estoquistas não acessam o CRM.

Vendas novas aceitam cliente opcional, validado na mesma transação e com nome preservado no comprovante. Ordens mantêm os dados recebidos originalmente. Alterar o cadastro não reescreve esses documentos. Vendas anônimas anteriores não são associadas por aproximação de nome ou telefone. O histórico de compras considera quantidades e valores devolvidos, identificadores individuais e garantia cadastrada a partir da data da venda em Fortaleza; serviços iniciam o prazo na entrega. A consulta dos prazos não decide automaticamente a cobertura de uma solicitação.

Oportunidades e lembretes pertencem à filial, referenciam o cliente e um proprietário/gerente ativo com acesso à unidade. Versões e idempotência impedem sobrescrita e duplicação; eventos comerciais são imutáveis. Encerrar ou reabrir oportunidade exige motivo. Uma oportunidade ganha não registra faturamento. A agenda mantém data/hora com fuso; pendências e atrasos são calculados no servidor, sem agendamento de mensagens ou notificações externas.

Preferência comercial tem evidência, autor e data, com revogação. No recebimento da assistência, a preferência inicial também gera evento. O link manual de WhatsApp exige cliente ativo e permissão; o ERP não guarda credenciais, envia mensagens ou afirma conexão com a API do WhatsApp. O cadastro não exige documentos pessoais, endereço completo ou data de nascimento. Notas devem conter apenas o necessário ao atendimento. Eventos gerais de auditoria não copiam o conteúdo do cadastro; detalhes de contato ficam no histórico protegido do CRM. Arquivamento mantém documentos e impede novas operações; política de retenção, atendimento a solicitações de titulares e avaliação jurídica de produção ainda devem ser definidos pela empresa.

## Gestão financeira

O módulo 5 separa competência, baixas e classificação bancária. Títulos manuais operacionais reconhecem receitas/despesas na competência. Títulos patrimoniais, como compras de estoque, mantêm saldos e baixas sem duplicar despesas na DRE, que já considera o custo da mercadoria vendida. Vendas são reconhecidas na operação, devoluções na data da devolução com reversão proporcional do CMV, e serviços na entrega, usando custos preservados de mão de obra e peças. Baixas mudam os saldos abertos e o fluxo realizado, sem reconhecer novamente a receita/despesa. DRE e margem são gerenciais, sem apuração fiscal. Cancelamento de título manual sem baixas exclui sua competência, mantendo o evento.

Financeiro utiliza contas por filial e centros compartilhados. Transferências têm duas pernas na mesma transação; saldos iniciais, transferências e ajustes patrimoniais não entram na DRE. O saldo da conta soma entradas e saídas próprias e movimentos do PDV classificados nela. O fluxo registrado inclui operações do PDV ainda sem conta; a classificação posterior não duplica o movimento. Abertura de caixa, sangria e suprimento do PDV não são novas receitas/despesas financeiras. Taxas são lançadas separadamente.

Triggers com privilégios do chamador e RLS gravam os recebimentos/devoluções do PDV e recebível da assistência na transação de origem. Chaves de origem e identificadores estáveis impedem duplicação. Migrações adotam operações anteriores. Serviços anteriores à implantação ficam com saldo a conferir, pois podem ter sido pagos externamente. A conferência documentada informa o saldo aberto e o valor recebido anteriormente, sem criar entrada fictícia nas contas atuais. Até essa conferência, o título não participa de aberto/previsto. Serviços novos entregues após a atualização geram recebível normal.

Ledger e baixas aceitam somente SELECT/INSERT na role de runtime. Estornos são lançamentos compensatórios; versões e bloqueios de título impedem baixa em excesso. Conciliação tem conta, valor exato, data e referência conferidos manualmente. Bloqueios transacionais consultivos serializam conciliação e estorno sem conceder UPDATE ao ledger. Desfazer só altera as colunas de vigência da conciliação, preservando conta e referência originais. Eventos e auditoria registram responsáveis e justificativas.

Proprietário e gerente têm acesso; relatórios, contas e movimentos respeitam filiais autorizadas. Consolidação reúne somente essas filiais, com RLS por empresa e chaves compostas. Não há integração bancária automática, cobrança ou transmissão de dinheiro. Credenciadoras, fiscal, crediário e relatórios gerais permanecem nas etapas correspondentes. PostgreSQL externo e recuperação na infraestrutura de produção ainda precisam de homologação.


## Relatórios gerenciais — módulo 8

A API GET /reports/{overview,products,stagnant,sellers,technicians,services,credit} é somente leitura. ReportsService exige reports_read (proprietário/gerente), valida a seleção de filiais contra a identidade e consulta sob a role com RLS por empresa. Nenhum endpoint cria snapshots ou altera saldos. Parâmetros são vinculados; ordenação usa lista permitida. Períodos válidos entre 2000 e 2199, sem futuro, limitados a 366 dias inclusivos; tabelas usam páginas de 30 registros e limite de consulta de 10 segundos.

Financeiro e relatórios compartilham financialFactsCte e financialResult, preservando competência, custos históricos, compensações e receitas do crediário. A visão consolidada consulta fatos e coorte de vendas em uma única instrução SQL e deriva resumo, séries diária/mensal e filiais desse mesmo conjunto. Inteiros consolidados fora do limite seguro são recusados. Margem/ticket sem denominador positivo ficam sem valor, em vez de infinito.

Estoque parado e crédito representam posição atual, com data de referência separada do período. Não há reconstrução histórica desses saldos. As abas são consultas independentes; Atualizar consulta a situação mais recente. O frontend mantém filtros em edição separados dos filtros aplicados, descarta respostas de consultas substituídas e desabilita exportação/impressão durante carregamento ou erro. CSV protege células textuais contra fórmulas; a impressão é renderizada diretamente no body, com cabeçalho e critérios aplicados.

A migração 202611010011_reports acrescenta somente índices de consulta. Não modifica tabelas de negócio nem migrações anteriores. Homologação de carga e planos no PostgreSQL externo ainda é necessária para produção.


## Funcionários e permissões — módulo 9

O funcionário é o vínculo existente memberships.id, que continua referenciando users.id. A migração 202611010012_employees amplia esse vínculo, preserva perfis anteriores e preenche nomes/filial de trabalho a partir dos registros existentes. Nome na empresa, cargo, função, matrícula opcional, identificação no ponto, filiais, exceções e versão pertencem ao vínculo. Não há cadastro paralelo de pessoas nem alteração de identidade global. Contas novas locais reutilizam o provisionamento administrativo; produção mantém novas contas na central.

src/shared/access.ts define os perfis e o cálculo único de permissões efetivas para API, seleção de responsáveis e prévia do editor. Bloqueios prevalecem; a retirada de uma dependência remove ações dependentes. As permissões reservadas são read, users, branches e credit_settings. O proprietário mantém acesso integral. Administrador possui operação e gestão de funcionários, sem provisionamento de filiais ou política de crédito; não gere proprietários/administradores nem concede direitos que não possui. Gerente mantém seu padrão anterior; vendedor amplia o padrão de caixa com CRM; financeiro acessa financeiro/custos e crediário. Estoquista, consulta, caixa e técnico mantêm seus padrões anteriores.

A identidade é lida do vínculo ativo em toda requisição. Alterações encerram as sessões do funcionário somente na empresa atual, preservando acessos em outras empresas; pedidos já em execução podem concluir. Dados pessoais do próprio proprietário podem mudar sem encerrar sua sessão, mas o próprio acesso e o acesso de proprietários são protegidos. Operações de equipe serializam gravações por empresa e revalidam o ator dentro da transação. Versão e idempotência evitam sobrescrita e duplicação, inclusive após resposta perdida.

A gestão exige users e perfil proprietário/administrador. Só ficam disponíveis funcionários com todas as filiais dentro do acesso do gestor. Antes de retirar acesso/filial, verificam-se caixa aberto, ordens ainda não entregues e pendências ativas de CRM atribuídas ao funcionário. Reatribuição e fechamento usam os módulos de origem. Todos os módulos anteriores consultam a identidade efetiva; seleção de responsáveis do CRM e assistência usa a mesma regra, incluindo exceções e situação ativa.

memberships mantém o SELECT global que já era usado pela autenticação antes da seleção de empresa. A nova política RLS de UPDATE limita escrita à empresa da transação; somente colunas de gestão recebem UPDATE. IDs, empresa, usuário vinculado e credenciais globais não recebem permissão de escrita pelo runtime. Filtros de empresa e filial são obrigatórios nos endpoints de funcionários. Essa exceção interna de leitura para autenticação não é uma API pública de diretório. A autorização por perfil permanece no serviço, e credenciais administrativas não podem ser usadas pela API de produção.

O histórico mostra operações do ator e mudanças de seu vínculo, com motivo somente para alterações de funcionário. Detalhes arbitrários dos módulos de origem não são copiados para o painel. CSV cobre a página atual e protege textos contra fórmulas. O contrato de ponto schema_version=1 exporta employee_id (vínculo), user_id, tenant_id, identificador externo opcional, dados funcionais, filiais, situação e versão. integration_status=mapping_only e attendance=null deixam explícita a ausência de sincronização e registros de jornada. Matrícula e identificação externa são únicas por empresa quando preenchidas. A ligação real depende do projeto existente no módulo 12; buscas nos repositórios conectados não localizaram esse projeto e nenhum endereço foi fornecido nesta etapa.
