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

Bloqueie escritas durante a recuperação. Preserve os dados atuais para análise; restaure em um destino separado. Confira empresas, filiais, produtos, saldos e quantidade de movimentos, depois execute reconciliação entre saldo e ledger. Somente então faça a troca de conexão.

Para suspeita de sessão comprometida, um administrador pode remover os registros correspondentes em `sessions` por processo controlado. Nunca altere o ledger para corrigir saldo: use movimentação compensatória e preserve a auditoria.

## Publicação no GitHub

Repositório definido para este ERP: https://github.com/InvictusCorporation/ERP-LOJA-DE-CELULAR. A primeira publicação usa a branch `main`, preservando a branch local de trabalho `codex/produtos-estoque`. O workflow é acionado por push e pull request. Segredos ficam nas configurações do ambiente/gerenciador de segredos, nunca no repositório.
