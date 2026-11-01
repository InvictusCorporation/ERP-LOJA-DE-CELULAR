# Contrato proposto pelo ERP para integração de ponto

Esta especificação descreve somente a preparação implementada no ERP 0.12.0. Ainda não é um contrato aceito pelo sistema de ponto existente. Nenhuma URL abaixo é um endpoint presumido do provedor. O projeto externo não foi analisado.

## Fronteiras

ERP é responsável por seu vínculo funcional, empresa e filiais. Marcações originais, comprovantes, jornadas, apuração e relatórios pertencem ao projeto de ponto. A autoridade de cada campo e os conflitos de atualização devem ser acordados antes de conectar. O ponto não deve importar permissões ou depender da existência/assinatura do ERP para sua operação independente.

`src/server/point-adapter.ts` declara portas internas para consultar capacidades, entregar um manifesto e reconciliar a situação de uma entrega. Não há implementação, registro de adaptador, autenticação entre sistemas ou chamada dessas portas nesta etapa. `pending` em uma implementação futura não poderá ser tratado como confirmação de processamento.

## Endpoints locais do ERP já implementados

Todos usam a sessão existente e empresa escolhida no login; o cliente não fornece tenant arbitrário. Escritas exigem a origem configurada, JSON, CSRF e uma UUID em `Idempotency-Key`. Consultas não são cacheadas.

| Método e rota | Direito | Resultado |
|---|---|---|
| GET `/api/point/overview?q=&page=1` | point_read + users | Configuração, filiais autorizadas, totais/pendências completos e página de 30 funcionários visíveis. Sem marcações. |
| POST `/api/point/settings` | point_settings, proprietário | Salva perfil preliminar com `version` esperada; versão inicial 0. |
| POST `/api/point/branches/:id` | point_settings, proprietário | Salva `external_branch_id` e versão esperada. String vazia limpa o vínculo e incrementa versão. |
| POST `/api/point/exports` | point_export | Corpo `{}`. Cria artefato local de revisão e retorna ID/hash. Não envia dados. |
| GET `/api/point/exports?page=1` | point_export | Histórico paginado de 20 pacotes cujo escopo inteiro ainda está autorizado. |
| GET `/api/point/exports/:id` | point_export | Conteúdo original, metadados e hash, com auditoria do download. |
| POST `/api/point/connect` ou `/api/point/sync` | point_settings | Sempre 409 nesta versão: integração ausente, sem tráfego externo. |

Perfil: `provider_name`, `base_url` HTTPS sem usuário/senha/query/fragmento, `external_tenant_id`, `environment` (`sandbox`/`production`), `notes`, `version`. Não existem campos de habilitação comercial, token, senha, segredo ou webhook. URL é somente documentação do destino pretendido. Não criar um cliente HTTP genérico baseado nesse campo sem validar allowlist, rede e protocolo.

Vínculo do funcionário é editado pela rota existente PUT `/api/employees/:employee_id`, com seu controle completo de versão/escopo/motivo e direitos de gestão. Não há nova tabela de pessoas. `employee_id` é `memberships.id`; `user_id` é a conta global, potencialmente compartilhada com outras empresas. `external_employee_id` vem de `point_external_id`, único dentro da empresa quando preenchido. Não usar nome, matrícula ou e-mail como chave implícita de associação. Um identificador externo preenchido não prova propriedade da empresa no provedor: o adaptador deverá confirmar a empresa autorizada na autenticação e impedir associação indevida entre tenants. Conferir também a regra de maiúsculas/minúsculas do sistema existente; o ERP preserva os identificadores informados.

Erros: 400 para estrutura/URL inválidas; 401 para sessão expirada; 403 para direito/filial ausentes; 404 para arquivo ou entidade inexistente na empresa; 409 para versão, duplicidade, integridade ou tentativa de conectar; 422 para pacote acima de 500 funcionários. Conflitos transacionais seguem o tratamento geral do ERP.

## Manifesto de revisão v1

[JSON Schema 2020-12](contracts/point-mapping-v1.schema.json). O discriminador é `purpose=employee_mapping_review`, não somente `schema_version=1`.

- Identificação: tenant ERP, origem, horário de geração UTC e versão da configuração.
- Destino preliminar: nome, URL, identificador da empresa e ambiente. Notas internas não são exportadas.
- Escopo: IDs das filiais existentes integralmente autorizadas ao ator, com nome, situação, identificador externo opcional, versão cadastral e do mapeamento.
- Funcionários: mesmo objeto cadastral individual já exportado pelo módulo 9, com versão 1 e `integration_status=mapping_only`. Inclui nome funcional, IDs, matrícula opcional, cargo/função, filial principal, filiais, situação efetiva da conta/vínculo e versão. Inativos são preservados. Filial principal pode ser nula em um cadastro antigo, sempre acompanhada de pendência.
- Pendências: destino incompleto, filiais/funcionários sem identificação e funcionários sem filial principal. `local_mapping_complete=true` afirma somente preenchimento dos cadastros dentro do escopo, não correção dos IDs ou autorização para envio.
- Estado fixo: `integration_status=not_connected`, `provider_contract=unverified`, `subscription_status=not_verified`, `attendance=null`.

Somente funcionários com todas as suas filiais dentro do acesso do ator entram no pacote. Um administrador de uma unidade não recebe funcionários com acesso adicional a outra unidade. Ausência de uma pessoa no pacote nunca deve significar exclusão automática no destino. O adaptador deve validar empresa, escopo, IDs e autorização novamente antes da entrega, inclusive quando o pacote era acessível no momento em que foi criado. Pacote não é autorização de envio futura nem credencial de acesso.

Cada pacote congela os dados de uma única leitura SQL. Mudanças posteriores não alteram o arquivo; para rever alterações, gerar outro pacote. A implementação futura deve rejeitar/revalidar snapshots desatualizados conforme o acordo de versões. Mudança de destino requer revisão de todos os mapeamentos; esta versão não os migra entre provedores.

## Integridade e repetição

Serialização `canonicalPointJson`: ordena chaves de cada objeto com `Object.keys().sort()` do JavaScript, mantém a ordem dos arrays e representa valores pela serialização JSON. O arquivo é compacto, UTF-8 sem BOM, com SHA-256 dos bytes dessa serialização. Essa regra é própria desta proposta, não uma declaração de implementação de JCS/RFC 8785 ou de assinatura digital. O serviço e o navegador compartilham a função e o teste confere os bytes baixados. JSONB pode reordenar objetos sem alterar esse hash.

Uma chave de operação perdida é reutilizada pelo cliente para recuperar o mesmo ID; uma nova operação intencional usa outra chave e pode gerar outro snapshot. Não há status `sent`, tentativas de rede ou confirmação externa armazenados. Um adaptador real deve definir uma fila transacional, chave estável de entrega, referência externa, timeout e reconciliação antes de repetir uma resposta incerta. Webhooks, se existentes no projeto externo, exigirão autenticação, deduplicação, proteção contra repetição e ordenação/versionamento acordados. Nada disso é simulado como concluído nesta versão.

## Critérios para habilitar o adaptador real

Contrato e autenticação aceitos pelos dois projetos; empresa/filiais/IDs conferidos; credenciais protegidas apenas no servidor; habilitação comercial confirmada pela central; capacidades negociadas; primeira entrega e reenvio reconciliados em homologação; atualização/inativação/reativação e mudança de filial verificadas; isolamento entre empresas comprovado; logs sem dados pessoais desnecessários; recuperação e retenção definidas. Para relatórios de frequência, definir unidade, fuso, competência, origem, revisão e autorização sem recalcular jornada no ERP por conta própria.

Validar com os responsáveis do projeto as exigências legais/documentais, integridade, comprovantes e arquivos apropriados. O manifesto não é AFD, AEJ, espelho ou comprovante de ponto. A validação jurídica/técnica do sistema não pode ser substituída por IDs preenchidos ou um teste HTTP bem-sucedido.
