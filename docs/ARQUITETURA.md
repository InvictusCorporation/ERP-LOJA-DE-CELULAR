# Arquitetura — módulos 1 a 4

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

Ordem definida pelo usuário: seguir **1, 2, 3, …, 12**, sem antecipar módulos 9 ou 10. As bases mínimas de acesso, filial e pagamentos não equivalem à implementação integral dos módulos futuros.

1. Produtos e Estoque — implementado nesta etapa.
2. PDV — implementado: vendas, caixa, pagamentos, devoluções, comprovantes e relatórios por operador. Clientes e financeiro avançado serão conectados nas etapas 4 e 5.
3. Assistência Técnica — implementado: ordens, diagnóstico, fotos privadas, orçamentos, aprovação manual, peças, custos, entrega e garantia. Recebimentos aguardam integração financeira.
4. CRM — implementado: clientes compartilhados, compras/aparelhos/serviços, prazos de garantia, atividades, funil, responsáveis, lembretes e preferência de contato comercial.
5. Financeiro — futuro; títulos, liquidações e resultados.
6. Crediário — futuro; PDV, clientes e financeiro.
7. Compras — futuro; estoque e contas a pagar.
8. Relatórios — futuro; consolidação dos módulos operacionais.
9. Funcionários e Permissões — futuro; apenas perfis mínimos do estoque nesta etapa.
10. Filiais — futuro; apenas cadastro básico e saldos separados nesta etapa.
11. Fiscal — futuro; integração homologada com provedor.
12. Ponto — futuro; reutilização do projeto existente e contratação independente.

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
