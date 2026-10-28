# Invictus ERP Mobile

Primeira etapa: **Produtos e Estoque**, com infraestrutura mínima. Os módulos 2–12 não estão implementados. O ambiente começa vazio e não contém contas ou mercadorias fictícias pré-cadastradas.

## Executar localmente

Requisitos: Node.js 24 e pnpm 11.

```powershell
pnpm install
pnpm exec prisma generate
pnpm dev
```

Abra http://localhost:3000 e escolha **Primeiro acesso? Criar empresa local**. Cadastre a empresa, a primeira filial e uma senha com pelo menos 12 caracteres. Entre com os dados cadastrados.

O banco PostgreSQL embarcado (PGlite) fica em `.data/invictus`. Os registros sobrevivem ao reinício da aplicação. Essa opção permite demonstração e desenvolvimento sem Docker; **produção exige PostgreSQL externo**, migrações e provisionamento administrativo.

## Fluxo de demonstração

1. Em **Cadastros auxiliares**, crie categorias, marcas, modelos e fornecedores.
2. Em **Produtos**, cadastre cada variação com seu SKU, cor, capacidade, preço e garantia. Celulares podem usar controle individual.
3. Pela ação de movimentar, registre uma entrada. Para aparelhos, informe IMEI válido ou série, procedência e custo individual.
4. Consulte **Aparelhos e IMEIs** e **Movimentações**.
5. Em **Inventário**, configure o estoque mínimo e registre uma contagem física. Divergências de aparelhos exigem reconciliar as unidades individualmente antes de concluir a contagem.
6. Confira os indicadores e a auditoria. Recarregue a página para confirmar a persistência.

Em **Configurações**, o proprietário pode cadastrar filiais básicas e acessos locais. Os perfis mínimos são proprietário, gerente, estoquista e consulta. A gestão completa de funcionários e filiais pertence a etapas futuras.

## Verificações

```powershell
pnpm typecheck
pnpm test
pnpm exec playwright install chromium
pnpm test:e2e
pnpm build
```

Os testes de API usam PostgreSQL embarcado real, role sem privilégios de proprietário e políticas RLS. O teste de navegador cria uma empresa claramente identificada como teste. Para manter a demonstração separada, use `DATA_DIR=.data/e2e` ao iniciar a aplicação para esse teste.

## Documentação

- [Arquitetura e limites](docs/ARQUITETURA.md)
- [Operação, produção e backup](docs/OPERACAO.md)
- [Relatório de implementação](docs/ENTREGA-MODULO-1.md)

Integrações de identidade, white label, assinaturas e ponto dependem da análise dos projetos existentes da Invictus. Não foi criado um segundo sistema de ponto.
