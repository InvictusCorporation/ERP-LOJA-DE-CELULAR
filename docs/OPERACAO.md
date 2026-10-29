# Operação e recuperação

## Desenvolvimento

O modo embarcado é permitido somente fora de `NODE_ENV=production`. Dados locais ficam em `.data/invictus`, fora do Git. Não execute dois processos de API sobre o mesmo diretório. O comando `pnpm dev` compila e inicia API e interface; reinicie após alterações na API.

Há um arquivo de bloqueio com o PID do processo para impedir duas aberturas simultâneas. Bloqueios de processos encerrados são recuperados na próxima abertura. No Windows, o aplicativo normaliza a marca de somente leitura das pastas do banco, necessária em diretórios sincronizados pelo OneDrive. Mesmo assim, sincronização de pasta não substitui backup consistente; em produção utilize PostgreSQL externo.

Use a origem exata `http://localhost:3000`. Se alterar host/porta, atualize `APP_ORIGIN`. Escritas exigem origem válida, JSON e, após login, token CSRF da sessão. O limitador de autenticação é local ao processo; produção com réplicas exige um limitador compartilhado ou no proxy.

## Backup local

Pare a aplicação. Em PowerShell:

```powershell
$env:BACKUP_OFFLINE_ACK='yes'
pnpm db:backup
pnpm db:restore backups/ARQUIVO.tar.gz .data/restaurado
```

A restauração recusa um diretório já existente. Após validar o ambiente restaurado, configure `DATA_DIR=.data/restaurado` e reinicie. O teste automatizado verifica persistência após fechar/reabrir e restauração em um diretório independente.

Os arquivos de backup contêm dados pessoais e hashes de autenticação. Guarde-os com acesso restrito e criptografia no armazenamento; a compactação local não aplica criptografia.

## PostgreSQL de produção

Atualizações do ERP usam migrações incrementais. Pare as escritas, preserve um backup e execute `pnpm db:migrate` com a conta administrativa antes de iniciar a nova versão. Não substitua o banco nem reaplique manualmente a migração inicial. No ambiente local, as migrações são aplicadas na abertura da API, que fica pronta antes da interface iniciar. A assistência adiciona a quarta migração, `202610280004_repairs`; migrações já aplicadas não devem ser editadas.

1. Disponibilize PostgreSQL em rede privada com TLS. Separe homologação e produção.
2. Configure `DATABASE_URL` com o usuário de runtime `invictus_app` e `MIGRATION_DATABASE_URL` com a conta administrativa de migração. Não use segredos no frontend ou no Git.
3. Execute `pnpm db:migrate`. A migração inicial cria `invictus_app` sem LOGIN. A conta de migração precisa de permissão para criar roles. Se o provedor não permitir, o DBA deverá adaptar esse provisionamento antes da implantação.
4. O DBA deve conceder LOGIN e uma senha segura a `invictus_app`, sem propriedade das tabelas, superusuário, herança de roles administrativas ou BYPASSRLS. A conta administrativa não pode ser usada pela API.
5. Provisione a empresa, filial, identidade e vínculo com a central por um processo administrativo transacional auditado. O adaptador real ainda depende do projeto existente; a API de produção não oferece autocadastro local.
6. Configure `DB_MODE=postgres`, `NODE_ENV=production` e `APP_ORIGIN=https://DOMINIO`. Compile com `pnpm build` e inicie com `pnpm start`.
7. Termine HTTPS em proxy confiável, habilite proteção de borda e monitore logs, disponibilidade, espaço e falhas de backup. A topologia inicial usa os dois processos no mesmo host; a API escuta loopback.
8. Habilite backups gerenciados e PITR, teste uma recuperação e registre os tempos observados. A meta proposta de RPO de 15 minutos/RTO de 4 horas ainda não foi comprovada na infraestrutura de produção.

Os testes locais não comprovam o comportamento da conexão Prisma contra o PostgreSQL hospedado. Rode a homologação no provedor escolhido, verificando role, RLS, concorrência e restauração antes de utilizar dados reais de uma loja.

## Recuperação e incidentes

O módulo 6 adiciona `202610290009_store_credit`. A cópia offline anterior foi preservada em `backups/pre-modulo6-20261029`. Após restaurar, confira perfis/CPF, limites, ofertas ainda reservadas, contratos e revisões, parcelas, recibos, contas, descontos e eventos da DRE. A cópia contém dados privados e não acompanha o Git.

O crediário inicia desabilitado. O proprietário deve registrar a revisão real dos termos, taxas e método antes de habilitar ofertas; aprovações de comprador e consultas externas são manuais. Revise acessos a documentos e proteja contratos exportados com dados pessoais. Não há mensagens automáticas, conexão com bureaus, assinatura eletrônica ou cobrança bancária. A primeira implantação de produção exige homologação das migrações e do ledger no PostgreSQL escolhido, além da validação dos documentos comerciais.

Para corrigir recebimento, desfaça sua conciliação e use estorno no crediário. Títulos de parcelas não permitem baixa/edição pelo fluxo financeiro genérico. Renegociação preserva recibos e cria novo calendário somente para principal aberto; encargos não recebidos são dispensados. Devolução de venda financiada é integral com restituição dos recebimentos e nova venda dos produtos eventualmente mantidos. A confirmação de ressarcimento é manual e deve corresponder aos valores efetivos conferidos fora do ERP.

O módulo 5 adiciona `202610280006_finance`, `202610280007_finance_opening_review` e `202610290008_finance_title_classification`. A cópia offline anterior fica em `backups/pre-modulo5-20261028`. Confira títulos, baixas, ledger, contas, conciliações, classificação operacional/patrimonial e saldos importados após restaurar. Não altere migrações já aplicadas. Novas migrações locais são aplicadas antes de a interface ficar pronta.

Após atualizar, confira os recebimentos/devoluções do PDV que aguardam conta e os saldos anteriores de serviços entregues. Serviços antigos podem ter sido pagos externamente: ficam fora do aberto/previsto até a conferência documentada. A baixa posterior usa a conta efetiva e referência. Informe saldos iniciais de contas sem duplicar movimentos históricos que ainda serão classificados. Conciliação é manual, sem credenciais ou conexão bancária automática.

Baixas não são excluídas. Desfaça a conciliação antes de estornar; o sistema grava compensação e preserva a origem. Confira referências de extrato e centros de custo. Cancelamentos manuais sem baixas retiram o título da DRE gerencial por competência, preservando o evento. Integração bancária, apuração fiscal e validação contábil exigem trabalho específico.

O módulo 4 adiciona a quinta migração, `202610280005_crm`, sem substituir os clientes existentes. A cópia offline anterior à atualização fica em `backups/pre-modulo4-20261028`. Confirme clientes, vínculos de vendas, oportunidades, lembretes, preferências e eventos após restaurar o banco. Não edite migrações aplicadas. Dados de CRM e evidências de contato acompanham os mesmos backups privados do ERP.

O CRM é restrito à gestão. Revise os acessos de empresa e filial antes de usar informações pessoais reais. A busca do caixa retorna dados mínimos; não concede acesso aos históricos. Contatos e lembretes são manuais/internos. A integração oficial com WhatsApp, seus contratos, credenciais e regras de envio permanecem pendentes de uma implementação específica.

Antes da atualização local do módulo 3 foi preservada uma cópia offline em `backups/pre-modulo3-20261028`. Esse diretório é local e não acompanha o Git. As fotos das ordens ficam no banco e devem ser incluídas nas verificações de restauração. Monitore espaço, tempo de backup e acesso aos dados pessoais. Para volumes maiores, planeje armazenamento privado de objetos e sua recuperação conjunta antes de migrar as imagens.

Ordens entregues são somente consulta. Correções de peças devem ocorrer pelo fluxo da assistência antes da entrega, preservando consumos e devoluções. Consulte os históricos e a trilha de eventos ao reconciliar uma ordem com o estoque.

Bloqueie escritas durante a recuperação. Preserve os dados atuais para análise; restaure em um destino separado. Confira empresas, filiais, produtos, saldos e quantidade de movimentos, depois execute reconciliação entre saldo e ledger. Somente então faça a troca de conexão.

Para suspeita de sessão comprometida, um administrador pode remover os registros correspondentes em `sessions` por processo controlado. Nunca altere o ledger para corrigir saldo: use movimentação compensatória e preserve a auditoria.

## Publicação no GitHub

Repositório definido para este ERP: https://github.com/InvictusCorporation/ERP-LOJA-DE-CELULAR. A primeira publicação usa a branch `main`, preservando a branch local de trabalho `codex/produtos-estoque`. O workflow é acionado por push e pull request. Segredos ficam nas configurações do ambiente/gerenciador de segredos, nunca no repositório.
