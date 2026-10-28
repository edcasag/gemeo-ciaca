/*
 * Motor do simulador do gêmeo digital de uma máquina de formação de chapas
 * cimentícias por acúmulo de lâminas em um cilindro formador.
 *
 * Simulação virtual: a planta (máquina), o corte mecânico, o corte automático
 * do controlador e o gêmeo digital são simulados; não há conexão com o físico.
 *
 * Políticas comparadas, sobre o mesmo plano de produção (PCP) e as mesmas falhas:
 *   mec   corte mecânico por rolo auxiliar, sem sincronismo com o cilindro
 *   auto  corte automático do controlador, setpoint = espessura nominal
 *   gemeo corte automático com setpoint e configuração fornecidos pelo gêmeo
 *
 * Determinístico: a mesma semente produz a mesma saída. Sem dependências.
 * Funciona no navegador (window.Motor) e em CommonJS (module.exports).
 *
 * Uso: const r = Motor.simular(Motor.PCP_PADRAO);
 *      r.ind.lotes[0].pol.gemeo.economia_pct, r.ind.total.pol.gemeo.horas
 *
 * Unidades: espessuras em mm, tempos em s, tolerâncias em % da nominal.
 */
(function (raiz, fabrica) {
  const M = fabrica();
  if (typeof module === 'object' && module.exports) module.exports = M;
  else raiz.Motor = M;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // PCP padrão (campos descritos no README); pcp_padrao.json é uma cópia.
  const PCP_PADRAO = {
    semente: 1,
    // e(t) = lamina_mm + Σ Aᵢ sen(2πt/Pᵢ + φᵢ)
    lamina: {
      amplitudes_mm: [0.040, 0.008, 0.002],
      periodos_s: [960, 480, 240],
      fases_graus: [0, 60, 240]
    },
    lotes: [
      // tolerancia_pct: limite absoluto da norma; faixa_negocio_pct: faixa em que a
      // fábrica quer trabalhar, onde o gêmeo posiciona o setpoint.
      { espessura_mm: 8,  chapas: 5000, lamina_mm: 0.60, tempo_volta_s: 1.5, tolerancia_pct: 10, faixa_negocio_pct: 5, diametro_mm: 1660 },
      { espessura_mm: 12, chapas: 8000, lamina_mm: 0.60, tempo_volta_s: 1.5, tolerancia_pct: 10, faixa_negocio_pct: 5, diametro_mm: 1660 },
      { espessura_mm: 20, chapas: 8000, lamina_mm: 0.60, tempo_volta_s: 1.5, tolerancia_pct: 10, faixa_negocio_pct: 5, diametro_mm: 1890 },
      { espessura_mm: 25, chapas: 3000, lamina_mm: 0.60, tempo_volta_s: 1.5, tolerancia_pct: 10, faixa_negocio_pct: 5, diametro_mm: 2050 },
      { espessura_mm: 30, chapas: 2000, lamina_mm: 0.60, tempo_volta_s: 1.5, tolerancia_pct: 10, faixa_negocio_pct: 5, diametro_mm: 2050 }
    ],
    mecanico: { batimento_cada: 20, laminas_extra: [1, 2] },
    gemeo: { meta_conformidade_pct: 100, margem_limite_inferior_pct: 0, passo_setpoint_mm: 0.05, chapas_por_teste: 400, janela_chapas: 50 },
    // lote em base 1, chapa em base 0; duração na unidade FALHAS[tipo].unidade.
    falhas: [
      { tipo: 'falta_massa',    lote: 1, chapa: 1000, duracao: 20,  ativa: true },
      { tipo: 'rede',           lote: 1, chapa: 3000, duracao: 5,   ativa: true },
      { tipo: 'irregularidade', lote: 2, chapa: 2000, duracao: 300, ativa: true },
      { tipo: 'medidor',        lote: 2, chapa: 6000, duracao: 10,  ativa: true },
      { tipo: 'densidade',      lote: 3, chapa: 1500, duracao: 50,  ativa: true },
      { tipo: 'trancos',        lote: 3, chapa: 5000, duracao: 100, ativa: true },
      { tipo: 'energia',        lote: 4, chapa: 1000, duracao: 600, ativa: true },
      { tipo: 'nuvem',          lote: 4, chapa: 2000, duracao: 300, ativa: true },
      { tipo: 'diametro',       lote: 5, chapa: 0,    duracao: 0,   ativa: true }
    ]
  };

  const DIAMETROS_MM = [1660, 1890, 2050];

  const POLITICAS = ['mec', 'auto', 'gemeo'];
  const NOME_POLITICA = { mec: 'Mecânico', auto: 'Automático', gemeo: 'Automático + gêmeo' };

  // Severidades: alerta (warning), serio (serious), critico (critical).
  const FALHAS = {
    falta_massa:    { nome: 'Falta de massa',                         grupo: 'processo',     unidade: 'voltas', sev: 'critico' },
    irregularidade: { nome: 'Irregularidade da massa',                grupo: 'processo',     unidade: 'chapas', sev: 'serio' },
    densidade:      { nome: 'Densidade inadequada (massa não adere)', grupo: 'processo',     unidade: 'chapas', sev: 'serio' },
    trancos:        { nome: 'Trancos na espessura',                   grupo: 'processo',     unidade: 'chapas', sev: 'alerta' },
    medidor:        { nome: 'Falha do medidor',                       grupo: 'sistema',      unidade: 'chapas', sev: 'critico' },
    rede:           { nome: 'Quebra da rede entre controladores',     grupo: 'sistema',      unidade: 'chapas', sev: 'serio' },
    energia:        { nome: 'Falha de energia',                       grupo: 'sistema',      unidade: 's',      sev: 'critico' },
    nuvem:          { nome: 'Falha de comunicação com a nuvem',       grupo: 'sistema',      unidade: 's',      sev: 'alerta' },
    diametro:       { nome: 'Diâmetro da prensa configurado errado',  grupo: 'configuracao', unidade: 'lote',   sev: 'critico' }
  };

  const AMOSTRA_S = 0.1;        // dados do controlador principal a cada 100 ms
  const PRAZO_DADOS_S = 0.5;    // sem amostra além deste prazo: falta de dados
  const PRAZO_NUVEM_S = 60;     // idade máxima do espelho na nuvem
  const RECARGA_ALARME_S = 300; // intervalo mínimo entre alarmes do mesmo tipo
  const VOLTA_ENERGIA = 5;      // volta da chapa em que a energia cai
  const VOLTAS_SEM_MASSA = 5;   // voltas seguidas sem incremento: falta de massa
  const JANELA_REGIME = 1000;   // incrementos usados na estimativa do regime (> 1 ciclo de e(t))

  // Ruído determinístico em [0, 1) a partir de inteiros: o mesmo (lote, chapa,
  // volta) recebe a mesma perturbação em todas as políticas.
  function h4(a, b, c, d) {
    let x = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul((b + 0x632be5ab) | 0, 0xc2b2ae35) ^
            Math.imul((c + 0x27d4eb2f) | 0, 0x165667b1) ^ Math.imul((d + 0x9e3779b1) | 0, 0x27d4eb2d);
    x ^= x >>> 15; x = Math.imul(x, 0x2c1b3c6d);
    x ^= x >>> 12; x = Math.imul(x, 0x297a2d39);
    x ^= x >>> 15;
    return (x >>> 0) / 4294967296;
  }

  function copiar(o) { return JSON.parse(JSON.stringify(o)); }

  // Faixa do negócio do lote (%); PCP sem o campo usa a tolerância da norma.
  function faixaNegocio(l) { return l.faixa_negocio_pct === undefined ? l.tolerancia_pct : Number(l.faixa_negocio_pct); }

  function validarPCP(pcp) {
    const erros = [];
    if (!pcp || !Array.isArray(pcp.lotes) || pcp.lotes.length === 0) erros.push('O PCP precisa de pelo menos um lote.');
    (pcp.lotes || []).forEach((l, i) => {
      const n = i + 1;
      if (!(l.espessura_mm > 0)) erros.push(`Lote ${n}: espessura deve ser maior que zero.`);
      if (!(l.chapas >= 1 && l.chapas <= 100000)) erros.push(`Lote ${n}: chapas entre 1 e 100.000.`);
      if (!(l.lamina_mm >= 0.2 && l.lamina_mm <= 2)) erros.push(`Lote ${n}: lâmina média entre 0,2 e 2 mm.`);
      if (!(l.tempo_volta_s > 0)) erros.push(`Lote ${n}: tempo por volta deve ser maior que zero.`);
      if (!(l.tolerancia_pct > 0 && l.tolerancia_pct < 50)) erros.push(`Lote ${n}: tolerância da norma entre 0 e 50%.`);
      if (!(faixaNegocio(l) > 0 && faixaNegocio(l) <= l.tolerancia_pct)) erros.push(`Lote ${n}: faixa do negócio deve ser maior que zero e no máximo igual à tolerância da norma.`);
      if (DIAMETROS_MM.indexOf(Number(l.diametro_mm)) < 0) erros.push(`Lote ${n}: diâmetro deve ser ${DIAMETROS_MM.join(', ')} mm.`);
    });
    (pcp.falhas || []).forEach((f, i) => {
      if (!FALHAS[f.tipo]) erros.push(`Falha ${i + 1}: tipo desconhecido.`);
      else if (f.ativa && !(f.lote >= 1 && f.lote <= (pcp.lotes || []).length)) erros.push(`Falha ${i + 1}: lote inexistente.`);
    });
    return erros;
  }

  function amplitudeNominal(pcp) {
    return pcp.lamina.amplitudes_mm.reduce((s, a) => s + Math.abs(a), 0);
  }

  // Falhas ativas indexadas por lote (base 0), na ordem do PCP.
  function falhasPorLote(pcp) {
    const por = pcp.lotes.map(() => []);
    (pcp.falhas || []).forEach((f, idx) => {
      if (f.ativa && FALHAS[f.tipo] && f.lote >= 1 && f.lote <= pcp.lotes.length) {
        por[f.lote - 1].push(Object.assign({ idx }, f));
      }
    });
    return por;
  }

  function dentro(f, i) { return i >= f.chapa && i < f.chapa + Math.max(1, f.duracao); }

  // Lâmina incorporada em uma volta: sinal lento e(t) + efeito das falhas de processo.
  function laminaEm(pcp, mu, t, falhasLote, li, i, k, semente) {
    const lam = pcp.lamina;
    let L = mu;
    for (let j = 0; j < lam.amplitudes_mm.length; j++) {
      L += lam.amplitudes_mm[j] * Math.sin(2 * Math.PI * t / lam.periodos_s[j] + lam.fases_graus[j] * Math.PI / 180);
    }
    for (const f of falhasLote) {
      if (f.tipo === 'falta_massa' && i === f.chapa && k <= f.duracao) return 0;
      if (f.tipo === 'irregularidade' && dentro(f, i)) L += (h4(semente, li * 7 + 1, i, k) - 0.5) * 0.2;
      if (f.tipo === 'trancos' && dentro(f, i)) {
        const seg = Math.floor((k - 1) / 12);
        if (h4(semente, li * 7 + 2, i, seg) < 0.2) L += (h4(semente, li * 7 + 3, i, seg) < 0.5 ? -0.15 : 0.15);
      }
      if (f.tipo === 'densidade' && dentro(f, i) && h4(semente, li * 7 + 4, i, k) < 0.2) return 0;
    }
    return L > 0 ? L : 0;
  }

  // Extras do batimento do corte mecânico: 1 em cada N chapas sai com +1 ou +2
  // lâminas (alternando), porque o corte não é síncrono com o cilindro.
  function extraBatimento(pcp, i) {
    const cada = Math.max(1, pcp.mecanico.batimento_cada | 0);
    if ((i + 1) % cada !== 0) return 0;
    const ex = pcp.mecanico.laminas_extra;
    return ex[Math.floor((i + 1) / cada) % ex.length] | 0;
  }

  // Regra do corte automático: cortar agora se a espessura medida está mais
  // perto do setpoint do que estará depois de mais uma volta.
  function cortaAgora(E, inc, S) { return Math.abs(E - S) <= Math.abs(E + inc - S); }

  // Gêmeo: roda n chapas com a lâmina estimada (mu, amp) e o setpoint S. A
  // lâmina varia devagar em relação à formação de uma chapa: cada chapa do
  // gêmeo recebe uma lâmina constante, sorteada na faixa do regime.
  function gemeoTestar(T, tol, mu, amp, S, n, semente, pcp) {
    let somaAuto = 0, somaMec = 0, conf = 0;
    const lo = T * (1 - tol) - 1e-9, hi = T * (1 + tol) + 1e-9;
    for (let i = 0; i < n; i++) {
      const Lc = mu + (h4(semente, 901, i, 0) * 2 - 1) * amp;
      let E = 0, prev = 0, k = 0, extra = -1;
      for (;;) {
        k++;
        E += Lc;
        if (extra >= 0) { if (extra-- === 0) break; continue; }
        const inc = E - prev;
        if (inc > 0 && cortaAgora(E, inc, S)) break;
        if (E >= T) { extra = extraBatimento(pcp, i); if (extra === 0) break; extra--; if (extra < 0) break; }
        prev = E;
        if (k > 5000) break;
      }
      somaAuto += E;
      if (E >= lo && E <= hi) conf++;
      // Corte mecânico no mesmo regime (referência da economia).
      let Em = 0, km = 0;
      while (Em < T && km < 5000) { km++; Em += Lc; }
      for (let x = extraBatimento(pcp, i); x > 0; x--) { km++; Em += Lc; }
      somaMec += Em;
    }
    return { conf_pct: 100 * conf / n, media_auto: somaAuto / n, media_mec: somaMec / n,
             economia_pct: 100 * (1 - somaAuto / somaMec) };
  }

  // Menor setpoint que mantém a meta de conformidade no gêmeo, dentro da faixa
  // `tol` (a faixa do negócio, fração da nominal). A conformidade cresce com o
  // setpoint a partir do limite inferior; busca binária na grade.
  function otimizarSetpoint(pcp, T, tol, mu, amp) {
    const g = pcp.gemeo, passo = g.passo_setpoint_mm;
    // Piso do setpoint: limite inferior da faixa mais a margem de segurança.
    const margem = Math.min(tol, Math.max(0, (g.margem_limite_inferior_pct || 0) / 100));
    const ini = Math.ceil(T * (1 - tol + margem) / passo - 1e-9), fim = Math.floor(T / passo + 1e-9);
    const ok = (j) => gemeoTestar(T, tol, mu, amp, j * passo, g.chapas_por_teste, pcp.semente, pcp).conf_pct >= g.meta_conformidade_pct;
    if (!ok(fim)) return T;
    let a = ini, b = fim;
    while (a < b) { const m = (a + b) >> 1; if (ok(m)) b = m; else a = m + 1; }
    return Math.round(a * passo * 1000) / 1000;
  }

  // Varredura do setpoint no gêmeo, regime nominal do lote.
  function curvaSetpoint(pcp, li) {
    const l = pcp.lotes[li], T = l.espessura_mm, tol = l.tolerancia_pct / 100;
    const amp = amplitudeNominal(pcp), pts = [];
    for (let p = 100 - l.tolerancia_pct; p <= 100 + 1e-9; p += 0.25) {
      const r = gemeoTestar(T, tol, l.lamina_mm, amp, T * p / 100, pcp.gemeo.chapas_por_teste, pcp.semente, pcp);
      pts.push({ setpoint_pct: Math.round(p * 100) / 100, conf_pct: r.conf_pct, economia_pct: r.economia_pct });
    }
    return pts;
  }

  function desvioPadrao(v) {
    if (v.length < 2) return 0;
    const m = v.reduce((s, x) => s + x, 0) / v.length;
    return Math.sqrt(v.reduce((s, x) => s + (x - m) * (x - m), 0) / (v.length - 1));
  }

  // Simula o PCP inteiro em uma forma de corte, volta a volta; em 'gemeo', com
  // monitoramento, alarmes e envio de setpoint. Vetores indexados pela chapa global g.
  // flags: bit 0 corte mecânico, bit 1 batimento, bit 2 chapa perdida.
  // Voltas da chapa g: espVolta[v0[g] .. v0[g + 1] - 1].
  function simularPolitica(pcp, pol) {
    const total = pcp.lotes.reduce((s, l) => s + (l.chapas | 0), 0);
    const r = {
      pol, n: total,
      lote: new Uint8Array(total), chapa: new Uint32Array(total),
      final: new Float32Array(total), voltas: new Uint16Array(total),
      setpoint: new Float32Array(total), tFim: new Float64Array(total),
      lamina: new Float32Array(total), flags: new Uint8Array(total),
      v0: new Uint32Array(total + 1),   // índice da primeira volta de cada chapa em espVolta
      alarmes: [], setpoints: [], refs: 0,
      eventos: { esperados: 0, registrados: 0, atrasados: 0 },
      deteccoes: {}
    };
    const porLote = falhasPorLote(pcp), semente = pcp.semente | 0;
    const ampNom = amplitudeNominal(pcp);
    const amostrasVolta = (tv) => Math.max(1, Math.round(tv / AMOSTRA_S));
    let t = 0, g = 0;
    const espVolta = [];                  // espessura acumulada ao fim de cada volta
    let nuvemAte = -1, nuvemInicio = -1, nuvemAlarmada = false;
    const ultimoSintoma = {}, inicioFalha = {};

    // Alarme do gêmeo, um por episódio: um sintoma só abre alarme novo depois
    // de RECARGA_ALARME_S sem sintoma do mesmo tipo. A latência é medida desde
    // o início real da falha associada (conhecido só pelo simulador).
    function alarmar(tipo, tA, li, i, msg, falha, tInicio) {
      if (pol !== 'gemeo') return;
      const ult = ultimoSintoma[tipo];
      ultimoSintoma[tipo] = tA;
      if (ult !== undefined && tA - ult < RECARGA_ALARME_S) return;
      const t0 = tInicio !== undefined ? tInicio : (falha ? inicioFalha[falha.idx] : undefined);
      const lat = (t0 !== undefined && t0 !== null) ? Math.max(0, tA - t0) : null;
      r.alarmes.push({ t: tA, tipo, sev: FALHAS[tipo].sev, nome: FALHAS[tipo].nome, lote: li + 1, chapa: i, msg, latencia_s: lat });
      if (falha && r.deteccoes[falha.idx] === undefined) r.deteccoes[falha.idx] = { t: tA, latencia_s: lat };
    }

    for (let li = 0; li < pcp.lotes.length; li++) {
      const l = pcp.lotes[li], T = l.espessura_mm, mu = l.lamina_mm, tv = l.tempo_volta_s;
      const tol = l.tolerancia_pct / 100, neg = faixaNegocio(l) / 100, R = T, aps = amostrasVolta(tv);
      const fl = porLote[li];
      const fDiam = fl.find(f => f.tipo === 'diametro');
      // Configuração na troca de lote.
      let autoOk = pol !== 'mec' && !(pol === 'auto' && fDiam);
      let S = T;
      if (pol === 'gemeo') {
        S = otimizarSetpoint(pcp, T, neg, mu, ampNom);
        r.setpoints.push({ t, g, lote: li + 1, chapa: 0, S, motivo: 'Troca de lote: setpoint, diâmetro e camadas programados pelo PCP' });
        if (fDiam) autoOk = false; // diâmetro manual errado até o gêmeo reprogramar
      }
      // Estado de monitoramento do gêmeo.
      let ultimaAmostra = t, incs = [], zeros = 0, ultimoInc = null, trancoPend = null;
      const janela = [];            // incrementos válidos recentes (estimativa do regime)
      let ampUsada = ampNom, muUsado = mu;

      function reestimar(tA, i, motivo) {
        if (pol !== 'gemeo' || janela.length < 100) return;
        const m = janela.reduce((s, x) => s + x, 0) / janela.length;
        let amp = 0;
        for (const x of janela) amp = Math.max(amp, Math.abs(x - m));
        amp = Math.max(ampNom, amp);
        if (Math.abs(m - muUsado) < 0.01 && Math.abs(amp - ampUsada) < 0.2 * ampUsada) return;
        muUsado = m; ampUsada = amp;
        const novo = otimizarSetpoint(pcp, T, neg, m, amp);
        if (Math.abs(novo - S) > 1e-9) {
          S = novo;
          r.setpoints.push({ t: tA, g, lote: li + 1, chapa: i, S, motivo });
        }
      }

      for (let i = 0; i < l.chapas; i++, g++) {
        if (pol === 'gemeo' && fDiam && i === 1) {
          // O gêmeo detecta na primeira chapa a divergência com o PCP e reprograma o diâmetro.
          autoOk = true;
        }
        if (pol === 'gemeo' && fDiam && i === 0) {
          alarmar('diametro', t + tv, li, i, `Diâmetro configurado diverge do PCP (${l.diametro_mm} mm): corte automático inoperante; o gêmeo reprograma o diâmetro`, fDiam, t);
        }
        for (const f of fl) {
          if (f.tipo === 'nuvem' && i === f.chapa) { nuvemInicio = t; nuvemAte = t + f.duracao; nuvemAlarmada = false; r._falhaNuvem = f; }
          if (inicioFalha[f.idx] === undefined && (FALHAS[f.tipo].unidade === 'chapas' ? dentro(f, i) : i === f.chapa)) inicioFalha[f.idx] = t;
        }
        if (pol === 'gemeo' && i > 0 && i % pcp.gemeo.janela_chapas === 0) reestimar(t, i, 'Reestimativa periódica do regime da lâmina');

        let E = 0, Em = 0, k = 0, extra = -1, soma = 0, mecCut = false, bat = false, perdida = false;
        const kMax = Math.ceil(3 * T / mu) + 200;
        r.v0[g] = espVolta.length;
        for (;;) {
          k++;
          const L = laminaEm(pcp, mu, t, fl, li, i, k, semente);
          E += L; soma += L; t += tv;
          espVolta.push(E);
          r.refs++;
          // Dados do controlador principal nesta volta.
          let med = E, medOk = true, chegou = true;
          for (const f of fl) {
            if (f.tipo === 'medidor' && dentro(f, i)) { med = 0; medOk = false; }
            if (f.tipo === 'rede' && dentro(f, i)) { medOk = false; chegou = false; }
          }
          r.eventos.esperados += 1 + aps;
          r.eventos.registrados += 1 + (chegou ? aps : 0);
          if (t <= nuvemAte) r.eventos.atrasados += 1 + (chegou ? aps : 0);
          if (pol === 'gemeo' && !nuvemAlarmada && nuvemAte > 0 && nuvemInicio + PRAZO_NUVEM_S <= Math.min(t, nuvemAte)) {
            nuvemAlarmada = true;
            alarmar('nuvem', nuvemInicio + PRAZO_NUVEM_S, li, i, 'Espelho na nuvem desatualizado (idade do dado acima de 60 s); eventos retidos na borda', r._falhaNuvem, nuvemInicio);
          }

          // Falha de energia: a chapa em formação se perde.
          const fEn = fl.find(f => f.tipo === 'energia' && i === f.chapa);
          if (fEn && k === VOLTA_ENERGIA) {
            alarmar('energia', t + PRAZO_DADOS_S, li, i, 'Sem dados do controlador principal', fEn, t);
            ultimoSintoma.energia = undefined;
            t += fEn.duracao;
            alarmar('energia', t, li, i, `Reinício do controlador após ${Math.round(fEn.duracao / 60)} min sem energia; chapa em formação perdida`, null);
            perdida = true;
            ultimaAmostra = t;
            break;
          }

          // Monitoramento do gêmeo.
          if (pol === 'gemeo') {
            if (!chegou) {
              if (t - tv + PRAZO_DADOS_S <= t) alarmar('rede', ultimaAmostra + PRAZO_DADOS_S, li, i, 'Sem amostras do medidor além do prazo (rede entre controladores)', fl.find(f => f.tipo === 'rede' && dentro(f, i)), ultimaAmostra);
            } else {
              ultimaAmostra = t;
              if (!medOk) {
                alarmar('medidor', t, li, i, 'Medida fora da faixa física com a referência angular ativa (medidor)', fl.find(f => f.tipo === 'medidor' && dentro(f, i)), t - tv);
              } else {
                const inc = med - Em;
                if (inc < 0.1 * mu) zeros++; else zeros = 0;
                if (zeros === VOLTAS_SEM_MASSA) {
                  alarmar('falta_massa', t, li, i, `Incremento nulo em ${VOLTAS_SEM_MASSA} voltas seguidas: falta de massa`, fl.find(f => f.tipo === 'falta_massa' && i === f.chapa), t - VOLTAS_SEM_MASSA * tv);
                }
                incs.push(inc); if (incs.length > 20) incs.shift();
                const baixos = [];
                incs.forEach((x, j) => { if (x < 0.5 * mu) baixos.push(j); });
                const ultimos10 = baixos.filter(j => j >= incs.length - 10);
                if (ultimos10.length >= 2 && ultimos10[ultimos10.length - 1] - ultimos10[0] >= ultimos10.length) {
                  alarmar('densidade', t, li, i, 'Voltas intermitentes sem incremento: massa não adere ao cilindro', fl.find(f => f.tipo === 'densidade' && dentro(f, i)));
                  reestimar(t, i, 'Alarme de densidade');
                }
                if (inc >= 0.5 * mu) {
                  janela.push(inc); if (janela.length > JANELA_REGIME) janela.shift();
                  if (ultimoInc !== null) {
                    const d = inc - ultimoInc, grande = Math.abs(d) > 0.05;
                    const validos = incs.filter(x => x >= 0.5 * mu);
                    let grandes = 0;
                    for (let j = 1; j < validos.length; j++) if (Math.abs(validos[j] - validos[j - 1]) > 0.05) grandes++;
                    if (grandes >= 5) {
                      trancoPend = null;
                      const f = fl.find(ff => ff.tipo === 'irregularidade' && dentro(ff, i));
                      alarmar('irregularidade', t, li, i, 'Variação da lâmina acima do normal entre voltas', f);
                      reestimar(t, i, 'Alarme de irregularidade da massa');
                    } else if (trancoPend) {
                      // Tranco: degrau isolado que se mantém nas voltas seguintes.
                      trancoPend.n++; if (grande) trancoPend.grandes++;
                      if (trancoPend.n >= 5) {
                        if (trancoPend.grandes === 0) {
                          alarmar('trancos', t, li, i, `Degrau de ${trancoPend.d.toFixed(2).replace('.', ',')} mm na lâmina, mantido nas voltas seguintes`, fl.find(ff => ff.tipo === 'trancos' && dentro(ff, i)));
                          reestimar(t, i, 'Alarme de tranco na espessura');
                        }
                        trancoPend = null;
                      }
                    } else if (Math.abs(d) > 0.1 && grandes <= 1) {
                      trancoPend = { d, n: 0, grandes: 0 };
                    }
                  }
                  ultimoInc = inc;
                }
              }
            }
          }

          // Decisão de corte.
          if (extra >= 0) { if (extra-- === 0) { mecCut = true; break; } continue; }
          if (pol !== 'mec' && autoOk && medOk) {
            const inc = med - Em;
            if (inc > 0.1 * mu && cortaAgora(med, inc, S)) break;
          }
          if (E >= R) {
            const ex = extraBatimento(pcp, i);
            bat = ex > 0;
            if (ex === 0) { mecCut = true; break; }
            extra = ex - 1;
            if (extra < 0) { mecCut = true; break; }
          }
          if (medOk) Em = med;
          if (k >= kMax) { mecCut = true; break; }
        }
        r.lote[g] = li; r.chapa[g] = i; r.final[g] = E; r.voltas[g] = k;
        r.setpoint[g] = pol === 'mec' || !autoOk ? R : S;
        r.tFim[g] = t; r.lamina[g] = k ? soma / k : 0;
        r.flags[g] = (mecCut ? 1 : 0) | (bat ? 2 : 0) | (perdida ? 4 : 0);
      }
    }
    r.tTotal = t;
    r.v0[total] = espVolta.length;
    r.espVolta = Float32Array.from(espVolta);
    delete r._falhaNuvem;
    return r;
  }

  // Indicadores por lote e totais (definições no README). Material: soma das
  // espessuras finais, base de economia_pct e chapas_economizadas.
  function indicadores(pcp, res) {
    const lotes = pcp.lotes.map((l, li) => {
      const o = { lote: li + 1, espessura_mm: l.espessura_mm, chapas: l.chapas, pol: {} };
      for (const pol of POLITICAS) {
        const r = res[pol], T = l.espessura_mm, tol = l.tolerancia_pct / 100, neg = faixaNegocio(l) / 100;
        const vals = [];
        let c10 = 0, c5 = 0, cTol = 0, cNeg = 0, vt = 0, mat = 0, perdidas = 0, mec = 0, t0 = null, t1 = 0;
        for (let g = 0; g < r.n; g++) {
          if (r.lote[g] !== li) continue;
          const f = r.final[g], d = Math.abs(f - T);
          if (t0 === null) t0 = g > 0 ? r.tFim[g - 1] : 0;
          t1 = r.tFim[g];
          mat += f; vt += r.voltas[g];
          if (r.flags[g] & 4) { perdidas++; continue; }
          if (r.flags[g] & 1) mec++;
          vals.push(f);
          if (d <= 0.10 * T + 1e-9) c10++;
          if (d <= 0.05 * T + 1e-9) c5++;
          if (d <= tol * T + 1e-9) cTol++;
          if (d <= neg * T + 1e-9) cNeg++;
        }
        const n = l.chapas, horas = (t1 - t0) / 3600;
        o.pol[pol] = {
          conf10_pct: 100 * c10 / n, conf5_pct: 100 * c5 / n, conf_tol_pct: 100 * cTol / n, conf_neg_pct: 100 * cNeg / n,
          media_mm: vals.reduce((s, x) => s + x, 0) / Math.max(1, vals.length),
          dp_mm: desvioPadrao(vals), voltas_media: vt / n,
          chapas_hora: horas > 0 ? n / horas : 0, horas, material_mm: mat,
          material_por_conforme_mm: cTol ? mat / cTol : null,
          refugo: n - cTol, perdidas, corte_mecanico: mec
        };
      }
      for (const pol of POLITICAS) {
        const p = o.pol[pol], m = o.pol.mec.material_mm;
        p.economia_pct = 100 * (1 - p.material_mm / m);
        p.chapas_economizadas = (m - p.material_mm) / (p.material_mm / l.chapas);
      }
      return o;
    });
    const total = { pol: {} };
    for (const pol of POLITICAS) {
      const r = res[pol];
      let mat = 0, conf = 0, confNeg = 0, vt = 0, n = 0;
      lotes.forEach(o => { const p = o.pol[pol]; mat += p.material_mm; conf += p.conf_tol_pct * o.chapas / 100; confNeg += p.conf_neg_pct * o.chapas / 100; vt += p.voltas_media * o.chapas; n += o.chapas; });
      total.pol[pol] = {
        material_mm: mat, conf_tol_pct: 100 * conf / n, conf_neg_pct: 100 * confNeg / n, voltas_media: vt / n,
        chapas_hora: n / (r.tTotal / 3600), horas: r.tTotal / 3600,
        completude_trilha_pct: 100 * r.eventos.registrados / r.eventos.esperados,
        eventos_atrasados: r.eventos.atrasados
      };
    }
    for (const pol of POLITICAS) {
      const p = total.pol[pol], m = total.pol.mec.material_mm;
      p.economia_pct = 100 * (1 - p.material_mm / m);
      const n = lotes.reduce((s, o) => s + o.chapas, 0);
      p.chapas_economizadas = (m - p.material_mm) / (p.material_mm / n);
    }
    return { lotes, total };
  }

  // Resumo das falhas injetadas, a partir da execução com o gêmeo.
  function resumoFalhas(pcp, res) {
    const r = res.gemeo, saida = [];
    (pcp.falhas || []).forEach((f, idx) => {
      if (!f.ativa || !FALHAS[f.tipo]) return;
      const li = f.lote - 1, l = pcp.lotes[li];
      if (!l) return;
      let ini = f.chapa, fim = f.chapa + 1;
      if (FALHAS[f.tipo].unidade === 'chapas') fim = f.chapa + Math.max(1, f.duracao);
      if (f.tipo === 'diametro') { ini = 0; fim = l.chapas; }
      const afetadas = { gemeo: 0, auto: 0, mec: 0 }, foraTol = { gemeo: 0, auto: 0, mec: 0 };
      for (const pol of POLITICAS) {
        const rp = res[pol], T = l.espessura_mm, tol = l.tolerancia_pct / 100;
        for (let g = 0; g < rp.n; g++) {
          if (rp.lote[g] !== li || rp.chapa[g] < ini || rp.chapa[g] >= fim) continue;
          afetadas[pol]++;
          if ((rp.flags[g] & 4) || Math.abs(rp.final[g] - T) > tol * T + 1e-9) foraTol[pol]++;
        }
      }
      const det = r.deteccoes[idx];
      saida.push({ idx, tipo: f.tipo, nome: FALHAS[f.tipo].nome, grupo: FALHAS[f.tipo].grupo, sev: FALHAS[f.tipo].sev,
                   lote: f.lote, chapa: f.chapa, duracao: f.duracao, unidade: FALHAS[f.tipo].unidade,
                   detectada: !!det, latencia_s: det ? det.latencia_s : null,
                   chapas: afetadas.gemeo, fora_tol: foraTol });
    });
    return saida;
  }

  // Retorna { pcp, res: {mec, auto, gemeo}, ind: {lotes, total}, curvas, falhas, ms, erros }.
  function simular(pcpEntrada) {
    const pcp = copiar(pcpEntrada);
    const erros = validarPCP(pcp);
    if (erros.length) return { erros };
    const t0 = (typeof performance !== 'undefined' ? performance : Date).now();
    const res = {};
    for (const pol of POLITICAS) res[pol] = simularPolitica(pcp, pol);
    const ind = indicadores(pcp, res);
    const curvas = pcp.lotes.map((_, li) => curvaSetpoint(pcp, li));
    const falhas = resumoFalhas(pcp, res);
    const ms = (typeof performance !== 'undefined' ? performance : Date).now() - t0;
    return { pcp, res, ind, curvas, falhas, ms, erros: [] };
  }

  return {
    PCP_PADRAO, DIAMETROS_MM, POLITICAS, NOME_POLITICA, FALHAS,
    simular, simularPolitica, indicadores, curvaSetpoint, otimizarSetpoint, gemeoTestar,
    validarPCP, copiar, extraBatimento, cortaAgora, faixaNegocio
  };
});
