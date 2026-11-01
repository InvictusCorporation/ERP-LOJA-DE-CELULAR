# Módulo 11 — Gestão fiscal: preparação e cofre A1

Versão 0.11.0. Esta entrega implementa a preparação fiscal prevista no escopo original. **A integração com emissor, homologação e ativação da emissão oficial permanecem pendentes. O módulo 11 não está homologado para emitir notas.** Nenhum certificado ou senha real foi solicitado no chat ou incluído no repositório.

## Disponível

- Gestão fiscal no menu, com emitente por filial: razão social, CNPJ numérico ou alfanumérico com dígitos verificadores, lista dos 26 estados e Distrito Federal, inscrições, município IBGE, endereço, CEP e emissor pretendido.
- Porte separado do regime: MEI, ME, EPP e demais portes; MEI/SIMEI, Simples Nacional, Lucro Presumido, Lucro Real, excesso de sublimite ou outro regime. Permite cadastro incompleto para preparação, sem pressupor habilitação tributária. MEI não aceita combinação explícita com outro regime/porte.
- Certificado A1 PFX/P12 até 256 KB com senha: abertura conferida pelo OpenSSL do Node, armazenamento AES-256-GCM com IV aleatório e autenticação vinculada à empresa e filial. API retorna somente nome, hash, versão, situação e horário. Não existe download do certificado ou da senha. Substituição e remoção exigem versão; remoção apaga o segredo ativo, conserva versão e auditoria, sem prometer apagar backups históricos.
- Classificação preliminar de qualquer produto existente: NCM, CEST opcional, CFOP de referência, origem, unidade, CST/CSOSN de referência e observações. São verificações de formato, não validação legal dos códigos nem cálculo de impostos. Cadastro compartilhado entre filiais, sem duplicar produtos.
- Lista paginada de vendas concluídas sem devolução/cancelamento e serviços reparados/entregues com mão de obra cobrada. Preparação de NF-e/NFC-e a partir da venda e NFS-e somente da mão de obra, sem transformar peças em serviço. Identifica a origem e preserva seus dados, preços, pagamentos, emitente e classificação vigentes no momento.
- Histórico imutável de preparações, consulta da situação atual da origem, exportação JSON de conferência e arquivamento interno com motivo. Uma preparação por origem, inclusive após arquivamento; revisão/substituição posterior ainda não implementada. Arquivar não cancela uma nota, venda ou serviço e não altera estoque/financeiro.
- Arquivo XML de apoio em UTF-8 até 64 KB por arquivo, vinculado opcionalmente à preparação da mesma filial, busca, hash SHA-256, conteúdo original e download auditado. Arquivo inerte: não é interpretado nem renderizado; DTD/entidades/nulos são recusados. **Não valida XML contra schema, assinatura, autenticidade ou autorização.** Importar XML nunca marca documento autorizado/cancelado. Download usa arquivo, não HTML/XML executável.
- RLS, referências por empresa, escopo de filial, direitos individuais, idempotência, controle de versão, auditoria e limites de upload. Dados históricos/arquivos permanecem acessíveis em filiais inativas; novas preparações, emitente e importação/substituição A1 exigem filial ativa. Remover segredo histórico permanece possível.

## Permissões

`fiscal_read`: proprietário, administrador, gerente e financeiro; pode ser concedida individualmente. Consulta documentos, emitente e metadados do certificado, classificação e arquivos autorizados.

`fiscal_manage`: preparação, arquivamento, classificação e arquivo XML; depende da leitura. Mesmos perfis padrão. Não permite acessar segredos.

`fiscal_settings`: emitente e certificado, reservada ao proprietário e dependente de leitura. Não pode ser concedida como exceção individual. Outros perfis mantêm seus direitos anteriores.

## Limites para emissão oficial

As rotas de emitir, consultar autorização e cancelar retornam indisponibilidade explícita. Não existem chave de acesso, protocolo, DANFE ou retorno SEFAZ fictícios. Nenhum serviço externo foi contratado ou acionado.

Antes de integrar: escolher provedor/serviço e validar UF, município, credenciamento, regimes, destinatário/endereço, natureza da operação, numeração/série, CSC quando exigido, regras de ICMS/PIS/COFINS/ISS e IBS/CBS vigentes, retorno/contingência, cancelamento/devolução e XML assinado. O cadastro preliminar não cobre todos esses campos. Validar certificado (titular/CNPJ, cadeia, validade e habilitação) além da conferência de abertura com senha. Certificado A3 exige solução própria. Segregar homologação e produção, implementar consulta/reconciliação para respostas perdidas e testar em homologação antes de liberar a produção. Nunca transmitir automaticamente os snapshots atuais: precisam de revisão e complementação.

## Operação e recuperação

Migração `202611010014_fiscal_preparation`, sem modificar migrações anteriores nem dados comerciais. Cópia offline anterior: `backups/pre-modulo11-20261101/invictus`, fora do Git. Nenhuma alteração no VPS ou em outros projetos.

Localmente a chave aleatória fica em `<DATA_DIR>.fiscal-key`, fora do banco e do Git. O backup local gera um arquivo companheiro `<backup.tar.gz>.fiscal-key` quando usa essa chave. A restauração em diretório novo recupera também o companheiro; certificados ativos sem chave interrompem a verificação de recuperação. Ao copiar o diretório do banco manualmente, copiar também a chave separadamente, com acesso restrito. Importação recusa gerar nova chave quando há certificados locais ativos cuja chave desapareceu.

Produção exige `FISCAL_ENCRYPTION_KEY` com 32 bytes aleatórios em hexadecimal (64 caracteres), injetada pelo gerenciador de segredos, e PostgreSQL externo. Não há chave padrão ou geração automática em produção. Não trocar essa chave sem migração planejada/recriptografia: a perda torna os certificados irrecuperáveis. Backup do banco contém segredos cifrados; backup da chave deve ser protegido separadamente. Windows: configurar ACLs da pasta/chave para a conta do serviço (o modo POSIX 0600 não substitui ACL). HTTPS obrigatório na implantação. A homologação do ambiente externo continua pendente.

## Aprendizados e correções

- Porte ME/EPP e regime tributário são informações diferentes. Guardá-los separadamente evita confundir uma microempresa com uma opção de apuração.
- Remover caracteres não numéricos do CNPJ apaga letras de inscrições alfanuméricas. Normalizar apenas pontuação e verificar os dois dígitos pelo algoritmo publicado pela Receita Federal.
- Um certificado que abre com a senha ainda não comprova habilitação fiscal, titular correto, cadeia ou validade. A interface e a entrega devem mostrar a diferença.
- Guardar a senha cifrada junto ao PFX permite o uso futuro pelo adaptador no servidor; retornar o segredo ao navegador não é necessário. AES-GCM vinculado ao tenant/filial impede mover pacotes entre estabelecimentos.
- A chave do cofre precisa de estratégia de recuperação. Backup exclusivo do banco não basta. Remover certificado não revoga cópias já existentes em backups.
- Preparação, XML importado e autorização fiscal são estados diferentes. Arquivar preparação também não é cancelar nota.
- Dados históricos devem permanecer imutáveis; consulta mostra a situação atual da origem separadamente. Snapshots antigos não podem ser transmitidos sem revalidação.
- Decodificação genérica de arquivo pode remover BOM ou trocar caracteres inválidos. XML de apoio exige UTF-8 estrito, preserva BOM em base64 no transporte pelo banco e confere tamanho/hash no download, incluindo acentos.
- No teste de navegador, células com texto auxiliar devem ser localizadas pelo papel e conteúdo acessível. O texto inteiro da célula inclui o auxiliar, mesmo quando o número aparece separado visualmente.

## Referências oficiais consultadas

- [Portal NF-e — perguntas frequentes](https://www.nfe.fazenda.gov.br/pOrtal/perguntasFrequentes.aspx?AspxAutoDetectCookieSupport=1&tipoConteudo=4figqHYhYho%3D): homologação, produção e requisitos.
- [Portal NFS-e — APIs](https://www.gov.br/nfse/pt-br/biblioteca/documentacao-tecnica/apis-prod-restrita-e-producao) e [documentação atual](https://www.gov.br/nfse/pt-br/biblioteca/documentacao-tecnica/documentacao-atual).
- [Receita Federal — cálculo do DV CNPJ alfanumérico](https://www.gov.br/receitafederal/pt-br/centrais-de-conteudo/publicacoes/documentos-tecnicos/cnpj/manual-dv-cnpj.pdf).
- [DREI — tipos de pessoas jurídicas](https://www.gov.br/empresas-e-negocios/pt-br/drei/orientacoes-de-abertura/tipos-de-pessoas-juridicas): porte e regime.
- [Node — contexto TLS e PFX](https://github.com/nodejs/node/blob/main/doc/api/tls.md). `node-forge` é dependência apenas de desenvolvimento, usada para gerar certificados fictícios durante os testes; nenhum PFX/chave privada é versionado.

## Validação

Validação local: 153 verificações de API/banco/cálculos/recuperação (139 anteriores, 13 fiscais e 1 de backup A1), todas aprovadas nas suítes executadas. Os 12 fluxos de navegador passaram, incluindo regressão dos módulos 1–10 e repetição fiscal com UTF-8/BOM e codificação inválida. Verificação de tipos e compilação de produção aprovadas; capturas de computador e celular de 390 px inspecionadas. Auditoria de dependências de produção sem vulnerabilidades conhecidas. Testes fiscais cobrem CNPJ, cifragem/autenticação, senha inválida, vínculo criptográfico, isolamento, versões, idempotência, origem comercial, snapshots, indisponibilidade oficial, arquivamento, download, XML hostil e privilégios. Navegador cobre cadastro, estados/porte/regimes, A1, classificação, preparação a partir do PDV, JSON, XML, remoção de certificado, acesso e tela de 390 px.
