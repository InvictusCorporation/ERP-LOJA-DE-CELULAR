# Entrega — módulo 9: Funcionários e Permissões

Versão 0.9.0. Continuação autorizada após os módulos 1 a 8. O módulo 10 permanece pendente.

## Entregue

- Equipe reutilizando `users` e `memberships`, incluindo os acessos já cadastrados, sem outro cadastro de pessoas.
- Nome específico da empresa, cargo, função, matrícula opcional, filial de trabalho e filiais autorizadas.
- Perfis proprietário, administrador, gerente, vendedor, operador de caixa, técnico, financeiro, estoquista e consulta. Perfis anteriores preservados.
- Exceções individuais entre padrão, permitir e bloquear, com prévia de acesso efetivo e remoção transitiva das ações dependentes.
- Cadastro local, edição versionada com motivo, inativação/reativação sem excluir operações e revogação das sessões da empresa após alteração de outro funcionário.
- Busca por nome/e-mail/matrícula/cargo, filtros por situação e filial, páginas de 30 registros e CSV da página atual.
- Histórico paginado de operações do funcionário e de mudanças do vínculo, com motivo das alterações de cadastro.
- Identificador externo de ponto opcional e exportação JSON do vínculo com IDs estáveis, empresa, filiais, dados funcionais, situação e versão.
- Interface responsiva; permissões em blocos no celular, mostrando configuração e acesso efetivo juntos.

## Autoridade e isolamento

Somente proprietário e administrador gerem funcionários. O administrador não gere proprietário ou outros administradores, não promove contas a esses perfis e não concede direitos que não possui. Todas as filiais do funcionário precisam estar no acesso do gestor, inclusive para abrir o cadastro. A filial de trabalho deve constar nas filiais autorizadas; novas seleções precisam ser ativas e pertencer à empresa.

O próprio acesso e o acesso de proprietários não podem ser rebaixados, inativados ou ter suas filiais/exceções removidas por esse fluxo. O proprietário pode editar seus dados funcionais preservando o acesso integral. Contas de proprietário adicionais são provisionadas pela central. As permissões `read`, `users`, `branches` e `credit_settings` são reservadas ao perfil e não aceitam exceções individuais.

Vendedor parte do perfil de caixa e inclui CRM; financeiro recebe financeiro/custos e crediário. Administrador recebe operação e gestão de equipe, sem provisionamento de filiais ou política de crédito. Consultar custo de estoque, custo histórico do PDV, custo de assistência e resultado financeiro são direitos distintos; seus nomes indicam isso no editor. Não se deve interpretar a retirada de um deles como retirada dos demais.

Nome funcional, situação, permissões e identificação de ponto pertencem ao vínculo da empresa. Não alteram nome global, e-mail, senha ou situação global de uma conta compartilhada. Sessões de outras empresas permanecem válidas. Contas globais inativas dependem da central para liberação. Não há exclusão física de funcionário nem troca arbitrária do usuário vinculado.

## Aplicação das permissões

`src/shared/access.ts` é o cálculo único de acesso efetivo. Ele é usado na identidade devolvida ao navegador, nas verificações de autorização, na filtragem de custos e na elegibilidade de responsáveis do CRM e assistência. Verificações anteriores que usavam apenas o nome do perfil foram substituídas, inclusive o acesso ao documento de crediário.

Bloquear uma dependência retira as ações que dependem dela. Por exemplo, bloquear o próprio caixa retira venda, gestão do PDV, desconto/devolução e venda com crediário dependentes; bloquear custo do estoque retira gestão do catálogo e o relatório gerencial que depende dele. Permitir uma ação sem suas dependências não a torna efetiva; a prévia mostra o resultado.

A identidade consulta o vínculo ativo em cada nova requisição. Alterações de outro funcionário encerram suas sessões nesta empresa; reativar o vínculo não restaura sessões antigas. Requisições já em execução podem concluir e não são canceladas retroativamente. O nome pessoal do próprio proprietário pode mudar sem encerramento de sua sessão.

Antes de retirar o acesso correspondente, verificam-se caixas abertos, ordens ainda não entregues e tarefas/oportunidades ativas do CRM. O gestor deve fechar ou reatribuir pelos módulos de origem. A consulta verifica as pendências existentes na transação de alteração; não constitui cancelamento de operações já autorizadas e em andamento em outras requisições.

## Persistência e segurança

Migração `202611010012_employees`. Amplia vínculos existentes, preenche nome/filial inicial e adiciona índices, unicidade de matrícula/identificador externo quando preenchidos e RLS de escrita por empresa. Preserva o SELECT interno global de vínculos usado pela autenticação antes da seleção de empresa; os endpoints de equipe filtram explicitamente empresa e filiais. A API de runtime ganha UPDATE somente nas colunas de gestão, sem alteração de IDs/empresa/usuário vinculado nem escrita em credenciais globais.

Novas contas locais usam o provisionamento administrativo existente. Em produção, novas contas continuam pela central; gestão dos vínculos existentes usa a transação da empresa sob a role runtime. Homologação de PostgreSQL externo, privilégios, concorrência e recuperação continua necessária.

Gravações de equipe são serializadas por empresa, revalidam a autoridade dentro da transação e usam versão e chave de idempotência. Replay após resposta perdida não cria outra conta ou alteração. Senhas iniciais são armazenadas somente como hash; o histórico não inclui senha ou hash. Matrícula e ID externo repetidos na mesma empresa são recusados atomicamente. CSV protege células textuais contra fórmulas.

Backup offline anterior: `backups/pre-modulo9-20261101/invictus`, preservado fora do Git. Não houve alteração de VPS ou de projetos externos. O desenvolvimento permanece no repositório ERP-LOJA-DE-CELULAR; o módulo 9 parte do módulo 8 ainda em revisão.

## Limite da integração de ponto

O vínculo exportado tem `schema_version=1`, `employee_id=memberships.id`, `user_id`, `tenant_id`, identificador externo opcional, nome, matrícula, cargo/função, filial principal, filiais autorizadas, situação e versão. Não inclui e-mail, senha, permissões ou dados de jornada. `integration_status=mapping_only` e `attendance=null` indicam que é um contrato cadastral exportável, sem envio ou sincronização.

O projeto de ponto não foi localizado entre os repositórios conectados e seu endereço não foi fornecido nesta etapa. A conexão real, autenticação entre sistemas, importação, frequência e regras de jornada dependem da análise e integração do projeto existente no módulo 12. Não foi criado um segundo sistema de ponto, um endereço fictício ou um botão de sincronização sem implementação.

## Aprendizados incorporados

- Esconder menus não revoga autorização. Todas as decisões de servidor e listas de responsáveis precisam usar o acesso efetivo, não somente o perfil nominal.
- Uma conta pode existir em mais de uma empresa: inativar o vínculo e revogar somente suas sessões evita bloquear a outra empresa ou modificar sua identidade global.
- O cadastro anterior deve ser ampliado e manter IDs de usuários nas vendas, serviços e auditoria. Inativação não equivale a exclusão.
- Versão, chave de repetição e revalidação do gestor na transação são necessárias para mudanças concorrentes e respostas perdidas.
- No celular, tabela larga de permissões esconde a configuração. Blocos com rótulo, seleção e resultado efetivo mantêm a operação acessível sem rolagem lateral.
- Capturas após redimensionar devem aguardar o término da transição da barra lateral. A ausência de rolagem horizontal não garante que a animação já terminou.
- Nomes de funcionário na tabela incluem metadados de conta; testes usam o texto do nome ou a linha correspondente, sem exigir que a célula inteira contenha apenas esse nome.

- Listas de nomes de permissões devem verificar propriedades próprias do catálogo; nomes herdados de Object, como __proto__ e toString, não são permissões válidas. Perfis desconhecidos não ganham direitos por nomes herdados.

## Validação

**125 testes de API, banco e cálculos aprovados**, incluindo regressão dos módulos anteriores, cadastro idempotente, alteração concorrente, unicidade, perfis preservados, dependências, direitos reservados, limites de administrador, proteção de proprietário, sessão revogada, reativação, isolamento de empresa/filial, conta compartilhada, caixas e pendências, filtragem de custos, elegibilidade de responsáveis, histórico paginado, contrato de ponto e RLS de escrita/colunas protegidas. O crediário verifica também que a restrição individual de um gerente impede acesso ao documento sem depender do nome do perfil. A validação estrita dos nomes de permissões foi novamente verificada nas suítes de funcionários e crediário.

**10 fluxos de navegador aprovados**, em dois grupos de 5 para respeitar o limite de provisionamento local. O novo fluxo cadastra pela interface, simula resposta perdida após gravar e repete sem duplicação, exporta vínculo/CSV, autentica outra sessão, bloqueia venda e suas dependências, inativa/reativa, confere preservação do histórico e proteção do próprio acesso. Capturas de computador e celular foram inspecionadas; controles de permissões cabem em 390 px, após término da transição da barra lateral. As empresas e os registros usados nesses testes são explicitamente sintéticos, em .data/e2e, separados da loja.

Verificação de tipos e compilação de produção aprovadas. A base persistente da loja permanece separada dos testes automatizados.
