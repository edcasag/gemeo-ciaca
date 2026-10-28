# Gêmeo digital na formação de chapas cimentícias: simulador

Simulador virtual que acompanha um artigo sobre a modelagem de um gêmeo digital para uma máquina de formação de chapas cimentícias por acúmulo de lâminas em um cilindro formador. A máquina, o corte mecânico, o corte automático do controlador e o gêmeo digital são simulados, sem conexão com equipamento real. Os dados são sintéticos e os parâmetros, ilustrativos.

## Como usar

Abra `index.html` no navegador, localmente ou pelo GitHub Pages do repositório. Não há nada a instalar.

1. **PCP**: edite os lotes do plano de produção (espessura nominal, chapas, lâmina média, tempo por volta, tolerância, diâmetro da prensa), os cenários de falha e os parâmetros. Clique em **Simular**.
2. **Resultados**: quadro de entrega dos objetivos da visão de Negócio (faixa do negócio, norma, alinhamento, camadas, material, tempo de execução, produtividade e falhas), em operação normal e com as falhas do PCP, com destaque para as chapas do PCP, a economia de material e as chapas economizadas; economia de material e de tempo de produção por lote, comparação por lote entre o corte mecanizado e o corte automático com gêmeo, operação normal (o mesmo PCP simulado sem falhas, com as chapas na faixa do negócio, só na norma e fora da norma), figuras exportáveis em PNG (escala de cinza), falhas detectadas, relatório completo da simulação (HTML para imprimir ou salvar em PDF) e CSV das chapas simuladas.
3. **Painel do gêmeo**: proposta de painel para o gêmeo conectado à máquina, com reprodução acelerada, indicadores de negócio, *setpoint* enviado e alarmes para o operador.

`testes.html` executa a verificação funcional do motor e mostra um resumo dos resultados.

## Modelo

- **Lâmina**: em cada volta do cilindro, a chapa recebe uma lâmina e(t) = μ + Σ Aᵢ sen(2πt/Pᵢ + φᵢ), com variação lenta e contínua entre chapas. O regime μ é definido por lote.
- **Corte mecânico**: comandado quando a chapa atinge o rolo auxiliar, regulado na espessura nominal. Nunca antecipa. Como não é sincronizado com o cilindro, por batimento 1 em cada 20 chapas sai com 1 ou 2 lâminas a mais.
- **Corte automático**: o controlador é sincronizado com o cilindro. A cada volta, compara a espessura medida agora com a esperada após mais uma volta e corta quando a atual está mais perto do *setpoint*, podendo antecipar o corte. Sem gêmeo, o *setpoint* é a espessura nominal.
- **Por que o gêmeo**: um corte automático bem ajustado não tem como ser superado; a dificuldade é manter o ajuste à mão a cada troca de lote, mudança de regime da massa ou falha. O gêmeo faz esse ajuste de forma contínua, e a economia apresentada é a do automático com gêmeo frente ao corte mecanizado.
- **Gêmeo digital**: na troca de lote, programa o *setpoint*, o diâmetro da prensa e as camadas esperadas a partir do PCP. Para escolher o *setpoint*, simula milhares de chapas no regime estimado da lâmina e envia o menor *setpoint* que mantém a meta de conformidade, aproveitando a tolerância até o limite inferior (com margem de segurança configurável, padrão 0%). Chapas fora da tolerância são recicladas pelo controle de qualidade, com custo e perda de eficiência; por isso a meta padrão é 100% de conformidade. Reestima o regime ao longo do lote e após alarmes de processo.
- **Falhas**: falta de massa, irregularidade da massa, densidade inadequada (massa não adere), trancos na espessura, falha do medidor, quebra da rede entre controladores, falha de energia, falha de comunicação com a nuvem e diâmetro da prensa configurado errado. O gêmeo detecta cada uma a partir dos dados recebidos e emite um alarme por episódio.
- **Operação normal**: o PCP é simulado também sem falhas, como cenário de referência. Mesmo sem falhas, o corte mecanizado deixa chapas acima da faixa do negócio, pela variação da lâmina e pelo batimento.

## Plano de produção (PCP)

O PCP é um JSON (`pcp_padrao.json`) editável na aba PCP. Espessuras em mm, tempos em s, tolerâncias em % da nominal.

| Campo | Significado |
|---|---|
| `semente` | Semente do ruído determinístico das falhas |
| `lotes[].espessura_mm`, `chapas` | Espessura nominal e quantidade de chapas do lote |
| `lotes[].lamina_mm`, `tempo_volta_s` | Lâmina média (μ) e tempo por volta do cilindro |
| `lotes[].tolerancia_pct` | Tolerância da norma (limite absoluto) |
| `lotes[].faixa_negocio_pct` | Faixa em que a fábrica quer operar; o gêmeo posiciona o *setpoint* nela |
| `lotes[].diametro_mm` | Diâmetro da prensa (1.660, 1.890 ou 2.050 mm) |
| `lamina.amplitudes_mm`, `periodos_s`, `fases_graus` | Aᵢ, Pᵢ e φᵢ da variação lenta e(t) |
| `mecanico.batimento_cada`, `laminas_extra` | Período do batimento do corte mecânico e lâminas extras, alternadas |
| `gemeo.meta_conformidade_pct` | Conformidade mínima na faixa do negócio exigida do *setpoint* |
| `gemeo.margem_limite_inferior_pct` | Margem do *setpoint* acima do limite inferior da faixa |
| `gemeo.passo_setpoint_mm`, `chapas_por_teste` | Grade da busca do *setpoint* e chapas simuladas por teste |
| `gemeo.janela_chapas` | Período de reestimativa do regime da lâmina |
| `falhas[]` | `tipo`, `lote` (base 1), `chapa` (base 0), `duracao` (voltas, chapas ou s, conforme o tipo) e `ativa` |

## Indicadores

Calculados por lote e no total, para cada forma de corte. e: espessura final; T: nominal.

| Indicador | Definição |
|---|---|
| Dentro da norma | Chapas com \|e − T\| ≤ tolerância · T, sobre as chapas do lote; chapas perdidas contam como fora |
| Na faixa do negócio | Idem, com a faixa do negócio |
| Média e desvio-padrão | De e, nas chapas não perdidas (desvio amostral) |
| Voltas por chapa | Média das voltas até o corte |
| Horas de produção, chapas por hora | Tempo entre o fim do lote anterior e o corte da última chapa do lote |
| Economia de material | 1 − Σe / Σe do corte mecanizado (mesma área de chapa no lote) |
| Chapas economizadas | (Σe mecanizado − Σe) / (Σe / chapas), por lote; o total é a soma dos lotes |
| Tempo até a detecção | Do início da falha ao primeiro alarme do gêmeo |

## Uso do motor

`motor.js` não tem dependências e funciona no navegador (`window.Motor`) ou em Node.js (`require('./motor.js')`).

```js
const r = Motor.simular(Motor.PCP_PADRAO);
r.ind.lotes[0].pol.gemeo.economia_pct;   // economia do lote 1
r.ind.total.pol.mec.horas;               // horas de produção do PCP, corte mecanizado
r.res.gemeo.alarmes;                     // alarmes emitidos pelo gêmeo
```

## Resultados do artigo

A simulação do PCP padrão (`pcp_padrao.json`, semente 1), com 26.000 chapas em cinco lotes, compara o corte mecanizado e o corte automático com gêmeo.

### Entrega dos objetivos da visão de Negócio

| Objetivo | Indicador | Mecanizado | Com gêmeo | Variação |
|---|---|---:|---:|---:|
| Atender a especificação mais estreita do negócio | Chapas na faixa do negócio | 91,10% | 99,99% | **+8,89 p.p.** |
| Respeitar a norma | Chapas dentro da tolerância da norma | 98,36% | 100,00% | **+1,63 p.p.** |
| Melhorar o alinhamento entre chapas | Desvio-padrão da espessura final por lote | 0,26 a 0,28 mm | 0,17 a 0,19 mm | **−31,8%** (média) |
| Reduzir camadas por chapa | Voltas por chapa | 28,2 | 26,9 | **−4,8%** |
| Reduzir o consumo de material | Material frente ao corte mecanizado | referência | 1.258 chapas economizadas | **−4,8%** |
| Reduzir o tempo de execução | Tempo médio de formação por chapa | 42,3 s | 40,3 s | **−4,8%** |
| Aumentar a produtividade e o lucro | Chapas por hora | 85,0 | 89,3 | **+5,0%** |
| Monitorar e detectar falhas | Falhas detectadas e tempo até a detecção | - | 9 de 9, de 0,5 s a 60 s | - |

### Economia por lote

Material e tempo de produção de cada lote, do corte mecanizado para o corte automático com gêmeo. Chapas economizadas: material economizado expresso em chapas da espessura do lote; o total é a soma dos lotes.

| Lote | Chapas | Economia de material | Chapas economizadas | Tempo mecanizado | Tempo com gêmeo | Tempo economizado |
|---|---:|---:|---:|---:|---:|---:|
| 8 mm | 5.000 | 3,74% | 194 | 28,9 h | 27,8 h | **1,1 h** |
| 12 mm | 8.000 | 4,74% | 398 | 68,7 h | 65,4 h | **3,3 h** |
| 20 mm | 8.000 | 4,76% | 400 | 113,1 h | 107,7 h | **5,4 h** |
| 25 mm | 3.000 | 5,03% | 159 | 52,9 h | 50,3 h | **2,6 h** |
| 30 mm | 2.000 | 5,10% | 107 | 42,2 h | 40,0 h | **2,1 h** |
| Total | 26.000 | 4,75% | 1.258 | 305,8 h | 291,2 h | **14,5 h** |

Relatório completo, para abrir no navegador: <https://edcasag.github.io/gemeo-ciaca/resultados/relatorio_simulacao_padrao.html>

### Arquivos de resultados

| Arquivo | Conteúdo |
|---|---|
| `resultados/relatorio_simulacao_padrao.html` | Relatório completo: PCP, parâmetros, entrega dos objetivos da visão de Negócio, economia por lote, indicadores, tabelas por lote, figuras, falhas, alarmes e *setpoints* enviados |
| `resultados/resumo_por_lote.csv` | Indicadores por lote e forma de corte, com horas de produção e o total |
| `resultados/chapas_simuladas.zip` | CSV com uma linha por chapa simulada (52.000 linhas) |

Os mesmos arquivos são gerados pela página (aba Resultados: "Baixar relatório da simulação" e "Baixar CSV das chapas simuladas").

## Reprodutibilidade

A simulação é determinística: a mesma semente e o mesmo PCP produzem a mesma saída. O PCP padrão está em `pcp_padrao.json` e pode ser exportado e importado pela página.

## Arquivos

| Arquivo | Conteúdo |
|---|---|
| `index.html` | Página do simulador (PCP, resultados e painel) |
| `motor.js` | Motor de simulação, sem dependências |
| `pcp_padrao.json` | Plano de produção e cenários padrão |
| `testes.html` | Verificação funcional do motor |
| `resultados/` | Resultados da simulação do PCP padrão |
| `CITATION.cff` | Metadados de citação |
| `LICENSE` | Licença MIT |

## Como citar

Casagrande, E. (2026). *gemeo-ciaca: simulador do gêmeo digital na formação de chapas cimentícias* (versão 1.0.0) [Software]. <https://github.com/edcasag/gemeo-ciaca>

## Licença

[MIT](LICENSE).
