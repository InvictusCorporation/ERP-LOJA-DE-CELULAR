# Arquitetura — módulos 1 e 2

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
3. Assistência Técnica — futuro; estoque, clientes, técnicos e financeiro.
4. CRM — futuro; cadastro e históricos comerciais.
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
