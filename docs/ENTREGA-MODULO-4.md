# Módulo 4 — CRM e Clientes

Implementado em 28/10/2026 após autorização para continuar a sequência numérica. Os módulos 1 a 3 são preservados. O módulo 5, Gestão Financeira, aguarda autorização.

## Entrega funcional

- Cadastro compartilhado com a assistência: pesquisa, dados de contato, cidade/UF, observações, edição com versão, arquivamento e reativação.
- Históricos paginados de compras, aparelhos, serviços e atividades. Compras consideram devoluções; nomes e dados originais permanecem preservados nos documentos.
- Consulta dos prazos de garantia cadastrados na venda e na entrega do reparo. Itens devolvidos e prazos ainda não iniciados são diferenciados. A aplicação não decide automaticamente a cobertura de uma solicitação.
- Seleção opcional de cliente no PDV, com busca limitada para o operador de caixa e nome no comprovante impresso/baixado. Vendas antigas anônimas não recebem vínculos presumidos.
- Funil com cinco etapas, responsável e valor previsto por filial. Encerramento e reabertura exigem motivo. Ganhar oportunidade não realiza uma venda nem movimenta financeiro.
- Atendimento manual com notas e canal, agenda com prazo em Fortaleza, atrasos, responsáveis, conclusão, cancelamento e reagendamento.
- Preferência de contato comercial com evidência e revogação. Preparação de WhatsApp por link manual, sem envio de mensagens ou integração oficial da API.

## Proteção e integridade

Proprietário e gerente administram o CRM; caixa pesquisa somente nome, identificador e final de telefone para vender. Técnicos não acessam a base do CRM. Empresa isola dados por RLS e a API filtra históricos por filial. Cadastros são compartilhados pela empresa, evitando duplicação com a assistência. Notas e evidências ficam no histórico protegido; auditoria geral não copia o conteúdo dos cadastros.

Versões, bloqueios e idempotência protegem comandos. Eventos são imutáveis para a role da aplicação. Arquivamento exige encerrar oportunidades abertas e lembretes pendentes, conserva históricos e impede novas vendas e ordens para aquele cadastro. Preferência comercial não é concedida automaticamente no cadastro; revogação bloqueia a preparação de contato e novos atendimentos comerciais nos canais externos.

A quinta migração é incremental. Backup offline local preservado em `backups/pre-modulo4-20261028`, fora do Git. Não se presume conformidade jurídica integral: a política de retenção, os procedimentos para titulares e a infraestrutura de produção precisam ser definidos/homologados pela empresa.

## Validação

Regressão local aprovada: **52 testes de API/banco e quatro fluxos de navegador**, cobrindo os módulos 1 a 4. Auditoria de dependências sem vulnerabilidades conhecidas.

Testes de integração verificam cadastro idempotente, controle de versão, escopo de empresa e filial, busca mínima do caixa, preferência/revogação, funil, lembretes atrasados, vínculos do PDV, devoluções, arquivamento, paginação e imutabilidade. O teste de navegador cobre o fluxo completo, incluindo escolha do cliente no fechamento do PDV, consulta da compra e visualização móvel.

PGlite permanece destinado a desenvolvimento e demonstração. PostgreSQL externo, identidade central, WhatsApp oficial e notificações externas ainda exigem implementação ou homologação próprias. Nenhum recebimento financeiro foi antecipado nesta etapa.
