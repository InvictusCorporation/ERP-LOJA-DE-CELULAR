# Entrega — Módulo 2: Frente de Caixa (PDV)

Data: 28/10/2026. Versão local: 0.2.0. Escopo: PDV integrado ao Módulo 1, seguindo a sequência numérica de desenvolvimento definida pelo usuário.

## Funcionalidades implementadas

- Cadastro de caixas por filial e caixa principal criado automaticamente para cada filial.
- Abertura com saldo inicial e uma sessão por caixa; o operador só pode manter uma sessão aberta por filial.
- Carrinho com busca por nome/SKU, leitura de código de barras com Enter, quantidade e seleção de aparelho por IMEI/série.
- Preços conferidos pelo servidor e desconto restrito a proprietário/gerente.
- Registro de dinheiro, Pix, débito e crédito, incluindo pagamentos mistos e referência externa para pagamentos não monetários.
- Troco automático em dinheiro, com separação entre valor entregue pelo cliente e recebimento líquido.
- Sangria e suprimento com motivo, validação do saldo e auditoria.
- Fechamento com dinheiro contado, saldo esperado, diferença e justificativa obrigatória quando houver divergência.
- Histórico paginado de vendas, consulta de comprovantes e relatórios básicos por operador/sessão.
- Comprovante não fiscal com itens, SKU, IMEIs/série, desconto, pagamentos, troco, garantia e histórico de devoluções; impressão e download em texto.
- Cancelamento integral antes de devoluções e devoluções parciais ou totais, preservando os registros originais.
- Perfil mínimo de operador de caixa, sem acesso a custos, descontos ou autorização de devoluções.

## Regras e integração com o estoque

Venda, itens, pagamentos, baixa de estoque, identificação dos aparelhos, dinheiro físico e auditoria são gravados na mesma transação. Preço e estoque enviados pelo navegador não são considerados fonte de verdade. Alteração de preço após montar o carrinho exige nova conferência do total.

Todas as operações de escrita do PDV usam chave de idempotência. Se a resposta falhar depois da gravação, reenviar o mesmo comando na interface reutiliza a chave e recupera o resultado sem duplicar o movimento.

Dinheiro físico fica em `cash_entries`; Pix/cartões ficam nos registros de pagamentos e não aumentam o dinheiro esperado no caixa. A conferência do fechamento considera apenas o dinheiro físico. A diferença apurada é preservada, sem alterar retroativamente os lançamentos.

Devoluções usam o preço líquido original, com o desconto distribuído proporcionalmente. O arredondamento é acumulado por item, garantindo que a última unidade devolvida complete os centavos restantes. Não é permitido devolver mais unidades ou ressarcir mais do que a venda original, nem usar uma forma de pagamento acima do saldo original daquela forma.

A devolução exige uma sessão própria aberta na mesma filial, podendo ocorrer após fechar a sessão original. Aparelhos retornam à sua identidade original. Movimentos de venda/devolução não podem ser estornados pelo fluxo genérico de estoque.

## Atualização de banco e preservação dos dados

O banco local passa a aplicar migrações incrementais com registro e verificação de checksum, normalizado para diferenças de quebra de linha entre Windows e Linux. Bancos da versão anterior são adotados sem recriar as tabelas. Migrações já aplicadas não devem ser editadas.

Foram adicionadas as migrações `202610280002_point_of_sale` e `202610280003_pos_indexes`. As novas tabelas possuem RLS e referências por empresa; índices apoiam relatórios por sessão e reconciliação de devoluções.

Antes da atualização local, foi preservada uma cópia do diretório do banco em `backups/pre-modulo2-20261028`, com a aplicação parada. Esse backup e os bancos locais estão fora do Git.

## Validações executadas

| Verificação                            | Resultado local                                                |
| -------------------------------------- | -------------------------------------------------------------- |
| TypeScript da interface e servidor     | Aprovado                                                       |
| Testes automatizados dos módulos 1 e 2 | 28 testes reportados, todos aprovados                          |
| Fluxos completos no Chromium           | 2 testes aprovados: estoque e PDV                              |
| Compilação (`pnpm build`)              | Aprovada                                                       |
| Auditoria das dependências de produção | Nenhuma vulnerabilidade conhecida encontrada na consulta final |
| Desktop e celular                      | Capturas inspecionadas; sem overflow horizontal da página      |

As verificações do PDV abrangem:

- Atualização de um banco legado sem perda e sem reaplicar migrações.
- Dinheiro, Pix, débito, crédito, pagamentos mistos e troco.
- Desconto autorizado, total desatualizado e pagamentos insuficientes.
- Duas vendas concorrentes disputando a última unidade.
- Duas requisições da mesma venda com a mesma chave.
- Falha de resposta após gravar a venda e reenvio no navegador sem duplicação.
- Devolução parcial, integral, excesso de quantidade, cancelamento e ressarcimento por forma original.
- Devoluções de centavos com arredondamento e devolução em sessão posterior.
- Rastreabilidade de aparelho e bloqueio de correções fora do PDV.
- Sangria acima do saldo, suprimento e fechamento com diferença.
- Isolamento por empresa/filial, restrições de operador, ocultação de custos e imutabilidade dos registros.
- Regressão de persistência, restauração de backup e recuperação após interrupção forçada do banco local.

Capturas e comprovante do teste ficam em `test-results/`: `pdv-carrinho-desktop.png`, `pdv-carrinho-mobile.png`, `pdv-comprovante-desktop.png`, `pdv-conferencia-desktop.png`, `pdv-mobile.png` e `comprovante-pdv.txt`. Os registros de teste estão em empresas explicitamente chamadas de demonstração.

## Limites da entrega

1. Pix e cartões são registros manuais após conferência externa. Não há integração bancária, cobrança automática, TEF, captura ou estorno automático em adquirentes.
2. O comprovante é não fiscal. Emissão fiscal pertence ao Módulo 11.
3. Cadastro de clientes, crediário e financeiro avançado serão conectados nos módulos 4, 6 e 5, respectivamente; não foram antecipados nem simulados como concluídos.
4. Não há operação offline de vendas. A finalização exige conexão com a API.
5. O PDV limita os valores de cada operação a R$ 10 milhões; a interface exibe o limite quando um preço não é compatível.
6. A conexão de produção com PostgreSQL hospedado, o provisionamento pela central, HTTPS e a recuperação da infraestrutura comercial continuam exigindo homologação no ambiente escolhido. A validação executada aqui usa PostgreSQL embarcado real e a role de aplicação com RLS.
7. A gestão completa de funcionários e permissões personalizadas permanece no Módulo 9; o cadastro básico de operador atende somente às necessidades atuais.

O próximo módulo na sequência é **3 — Assistência Técnica**. Ele não foi iniciado e depende de autorização para a nova etapa.
