# Entrega — módulo 7: Compras e Fornecedores

Versão 0.7.0. Continuação autorizada após os módulos 1 a 6. O próximo módulo é **8 — Relatórios Gerenciais**, ainda não iniciado.

## Entregue

- Fornecedores compartilhados com o catálogo existente, perfil complementar, contato, documento opcional, versão, ativação/inativação e histórico nas filiais autorizadas.
- Pedidos por filial com rascunho revisável, produtos livres, quantidades, custos positivos, previsão e observação. Confirmação preserva linhas/snapshot sem realizar entrega, pagamento ou envio ao fornecedor.
- Recebimentos parciais ou integrais, conferência de quantidades e saldo pendente, documento/entrega com referência única por fornecedor, vencimento e controle individual por série/IMEI e procedência. Limite de 200 unidades identificadas por operação.
- Estoque e conta a pagar gerados atomicamente pelo valor recebido. Reenvio após resposta perdida não duplica estoque, dívida ou evento. Custo do cadastro pode ser atualizado explicitamente pelo último custo de compra; sem média ponderada ou alteração de custos históricos das vendas.
- Pagamentos parciais/totais, conciliação e estornos pelo financeiro existente. Títulos patrimoniais não duplicam despesa/CMV na DRE. Origem e valor são preservados.
- Cancelamento somente do saldo pendente; correção integral de recebimento com compensação de estoque e cancelamento do título. Baixas ativas, falta de saldo ou unidades com movimento posterior impedem a correção inteira. Custos de catálogo não são restaurados automaticamente.
- Histórico por pedido/fornecedor, detalhes de cada entrega e unidades, trilha auditada, documentos internos imprimíveis e CSV da página atual. Interface responsiva e seleção de filiais autorizadas.

## Segurança e integridade

Gestão restrita a proprietário/gerente. RLS por empresa, FKs compostas, validação de filial/produto/fornecedor, versões e idempotência. Linhas confirmadas, recebimentos, unidades vinculadas, correções e eventos não admitem UPDATE/DELETE pela role da aplicação. Correções não apagam o histórico. O estoque genérico não pode estornar movimentos de compra; títulos de origem não permitem edição/cancelamento manual.

## Cadastro livre e escaneamento preservados

O cadastro aceita qualquer nome de produto e categorias criadas pela loja; quantidade ou controle individual são opções de estoque, sem lista fechada de mercadorias. Leitor USB/Bluetooth que funciona como teclado e câmera preenchem o código de barras antes da conferência e salvamento. Leitura por câmera ocorre no navegador, sem upload das imagens; permissão negada mantém a digitação. A câmera é liberada ao capturar ou fechar. Teste usa vídeo simulado com EAN-13 real gerado, sem ativar câmera física do usuário.

## Limites

Recebimentos são registrados na data atual e usam os custos confirmados no pedido. Correção da entrega é integral; devolução comercial parcial ao fornecedor não foi implementada. Unidades individuais novas precisam de identificações ainda não cadastradas; não há nova compra automática de uma unidade já conhecida. Não há importação/validação de NF-e/XML, emissão fiscal, envio automático, consulta cadastral externa ou pagamento bancário automático. Documentos internos não comprovam pagamento nem substituem documento fiscal.

## Operação e validação

Migração incremental `202611010010_purchases`, preservando registros anteriores. Backup offline anterior: `backups/pre-modulo7-20261101/invictus`.

A regressão de API, banco, persistência e cálculos passou com **100 testes**. Cobre fornecedor reaproveitado, permissões, empresa/filial, rascunho e seu cancelamento com histórico preservado, confirmação, entregas parciais/integral, referências duplicadas, reenvio, recebimentos concorrentes, IMEIs/séries, rollback, custo, dívida patrimonial, pagamentos, cancelamento de saldo, correção e imutabilidade.

Os **oito fluxos de navegador** passaram em dois grupos, respeitando o limite de provisionamentos locais. Compras percorre fornecedor, revisão/confirmação do pedido, impressão, perda de resposta no recebimento, entrega individual, financeiro, estorno e cancelamento de saldo. A regressão inclui cadastro com câmera/leitor e os módulos anteriores. Impressão e telas de computador/celular foram inspecionadas, com fonte de impressão de 12 pontos e página sem rolagem horizontal em 390 px. Compilação e verificação de tipos aprovadas; auditoria de dependências de produção sem vulnerabilidades conhecidas no momento da entrega.
