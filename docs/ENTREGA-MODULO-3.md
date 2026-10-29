# Módulo 3 — Assistência Técnica

Implementado em 28/10/2026, seguindo a sequência autorizada dos módulos 1 a 12. Produtos/Estoque e PDV permanecem disponíveis. O módulo 4, CRM, aguarda autorização.

## Fluxo entregue

- Recebimento com cliente novo ou existente, aparelho, IMEI/série, defeito, estado físico, acessórios, responsável técnico e prazo.
- Diagnóstico e fotos privadas, convertidas em JPEG sem metadados. Limites: 12 fotos por ordem, entrada de 5 MB/20 MP e saída de 1600 pixels/1,5 MB.
- Orçamentos por revisão com mão de obra, peças, custos e política de garantia. A aprovação ou recusa registra responsável, canal e referência do contato; não envia mensagens.
- Consumo e devolução de peças integrados ao estoque, sem saldo negativo e limitados ao orçamento. Nova revisão exige devolver peças utilizadas e obter nova aprovação.
- Conclusão com relatório de testes, retirada identificada e comprovante não fiscal para impressão ou download. A garantia começa na entrega. Recusas e cancelamentos aguardam retirada física sem cobrar reparo.
- Histórico do aparelho, eventos da ordem, pesquisa, filtros, paginação e interface responsiva. Técnicos visualizam apenas ordens atribuídas a eles; valores de custo e margem ficam restritos à gestão.

## Integridade e limites

Operações usam transações, isolamento por empresa/filial, bloqueios, controle de versão e chaves de idempotência. Orçamentos, aprovações, fotos e eventos permanecem preservados. Movimentos de peças não podem ser estornados pelo estoque genérico. Entrega impede alterações posteriores; devolver peças de uma ordem pronta exige nova conclusão.

O total final considera mão de obra e peças líquidas utilizadas, limitado ao orçamento aprovado. O comprovante de entrega não confirma pagamento. Financeiro, emissão fiscal, envio de WhatsApp e CRM completo pertencem às integrações futuras. O cadastro mínimo de clientes será reaproveitado no módulo 4.

Fotos ficam no banco e acompanham o backup, sem links públicos. A cópia local anterior à migração está em `backups/pre-modulo3-20261028`, fora do Git.

## Validação

Validação local concluída: 41 testes de API/banco, três fluxos de navegador, compilação de produção e auditoria de dependências sem vulnerabilidades conhecidas. A suíte específica da assistência também passou novamente após a revisão da privacidade das fotos.

A regressão de API e banco cobre os três módulos, incluindo isolamento de acesso, concorrência pela última peça, idempotência, limites do orçamento, revisão/aprovação, devoluções, garantia, imutabilidade e restauração de fotos. Os testes de navegador cobrem estoque, PDV e assistência; o fluxo da assistência inclui perda de resposta após consumo, reenvio sem duplicação, reabertura após devolução, entrega e consulta em tela móvel.

PGlite atende desenvolvimento e demonstração. A conexão Prisma com PostgreSQL externo, integração com a central Invictus e recuperação na infraestrutura de produção ainda precisam de homologação. Consulte `OPERACAO.md` antes de utilizar dados reais de uma loja.
