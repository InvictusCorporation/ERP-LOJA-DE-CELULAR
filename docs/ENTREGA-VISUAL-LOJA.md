# Atualização das três telas da loja — 26/11/2026

## Objetivo

Aplicar as três referências fornecidas pelo usuário ao ERP existente, preservando os módulos e seus controles: menu escuro, superfície clara, amarelo-ouro nas ações principais, catálogo com imagens e ficha individual do aparelho.

## Comportamento entregue

- **Visão geral:** vendas líquidas de hoje, quantidade de vendas com saldo não devolvido, unidades disponíveis sem reserva e serviços abertos. Evolução de 7 ou 30 dias, tabela acessível dos valores, produtos com maior saldo, últimas cinco vendas e alertas de mínimo, reserva e retirada. Filial selecionada e fuso `America/Fortaleza`. Valores de vendas e assistência são omitidos para perfis sem gestão do respectivo módulo.
- **Frente de caixa:** cartões com foto, preço e disponibilidade; categorias livres vindas do cadastro, filtradas no servidor; leitor por teclado, busca por nome/SKU/código/IMEI/série; seleção da unidade rastreável; carrinho com foto, identificação, quantidades, cliente, desconto e total; atalhos que abrem o fechamento com Pix, crédito ou dinheiro. A conferência externa dos pagamentos e o fechamento transacional existentes continuam obrigatórios.
- **Orçamento:** o botão salva um arquivo TXT local com o conteúdo do carrinho. Não é uma venda, não reserva estoque, não cobra e não cria um histórico de propostas no servidor. Preço e disponibilidade precisam ser confirmados ao vender.
- **Produtos e estoque:** abas para catálogo, unidades e movimentações; filtros de marca, condição, status e modelo/IMEI/série; seleção de unidade com ficha lateral. Bateria opcional de 0 a 100, estado de conservação, localização e reserva são editáveis por quem já possui direito de estoque. A ficha tem versão, idempotência e auditoria. Histórico mostra até 100 movimentos de filiais autorizadas; a lista de unidades mantém o limite explícito de 500, e seus indicadores descrevem somente essa lista.
- **Fotos:** cadastro aceita PNG/JPEG/WebP, reduzido no navegador e validado/reprocessado no servidor com Sharp. Sem SVG enviado pelo usuário, URLs remotas ou execução de conteúdo ativo. Armazenamento no banco do tenant, acompanhado no backup. Produtos sem imagem exibem um estado explícito “Sem foto”. As imagens em `public/catalog` são ilustrações SVG autorais de demonstração; não afirmam reproduzir um modelo comercial específico. Podem ser substituídas por fotos reais da loja no cadastro.

## Estoque e reservas

A migração incremental `202611260016_visual_store` acrescenta a imagem do produto e metadados da unidade. Não altera migrações anteriores nem cadastra exemplos no banco real.

A reserva manual aplica-se somente à unidade em estoque. Saldo físico permanece igual, mas disponibilidade no PDV desconta as reservas. A venda rejeita uma unidade reservada, inclusive por uma tela antiga. Um trigger protege também saídas e transferências de filiais, que precisam liberar a reserva explicitamente antes de mover. A reserva não tem prazo automático, cliente associado, sinal ou cobrança. Esses fluxos não foram presumidos pelas imagens.

## Demonstração isolada

Com a porta 4000 livre, execute `pnpm demo:api`; em outro terminal, `pnpm demo:web`. Acesse `http://localhost:3020`. A API utiliza **somente banco em memória**, recusa ambiente de produção/PostgreSQL e cadastra exemplos identificados como demonstração. A chave do cofre fiscal da demonstração também é temporária e independente. Ao parar o processo, seus dados desaparecem. Não abre `.data/invictus`.

A conta fictícia está definida exclusivamente em `scripts/demo.ts`. O login normal é utilizado também na demonstração; não existe rota para desativar autenticação. Os produtos, caixa e três vendas iniciais são criados pelas mesmas APIs transacionais. Nenhum pagamento externo é executado.

Os demais projetos locais podem continuar usando outras portas. Não parar processos por nome genérico nem substituir a aplicação que estiver na porta 3000. A execução desta entrega não envolve VPS, DNS nem publicação em produção.

## Aprendizados e correções

1. Regras globais de `nav` atingiam também as novas abas de estoque. Foram limitadas a `.sidebar nav`, mantendo as abas horizontais e o menu lateral independente.
2. Datas UTC viravam o dia antes da operação em Fortaleza. O teste de filial inativa passou a informar a mesma data local usada pelo domínio financeiro; a validação da aplicação não foi relaxada.
3. A seleção de categoria deve acontecer no servidor, antes da paginação, para não ocultar produtos que ficaram fora dos primeiros 30 resultados de outra categoria.
4. “Reservado” precisa bloquear operações no banco e no fechamento, além do botão do navegador. Filtragem visual isolada não protege uma tela desatualizada.
5. Exemplos e imagens não devem virar mercadorias ou faturamento reais. A demonstração temporária separa esse conteúdo do banco persistente da loja.
6. Para validar a interface sem interferir na clínica em `localhost:3000`, o Playwright aceita `E2E_BASE_URL` e, opcionalmente, `E2E_CHANNEL`. Os testes usam a origem do endereço efetivo. O padrão do CI continua sendo localhost:3000/Chromium.

## Verificação

Testes de API cobrem imagem válida/inválida, categoria, série, versões da ficha, idempotência, bateria, reserva, venda e saída bloqueadas, liberação, indicadores e isolamento entre empresas/filiais/perfis. O fluxo de navegador cobre as três telas, upload de foto, edição/reserva/histórico, busca por IMEI, arquivo de orçamento, atalho Pix e responsividade em 390 px. Os testes existentes de caixa, estoque, assistência, finanças e demais módulos são reutilizados para regressão.

Resultado local: **173 verificações de API/banco**, com repetição bem-sucedida do grupo de filiais após a correção da data do teste; **14 fluxos distintos de navegador aprovados**, incluindo repetição final do fiscal, PDV e das três telas. TypeScript e compilação de produção do Next.js concluídos. A execução local usou Chrome instalado; o padrão Chromium do CI foi preservado. Evidências visuais ficam em `.data/qa-visual-20261126` (ignoradas pelo Git); as ilustrações reutilizáveis são versionadas em `public/catalog`.
