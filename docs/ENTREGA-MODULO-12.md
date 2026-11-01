# Módulo 12 — Preparação da integração de ponto

Versão 0.12.0. Preparação autorizada enquanto o projeto de ponto existente não está disponível. **O lado cadastral do ERP está preparado para revisão; o adaptador, a autenticação, a habilitação comercial e a homologação com o projeto existente continuam pendentes. Não há ponto eletrônico operacional nesta entrega.**

## Funcionalidades entregues

- Painel **Ponto e frequência**, na sequência dos módulos. Destino da integração por empresa: nome do sistema, URL base HTTPS sem credenciais/parâmetros/fragmento, identificador externo da empresa, ambiente pretendido e observações. Nenhuma URL é acessada pelo servidor; selecionar produção não ativa conexão nem assinatura.
- Vínculo de cada filial existente com a identificação correspondente no ponto. Identificador único por empresa, edição/limpeza versionadas, incluindo unidades inativas para preservar o histórico. Sem novo cadastro de filiais.
- Lista paginada/pesquisável dos funcionários do módulo 9, com matrícula, cargo, filial principal, situação e identificador externo. Atalho para editar no cadastro existente, sem duplicar pessoas. Nome funcional e ID continuam no vínculo `memberships`, sem modificar a identidade global.
- Indicadores reais de cadastros e pendências dentro do acesso do usuário. IDs preenchidos significam somente cadastro preparado para revisão, não conexão validada. Funcionários antigos sem filial principal aparecem como pendência; não são omitidos. O primeiro acesso passa a preencher nome funcional/filial principal do proprietário a partir do cadastro da empresa.
- Pacote cadastral JSON imutável e auditado, com retrato da configuração, filiais, vínculos funcionais e pendências. Contém somente funcionários cujas filiais estejam integralmente no acesso do ator. Inclui inativos para permitir discussão de desativação futura; não presume que tenham sido enviados anteriormente. Sem e-mail, senha, permissões, CPF, biometria, marcações ou horas.
- Exportação de até 500 funcionários por pacote. Acima disso, recusa o preparo sem salvar um arquivo truncado; os contadores continuam cobrindo todo o escopo, não só a página. O adaptador definitivo deve definir envio em lotes. Busca/paginação da lista de funcionários não limita o conteúdo exportado.
- Pacotes anteriores preservam o estado original e o escopo. Remover uma filial do acesso revoga consulta/download de pacotes que a incluam. Hash do conteúdo normalizado, auditoria de preparação/download e idempotência após resposta perdida. Não existe fila de transmissão nem status de envio fictício.
- Portas internas tipadas para capacidades, entrega cadastral e reconciliação futura, sem adaptador registrado. Proposta de contrato descrita em [INTEGRACAO-PONTO.md](INTEGRACAO-PONTO.md) e [JSON Schema](contracts/point-mapping-v1.schema.json). O contrato individual do módulo 9 continua com os mesmos campos e `schema_version=1`.

## Acesso e isolamento

Proprietário: configura destino e vínculos de filial, consulta e prepara/baixa pacotes. Administrador: consulta/prepara dentro das próprias filiais; não altera destino ou vínculos de filial. `point_settings` é reservada ao proprietário. `point_read` depende de `users`, e `point_export` depende de `point_read`; conceder o direito de ponto isoladamente não libera a gestão de pessoas a outro perfil. Administrador pode ter consulta/exportação retiradas individualmente.

RLS por empresa nas três novas tabelas. Leitura de `memberships` sempre inclui tenant explícito porque o fluxo de autenticação possui leitura global. Escopo exige acesso a todas as filiais do funcionário. Referências de filial são compostas por empresa; a role runtime não reatribui tenant/filial nem modifica/remove pacotes. Configurações e mapeamentos têm versão, idempotência e auditoria sem cópia de nomes para detalhes de eventos.

O retrato do pacote lê configuração, filiais e funcionários em uma única instrução SQL, com o mesmo snapshot MVCC. A criação do arquivo e a auditoria são transacionais. Permissões e escopo são conferidos novamente no download; manter um link antigo não mantém autorização.

## Limites explícitos

`status=not_connected`, `provider_contract=unverified`, `subscription_status=not_verified`, `can_sync=false`, `attendance=null` e `last_sync_at=null`. Rotas de conectar/sincronizar recusam a operação com erro 409. Não há autenticação entre sistemas configurada, webhook, agendador, tráfego externo ou cobrança. As portas internas não afirmam quais endpoints o sistema existente possui.

Não são implementados marcações, cálculo de jornada, escalas, horas extras, espelho, AFD, AEJ ou conexão a equipamentos. O pacote cadastral não é um documento legal de jornada. O módulo não é declarado conforme à legislação trabalhista/LGPD nem liberado para uso comercial. Requisitos e documentação do sistema de ponto/PTRP, integridade, exportação e proteção/retenção de dados devem ser validados antes da disponibilização. Dados dos pacotes e seus backups exigem controle de acesso e política de retenção a definir antes da produção comercial.

Alterar nome, URL, ambiente ou empresa de destino não valida nem converte IDs já preenchidos. Todos os vínculos devem ser revisados contra o destino real antes de enviar qualquer cadastro. Licenciamento deve ser confirmado pela central no servidor; nenhum campo do formulário concede habilitação. O projeto de ponto continuará independente e poderá atender outros segmentos sem depender das tabelas ou da contratação deste ERP.

## Pendências para conectar o projeto existente

1. Disponibilizar o repositório/documentação e analisar arquitetura, autenticação, tenants, filiais, funcionários, eventos, capacidades e identidade estável. Confirmar se os IDs e os dados mínimos desta proposta são suficientes.
2. Acordar contrato/versionamento, fonte de autoridade de cada campo, desativação/reativação, reatribuição de filial e política para troca de destino. Não enviar credenciais, e-mail ou outros dados pessoais por conveniência.
3. Implementar um adaptador específico, credenciais apenas no servidor, destinos permitidos, proteção de tráfego, timeout, limites e reconciliação de respostas incertas. Rotas externas e assinatura/autenticação de eventos só depois de conhecer o protocolo real.
4. Validar habilitação comercial com a central, preservando contratação independente e isolamento entre empresas. A ausência de autorização deve manter o módulo desconectado.
5. Homologar primeira associação, atualização, desativação, repetição, falhas, reordenação de eventos, isolamento, restauração, dados de frequência e arquivos exigidos, com o projeto e responsáveis competentes.

## Operação

Migração `202611010015_point_preparation`, preservando migrações anteriores e IDs existentes. Backup offline anterior em `backups/pre-modulo12-20261101/invictus`; chave fiscal companheira preservada se existente. Nada foi alterado no VPS ou em outros projetos. Novas tabelas não exigem segredo adicional nem conexão externa. Homologação de migração/privilégios/concorrência e restauração no PostgreSQL externo continua necessária.

## Aprendizados e correções

- Um sistema ausente permite preparar o lado ERP, mas não comprovar compatibilidade de um adaptador. Estado de preparação, campos preenchidos, habilitação e conexão precisam ser distintos.
- Um filtro por filial principal ocultava o proprietário recém-criado quando o vínculo ainda tinha `home_branch_id` nulo. Cadastros incompletos devem aparecer com pendência. O primeiro acesso agora preenche a filial explicitamente cadastrada para o proprietário.
- `users.id` identifica a conta global; `memberships.id` identifica o funcionário na empresa. A criação existente retorna os dois (`id` e `employee_id`); integração e edição funcional devem usar o segundo.
- Leitura de autenticação global exige predicado de tenant explícito para uso funcional de memberships. RLS das tabelas novas, sozinha, não resolve essa diferença.
- Paginação não pode produzir pacote silenciosamente incompleto. Limite precisa ser verificado antes de persistir e os contadores precisam medir o escopo completo.
- JSONB pode reordenar chaves. Hash usa uma serialização definida e compartilhada, com teste do arquivo efetivamente baixado, sem alegar padrão de assinatura legal.
- A autorização de um arquivo pessoal precisa considerar todo o escopo original no momento de baixar. Acesso antigo não deve sobreviver à retirada de uma filial.
- Metadados para revisão não são uma fila de sincronização. Configurar produção ou um endereço não deve disparar tráfego.

## Fontes oficiais

[MTE — Registro Eletrônico de Ponto](https://www.gov.br/trabalho-e-emprego/pt-br/assuntos/inspecao-do-trabalho/fiscalizacao-do-trabalho/rep) e [perguntas e respostas da Portaria 671](https://www.gov.br/trabalho-e-emprego/pt-br/assuntos/inspecao-do-trabalho/fiscalizacao-do-trabalho/Perguntas%20e%20Respostas%20REP), consultados para identificar os documentos/requisitos a analisar na integração, sem declarar conformidade deste preparo.

## Validação

Testes de ponto cobrem vínculo original, isolamento, HTTPS sem credenciais, configuração versionada, duplicidade de identificação de filial, preparação idempotente, hash, snapshot, acesso administrativo, mudança de escopo, inativos, cadastro antigo sem filial, RLS e limite de 500. Navegador percorre cadastro existente, preparação, resposta perdida sem duplicação, download com hash, conexão recusada, computador/celular de 390 px e configuração reservada ao proprietário. Validação local concluída: 168 testes de API/banco/cálculos/recuperação aprovados, incluindo 15 verificações do ponto; 13 fluxos de navegador aprovados em grupos de 5 + 5 + 3, com regressão dos módulos anteriores. Tipos e compilação de produção aprovados. Auditoria das dependências de produção sem vulnerabilidades conhecidas; nenhuma dependência nova. Capturas de computador/celular inspecionadas.
