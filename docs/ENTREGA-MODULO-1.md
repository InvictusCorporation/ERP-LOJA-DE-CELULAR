# Entrega — Produtos e Estoque

Data: 28/10/2026. Escopo autorizado: infraestrutura mínima e Módulo 1. Implementação funcional validada localmente; implantação comercial em produção ainda depende das verificações e integrações abaixo.

## Implementado

- Interface responsiva em preto, branco e amarelo, com visão geral, catálogo, aparelhos, movimentações, inventário, cadastros auxiliares, auditoria e configuração básica.
- Cadastro de categorias, marcas, modelos e fornecedores.
- Produtos por SKU/variação, código de barras, condição, cor, capacidade, custo, venda, margem e garantia.
- Aparelhos individualizados, múltiplos IMEIs, validação de dígito verificador, série, procedência, fornecedor e custo individual.
- Entradas, saídas, reentradas de aparelhos, contagens, ajustes, estoque mínimo, alertas e estornos.
- Histórico imutável para a role da aplicação, auditoria e proteção contra arquivamento com saldo.
- Isolamento por empresa, saldo por filial, permissões no backend, RLS e referências entre registros da mesma empresa.
- Sessões HttpOnly, CSRF, origem controlada, senhas com scrypt, limite de tentativas e ausência de credenciais padrão.
- Comandos transacionais e idempotentes. A interface reutiliza a chave quando uma resposta falha e o mesmo comando é reenviado.
- Persistência local PostgreSQL embarcada e caminho de produção com PostgreSQL/Prisma.
- Scripts de backup/restauração local e documentação operacional.
- Workflow de testes, compilação e auditoria de dependências para execução futura no GitHub.

Não há dados comerciais inventados. Os testes de navegador criam empresas chamadas **Demonstração automatizada**, com **Loja de testes** e produto **Cabo USB-C verificado**. São registros de teste, isolados das empresas que o usuário cadastrar.

## Evidências de validação

| Verificação                           | Resultado observado                                                        |
| ------------------------------------- | -------------------------------------------------------------------------- |
| Compilação completa (`pnpm build`)    | Aprovada: geração Prisma, Next.js e TypeScript do servidor                 |
| TypeScript da interface e servidor    | Sem erros                                                                  |
| Testes automatizados da API/banco     | 14 testes reportados pelo runner, todos aprovados                          |
| Teste completo no Chromium            | Aprovado                                                                   |
| Visual desktop, 1440 × 1000           | Screenshot inspecionado                                                    |
| Visual móvel, 390 × 844               | Screenshot inspecionado; menu e ausência de overflow da página verificados |
| Backup e restauração                  | Persistência após reabertura e recuperação em outro diretório aprovadas    |
| Auditoria de dependências de produção | Nenhuma vulnerabilidade conhecida encontrada na consulta final             |

Os testes de API cobrem duas empresas, autorização por filial, RLS direta no banco, SKU único, valores monetários inválidos, CSRF, origem, operações concorrentes, idempotência, estoque insuficiente, inventário desatualizado, estoque mínimo, IMEI duplicado/inválido, rollback, estorno, perfis restritos, proteção dos custos, edição concorrente, arquivamento, imutabilidade e revogação de sessão.

Também foram verificados: recuperação após encerramento forçado de um subprocesso, reabertura de diretório marcado como somente leitura no Windows/OneDrive e recusa de dois processos simultâneos sobre o mesmo banco local. A normalização remove somente a marca de leitura das pastas do banco no Windows; os arquivos de dados e as ACLs não são substituídos. O encerramento normal usa uma mensagem de desligamento para fechar a API e o banco antes de finalizar os processos.

O teste de navegador executa cadastro da empresa, login, produto, entrada, inventário e alerta; recarrega a aplicação e confirma os registros. Também interrompe a resposta de uma entrada **depois de o servidor gravar** e verifica que a tentativa seguinte usa a mesma chave e mantém cinco unidades, sem duplicar para dez.

Capturas locais: `test-results/produtos-desktop.png` e `test-results/produtos-mobile.png`. O diretório é ignorado pelo Git; o workflow publica as evidências como artefato quando executado no GitHub.

## Dependências de segurança

A auditoria inicial encontrou três avisos em dependências indiretas. Foram aplicadas versões corrigidas por overrides em `pnpm-workspace.yaml`, com nova geração Prisma, testes e compilação:

- Effect 3.20.0 — [aviso GHSA-38f7-945m-qr2g](https://github.com/advisories/GHSA-38f7-945m-qr2g).
- DeepmergeTS 8.0.0 — [aviso GHSA-ggr8-5vv4-36mx](https://github.com/advisories/GHSA-ggr8-5vv4-36mx).
- Multer 2.5.0 — [aviso GHSA-q7qp-rjg7-q26m](https://github.com/advisories/GHSA-q7qp-rjg7-q26m).

A consulta final não garante ausência de vulnerabilidades desconhecidas. O workflow repete a auditoria para dependências de produção.

## Limites e pendências para produção

1. O projeto de ponto e a central white label ainda não foram disponibilizados. Autenticação central, provisionamento, personalização e assinaturas não foram simulados como integrados.
2. O PostgreSQL hospedado e a conexão Prisma de produção ainda precisam de homologação no provedor escolhido. Os testes executados aqui usam PostgreSQL embarcado, sem Docker ou servidor PostgreSQL externo instalado.
3. Provisionamento local de empresas, filiais e acessos é bloqueado em produção. O processo da central precisa ser conectado antes da implantação comercial.
4. O valor do estoque é estimado pelo custo cadastrado; não representa custeio contábil ou lucro realizado. Custos individuais ficam registrados nos aparelhos.
5. Inventário de aparelhos não cria ou elimina identidades automaticamente: as divergências exigem reconciliação por unidade.
6. Backups locais são compactados; criptografia, retenção externa, PITR e metas de recuperação precisam ser configurados na infraestrutura comercial.
7. O limitador de tentativas é por processo e precisa ser compartilhado ou aplicado na borda quando houver várias réplicas.
8. Repositório definido após a entrega local: https://github.com/InvictusCorporation/ERP-LOJA-DE-CELULAR. A publicação inicial usa `main`; a branch local de trabalho é `codex/produtos-estoque`. Os resultados acima são das verificações locais; as execuções remotas do workflow devem ser consultadas no GitHub Actions.

Os módulos 2–12 permanecem fora da implementação. A próxima etapa depende de nova autorização expressa.
