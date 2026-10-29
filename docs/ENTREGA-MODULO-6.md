# Entrega — módulo 6: Crediário Próprio

Versão 0.6.0. Continuação autorizada após os módulos 1 a 5. O próximo módulo é **7 — Compras**, ainda não iniciado.

## Fluxo entregue

- Condições comerciais por empresa, editáveis somente pelo proprietário, com fornecedor/CNPJ, taxas, prazo, termos e referência da revisão jurídica. Crédito desabilitado até configuração e habilitação explícita.
- Perfil ligado ao CRM para pessoa física, CPF com dígitos verificadores, endereço, limite de principal e análise responsável documentada. Consulta externa e aprovação manuais, sem pontuação fictícia.
- Simulação com preço sem financiamento, entrada, principal, juros, total, CET mensal/anual e calendário. Oferta aprovada com validade, reserva concorrente de limite, cancelamento e documento para o comprador. Condições comerciais alteradas exigem nova simulação.
- PDV seleciona oferta da mesma filial, cliente e valor; registra apenas a entrada como recebimento. Contrato congela condições/dados, gera parcelas e documento com termos, calendário e aceitação manual. A venda e o estoque são transacionais.
- Recebimentos parciais/totais com antecipação, encargos de atraso, conta da filial e referência. Estorno preserva o recibo e recompõe o saldo; movimentos conciliados exigem desfazer conciliação antes.
- Renegociação somente do principal restante, sem capitalizar juros/encargos não recebidos. Plano anterior e pagamentos permanecem; novo plano exige motivo, análise e aceite.
- Cobrança interna por vencimento, faixas até 30, 31–60 e acima de 60 dias, com exportação CSV da página. Nenhuma mensagem é enviada.
- Cancelamento integral da venda financiada com restituição da entrada e de todos os recebimentos, inclusive de planos anteriores. Conciliação ativa bloqueia toda a operação e o estoque permanece intacto. Para devolução parcial, cancelar e emitir nova venda dos itens mantidos.

## Cálculos e financeiro

Principal distribuído em centavos, com residual nas primeiras parcelas. Juros simples sobre principal de cada parcela, dias corridos/base 30; vencimentos mensais mantêm âncora e ajustam meses mais curtos. Os valores das parcelas podem variar. CET anual calculado pelos fluxos nas datas previstas e mensal efetivo equivalente. Não há tarifas, seguros ou encargos ocultos cadastrados.

Antecipação reduz juros do prazo não decorrido, inclusive proporcionalmente em recebimento parcial. Multa é única sobre saldo no vencimento, limitada tecnicamente a 2%; mora simples incide sobre principal e dias em aberto considerando pagamentos realizados. Encargos vencidos são alocados primeiro; não há juros sobre juros. Tetos dos formulários são barreiras técnicas, não declaração de taxas juridicamente autorizadas para toda empresa.

Parcelas criam recebíveis patrimoniais. Principal recebido não repete a receita da mercadoria. Juros previstos são reconhecidos no vencimento; antecipação realoca juros efetivamente recebidos e compensa o abatimento, enquanto multa/mora entram quando recebidas. Baixas usam o ledger financeiro existente, com descontos e encargos discriminados. DRE gerencial possui linha própria; não realiza apuração fiscal/contábil.

## Proteções e limites

RLS por empresa e checagem de filial/perfil na API. Caixa consulta ofertas mínimas e documentos de suas próprias vendas; gestão acessa análises. CPF aparece mascarado na listagem; documentos completos têm acesso auditado. Planos, parcelas, recibos, eventos financeiros e auditoria são imutáveis para a role de runtime. Versões e idempotência protegem concorrência e reenvios após falha de rede.

Documentos podem ser impressos em fonte mínima de 12 pontos ou baixados em TXT. Aceitação, assinatura e entrega de cópia são conferidas manualmente pela loja; o ERP não fornece assinatura eletrônica, consulta a bureaus, análise automática, integração bancária ou comprovante de quitação. A modalidade atende pessoa física com CPF. A atualização exige revisão real dos termos e homologação no PostgreSQL de produção antes de uso comercial.

Referência para requisitos de informação, antecipação, multa e crédito responsável: [Código de Defesa do Consumidor, arts. 52 e 54-B a 54-D — Câmara dos Deputados](https://www2.camara.leg.br/legin/fed/lei/1990/lei-8078-11-setembro-1990-365086-normaatualizada-pl.html). A fonte orienta os requisitos; não comprova a adequação jurídica dos termos de cada loja.

## Operação e validação

Migração incremental `202610290009_store_credit`, preservando dados anteriores. Cópia offline local anterior: `backups/pre-modulo6-20261029`. Backups e documentos contêm dados pessoais e exigem acesso restrito.

Testes de API/banco verificam limites concorrentes, vínculo CRM/PDV, entrada, antecipação parcial, reenvio, pagamento concorrente, estorno, renegociação, atraso, DRE sem duplicidade, bloqueio por conciliação, restituição integral após renegociação, permissões e imutabilidade. Testes matemáticos cobrem centavos, meses curtos/ano bissexto, CET, antecipação e mora. O teste de navegador percorre configuração, análise, oferta/documento, PDV, contrato impresso, recebimento com resposta perdida, renegociação e tela móvel; a regressão inclui os cinco módulos anteriores.

Validação local concluída: 84 testes de API, banco, persistência e cálculos; seis fluxos de navegador em dois grupos para respeitar o limite de criação de empresas. Impressão e tela móvel foram inspecionadas; o teste verifica fonte de 12 pontos, documento no topo da página e ausência de rolagem horizontal da página em 390 px. Auditoria de dependências de produção sem vulnerabilidades conhecidas no momento da entrega.
