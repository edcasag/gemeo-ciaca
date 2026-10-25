# Gêmeo digital na formação de chapas cimentícias: simulador

Simulador virtual que acompanha um artigo sobre a modelagem de um gêmeo digital para uma máquina de formação de chapas cimentícias por acúmulo de lâminas em um cilindro formador. A máquina, o corte mecânico, o corte automático do controlador e o gêmeo digital são simulados, sem conexão com equipamento real. Os dados são sintéticos e os parâmetros, ilustrativos.

## Como usar

Abra `index.html` no navegador, localmente ou pelo GitHub Pages do repositório. Não há nada a instalar.

1. **PCP**: edite os lotes do plano de produção (espessura nominal, chapas, lâmina média, tempo por volta, tolerância, diâmetro da prensa), os cenários de falha e os parâmetros. Clique em **Simular**.
2. **Resultados**: comparação por lote entre o corte mecanizado e o corte automático com gêmeo, figuras exportáveis em PNG (escala de cinza), falhas detectadas, relatório completo da simulação (HTML para imprimir ou salvar em PDF) e CSV das chapas simuladas.
3. **Painel do gêmeo**: proposta de painel para o gêmeo conectado à máquina, com reprodução acelerada, indicadores de negócio, *setpoint* enviado e alarmes para o operador.

`testes.html` executa a verificação funcional do motor e mostra um resumo dos resultados.

## Modelo

- **Lâmina**: em cada volta do cilindro, a chapa recebe uma lâmina e(t) = μ + Σ Aᵢ sen(2πt/Pᵢ + φᵢ), com variação lenta e contínua entre chapas. O regime μ é definido por lote.
- **Corte mecânico**: comandado quando a chapa atinge o rolo auxiliar, regulado na espessura nominal. Nunca antecipa. Como não é sincronizado com o cilindro, por batimento 1 em cada 20 chapas sai com 1 ou 2 lâminas a mais.
- **Corte automático**: o controlador é sincronizado com o cilindro. A cada volta, compara a espessura medida agora com a esperada após mais uma volta e corta quando a atual está mais perto do *setpoint*, podendo antecipar o corte. Sem gêmeo, o *setpoint* é a espessura nominal.
- **Por que o gêmeo**: um corte automático bem ajustado não tem como ser superado; a dificuldade é manter o ajuste à mão a cada troca de lote, mudança de regime da massa ou falha. O gêmeo faz esse ajuste de forma contínua, e a economia apresentada é a do automático com gêmeo frente ao corte mecanizado.
- **Gêmeo digital**: na troca de lote, programa o *setpoint*, o diâmetro da prensa e as camadas esperadas a partir do PCP. Para escolher o *setpoint*, simula milhares de chapas no regime estimado da lâmina e envia o menor *setpoint* que mantém a meta de conformidade, aproveitando a tolerância até o limite inferior (com margem de segurança configurável, padrão 0%). Chapas fora da tolerância são recicladas pelo controle de qualidade, com custo e perda de eficiência; por isso a meta padrão é 100% de conformidade. Reestima o regime ao longo do lote e após alarmes de processo.
- **Falhas**: falta de massa, irregularidade da massa, densidade inadequada (massa não adere), trancos na espessura, falha do medidor, quebra da rede entre controladores, falha de energia, falha de comunicação com a nuvem e diâmetro da prensa configurado errado. O gêmeo detecta cada uma a partir dos dados recebidos e emite um alarme por episódio.

## Indicadores

Conformidade (tolerância do lote, 10% e 5%), espessura média e desvio-padrão, voltas por chapa, chapas por hora, economia de material frente ao corte mecânico (em % e em chapas economizadas), tempo até a detecção de cada falha e completude da trilha de eventos.

## Reprodutibilidade

A simulação é determinística: a mesma semente e o mesmo PCP produzem a mesma saída. O PCP padrão está em `pcp_padrao.json` e pode ser exportado e importado pela página.

## Arquivos

| Arquivo | Conteúdo |
|---|---|
| `index.html` | Página do simulador (PCP, resultados e painel) |
| `motor.js` | Motor de simulação, sem dependências |
| `pcp_padrao.json` | Plano de produção e cenários padrão |
| `testes.html` | Verificação funcional do motor |
