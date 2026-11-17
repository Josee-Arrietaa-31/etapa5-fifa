/* Lógica prescriptiva de la Etapa 4, portada a JavaScript para los dashboards de la presentación.
   Mismas reglas que el notebook (resolver_transferencias, greedy_equipo / lp_equipo, evaluar_venta). */
(function (root) {
  'use strict';
  var CATS = ['Portero', 'Defensa', 'Mediocampista', 'Delantero'];

  function cargarMercado(M) {
    return M.rows.map(function (r, i) {
      return { i: i, id: r[0], name: r[1], club: M.clubs[r[2]], pos: r[3], cat: CATS[r[4]], age: r[5], ovr: r[6],
               pot: r[7], value: r[8], wage: r[9], est: r[10] === 1, vpr: r[8] / r[6] };
    });
  }
  function mean(a) { var s = 0; for (var i = 0; i < a.length; i++) s += a[i]; return s / a.length; }
  function quantile(arr, q) {   // igual que pandas (interpolación lineal)
    var a = Float64Array.from(arr).sort();
    if (!a.length) return NaN;
    var pos = (a.length - 1) * q, lo = Math.floor(pos), hi = Math.ceil(pos);
    return a[lo] + (a[hi] - a[lo]) * (pos - lo);
  }
  function median(a) { return quantile(a, 0.5); }

  /* Poda exacta: un jugador que tiene al menos `need` rivales con puntaje >= y costo <= nunca hace falta,
     porque siempre queda uno de ellos libre para reemplazarlo sin perder puntaje ni pasar el presupuesto. */
  function podar(items, need) {
    var idx = items.map(function (_, i) { return i; });
    idx.sort(function (a, b) { return (items[b].f - items[a].f) || (items[a].c - items[b].c) || (a - b); });
    var keep = [];
    for (var t = 0; t < idx.length; t++) {
      var it = items[idx[t]], cnt = 0;
      for (var u = 0; u < t && cnt < need; u++) { var j = items[idx[u]]; if (j.f >= it.f && j.c <= it.c) cnt++; }
      if (cnt < need) keep.push(idx[t]);
    }
    return keep;
  }

  /* ---------------- Mercado de transferencias ---------------- */
  // Ramificación y acotamiento exacto: elige exactamente n jugadores, maximiza f y, a igual f, minimiza el costo.
  function mejorSubconjunto(items, n, presupuesto, maxNodos) {
    var m = items.length, ord = items.slice().sort(function (a, b) { return (b.f - a.f) || (a.c - b.c); });
    var f = ord.map(function (x) { return x.f; }), c = ord.map(function (x) { return x.c; });
    // costo mínimo de elegir r jugadores entre los índices >= i
    var minCost = [];
    for (var i = 0; i <= m; i++) {
      var resto = c.slice(i).sort(function (a, b) { return a - b; }), acc = [0];
      for (var r = 0; r < Math.min(n, resto.length); r++) acc.push(acc[r] + resto[r]);
      minCost.push(acc);
    }
    var best = { f: -Infinity, c: Infinity, pick: null }, cur = [], nodos = 0, cortado = false, EPS = 1e-9;
    function dfs(i, k, fs, cs) {
      if (++nodos > maxNodos) { cortado = true; return; }
      if (k === n) {
        if (fs > best.f + EPS || (Math.abs(fs - best.f) <= EPS && cs < best.c)) best = { f: fs, c: cs, pick: cur.slice() };
        return;
      }
      var faltan = n - k;
      if (m - i < faltan) return;
      if (cs + minCost[i][faltan] > presupuesto) return;
      var cota = fs; for (var j = i; j < i + faltan; j++) cota += f[j];   // los f están ordenados de mayor a menor
      if (cota < best.f - EPS) return;
      if (cs + c[i] <= presupuesto) { cur.push(i); dfs(i + 1, k + 1, fs + f[i], cs + c[i]); cur.pop(); if (cortado) return; }
      dfs(i + 1, k, fs, cs);
    }
    dfs(0, 0, 0, 0);
    return { pick: best.pick ? best.pick.map(function (i) { return ord[i]; }) : null, exacto: !cortado };
  }

  function transferencias(mercado, o) {
    var grupo = mercado.filter(function (p) { return p.age < o.edadMenorA && p.pot > o.potencialMayorA && (!o.excluirEstimados || !p.est); });
    var mediaMercado = mean(mercado.map(function (p) { return p.vpr; }));
    var mediaGrupo = grupo.length ? mean(grupo.map(function (p) { return p.vpr; })) : NaN;
    var mediaRef, texto;
    if (o.referencia === 'auto') {
      var nM = grupo.filter(function (p) { return p.vpr < mediaMercado; }).length;
      if (nM >= o.n) { mediaRef = mediaMercado; texto = 'de todo el mercado'; } else { mediaRef = mediaGrupo; texto = 'del grupo elegible'; }
    } else if (o.referencia === 'mercado') { mediaRef = mediaMercado; texto = 'de todo el mercado'; }
    else if (o.referencia === 'grupo') { mediaRef = mediaGrupo; texto = 'del grupo elegible'; }
    else { mediaRef = Infinity; texto = 'sin filtro de valor por rating'; }
    var cand = grupo.filter(function (p) { return p.vpr < mediaRef; });
    var r = { grupo: grupo, candidatos: cand, mediaRef: mediaRef, texto: texto, mediaMercado: mediaMercado, mediaGrupo: mediaGrupo, fichajes: [], ok: false, mensaje: '' };
    if (cand.length < o.n) {
      r.mensaje = 'Solo hay ' + cand.length + ' candidatos que cumplen las condiciones y se pidieron ' + o.n + '. Pruebe con una edad mayor, un potencial menor u otra media de referencia.';
      return r;
    }
    var w = { potencial: [1, 0.001], overall: [0.001, 1], ambos: [1, 1] }[o.objetivo];
    var items = cand.map(function (p) { return { p: p, f: w[0] * p.pot + w[1] * p.ovr, c: p.value }; });
    var keep = podar(items, o.n).map(function (i) { return items[i]; });
    var sol = mejorSubconjunto(keep, o.n, o.presupuesto, 3e6);
    if (!sol.pick) {
      var baratos = cand.map(function (p) { return p.value; }).sort(function (a, b) { return a - b; }).slice(0, o.n);
      r.mensaje = 'No existe una combinación de ' + o.n + ' candidatos dentro del presupuesto: los ' + o.n + ' más baratos ya cuestan €' + (baratos.reduce(function (a, b) { return a + b; }, 0) / 1e6).toFixed(1) + 'M.';
      return r;
    }
    r.fichajes = sol.pick.map(function (x) { return x.p; }).sort(function (a, b) { return (b.pot - a.pot) || (b.ovr - a.ovr); });
    r.exacto = sol.exacto; r.ok = true;
    return r;
  }

  /* ---------------- Construcción de equipo ---------------- */
  var FORMACIONES = {
    '1-4-3-3': { Portero: 1, Defensa: 4, Mediocampista: 3, Delantero: 3 },
    '1-4-4-2': { Portero: 1, Defensa: 4, Mediocampista: 4, Delantero: 2 },
    '1-3-5-2': { Portero: 1, Defensa: 3, Mediocampista: 5, Delantero: 2 },
    '1-5-3-2': { Portero: 1, Defensa: 5, Mediocampista: 3, Delantero: 2 },
    '1-4-5-1': { Portero: 1, Defensa: 4, Mediocampista: 5, Delantero: 1 },
    '1-3-4-3': { Portero: 1, Defensa: 3, Mediocampista: 4, Delantero: 3 }
  };

  function stableSort(arr, cmp) {
    return arr.map(function (x, i) { return [x, i]; }).sort(function (a, b) { return cmp(a[0], b[0]) || (a[1] - b[1]); }).map(function (x) { return x[0]; });
  }

  // Greedy: misma lógica que la Etapa 4
  function greedy(pool, req, limite) {
    var restantes = Object.assign({}, req), gastado = 0, elegidos = [], usados = new Set();
    var nB = Math.max.apply(null, CATS.map(function (c) { return req[c]; })) + 5, baratos = {};
    CATS.forEach(function (c) {
      baratos[c] = stableSort(pool.filter(function (p) { return p.cat === c; }), function (a, b) { return a.value - b.value; }).slice(0, nB);
    });
    function minimoPendiente(rest) {
      var total = 0;
      CATS.forEach(function (c) {
        var n = rest[c], k = 0;
        for (var i = 0; i < baratos[c].length && k < n; i++) { if (!usados.has(baratos[c][i].id)) { total += baratos[c][i].value; k++; } }
      });
      return total;
    }
    var orden = stableSort(pool, function (a, b) { return (b.ovr - a.ovr) || (a.value - b.value); });
    var faltan = CATS.reduce(function (s, c) { return s + req[c]; }, 0);
    for (var t = 0; t < orden.length && faltan > 0; t++) {
      var j = orden[t];
      if (!restantes[j.cat]) continue;
      var nuevo = Object.assign({}, restantes); nuevo[j.cat] -= 1;
      usados.add(j.id);
      if (gastado + j.value + minimoPendiente(nuevo) <= limite) { restantes = nuevo; gastado += j.value; elegidos.push(j); faltan--; }
      else usados.delete(j.id);
    }
    return faltan === 0 ? elegidos : null;
  }

  // Programación entera exacta por categoría (mochila con cantidad fija) + combinación entre categorías.
  // Maximiza la suma de overall y, a igual suma, minimiza el costo (en la Etapa 4 coincide con la solución de linprog).
  function mochilaCategoria(items, q) {
    var m = items.length, S = 0, top = items.map(function (x) { return x.ovr; }).sort(function (a, b) { return b - a; });
    for (var i = 0; i < Math.min(q, m); i++) S += top[i];
    var W = S + 1, K = q + 1, dp = new Float64Array(K * W).fill(Infinity), bits = new Uint32Array(Math.ceil(m * K * W / 32) + 1);
    dp[0] = 0; var reach = 0;
    for (var it = 0; it < m; it++) {
      var sc = items[it].ovr, c = items[it].value; reach = Math.min(S, reach + sc);
      for (var k = Math.min(it + 1, q); k >= 1; k--) {
        var base = k * W, prev = (k - 1) * W;
        for (var s = reach; s >= sc; s--) {
          var v = dp[prev + s - sc] + c;
          if (v < dp[base + s]) { dp[base + s] = v; var b = (it * K + k) * W + s; bits[b >>> 5] |= (1 << (b & 31)); }
        }
      }
    }
    return {
      cost: dp.slice(q * W, q * W + W),
      pick: function (s) {
        var out = [], k = q;
        for (var it = m - 1; it >= 0 && k > 0; it--) { var b = (it * K + k) * W + s; if (bits[b >>> 5] & (1 << (b & 31))) { out.push(items[it]); k--; s -= items[it].ovr; } }
        return out;
      }
    };
  }

  function exacto(pool, req, limite) {
    var tablas = [];
    for (var ci = 0; ci < CATS.length; ci++) {
      var cat = CATS[ci], q = req[cat];
      var del = pool.filter(function (p) { return p.cat === cat; });
      var items = del.map(function (p) { return { p: p, f: p.ovr, c: p.value }; });
      var keep = podar(items, q).map(function (i) { return items[i].p; });
      tablas.push({ cat: cat, mk: mochilaCategoria(keep, q) });
    }
    // combinar: h[s] = costo mínimo con suma total s
    var h = Float64Array.from(tablas[0].mk.cost), arg = [];
    for (var t = 1; t < tablas.length; t++) {
      var g = tablas[t].mk.cost, nh = new Float64Array(h.length + g.length - 1).fill(Infinity), a = new Int32Array(nh.length).fill(-1);
      for (var s1 = 0; s1 < h.length; s1++) { if (h[s1] === Infinity) continue;
        for (var s2 = 0; s2 < g.length; s2++) { if (g[s2] === Infinity) continue; var v = h[s1] + g[s2]; if (v < nh[s1 + s2]) { nh[s1 + s2] = v; a[s1 + s2] = s2; } } }
      arg.push(a); h = nh;
    }
    var best = -1;
    for (var s = h.length - 1; s >= 0; s--) if (h[s] <= limite) { best = s; break; }
    if (best < 0) return null;
    var equipo = [], rest = best;
    for (var t2 = tablas.length - 1; t2 >= 1; t2--) { var s2b = arg[t2 - 1][rest]; equipo = equipo.concat(tablas[t2].mk.pick(s2b)); rest -= s2b; }
    equipo = equipo.concat(tablas[0].mk.pick(rest));
    return equipo;
  }

  function equipo(mercado, o) {
    var req = FORMACIONES[o.formacion];
    var pool = mercado.filter(function (p) { return p.age <= o.edadMax && (!o.excluirEstimados || !p.est); });
    var limite = o.presupuesto - 1;   // costo MENOR al presupuesto
    var r = { req: req, equipos: {}, mensaje: '' };
    var faltan = CATS.filter(function (c) { return pool.filter(function (p) { return p.cat === c; }).length < req[c]; });
    if (faltan.length) { r.mensaje = 'No hay suficientes jugadores con esos filtros en: ' + faltan.join(', ') + '.'; return r; }
    var minimo = 0;
    CATS.forEach(function (c) { var v = pool.filter(function (p) { return p.cat === c; }).map(function (p) { return p.value; }).sort(function (a, b) { return a - b; }); for (var i = 0; i < req[c]; i++) minimo += v[i]; });
    if (minimo > limite) { r.mensaje = 'El equipo más barato posible cuesta €' + (minimo / 1e6).toFixed(1) + 'M: el presupuesto no alcanza.'; return r; }
    r.equipos.greedy = greedy(pool, req, limite);
    r.equipos.lp = exacto(pool, req, limite);
    return r;
  }

  /* ---------------- Vender o no ---------------- */
  function venta(mercado, o) {
    var sim = mercado.filter(function (p) { return Math.abs(p.ovr - o.overall) <= o.rangoOverall && Math.abs(p.age - o.edad) <= o.rangoEdad; });
    var r = { similares: sim, ok: false, mensaje: '' };
    if (sim.length < 5) { r.mensaje = 'Solo hay ' + sim.length + ' jugadores parecidos en el mercado: amplíe el rango de overall o de edad.'; return r; }
    var cerc = sim.filter(function (p) { return p.ovr === o.overall && Math.abs(p.age - o.edad) <= 1; });
    if (!cerc.length) cerc = sim;
    var valorSup = median(cerc.map(function (p) { return p.value; })), salarioSup = quantile(sim.map(function (p) { return p.wage; }), 0.85);
    var valor = o.oferta != null ? o.oferta : valorSup, salario = o.salario != null ? o.salario : salarioSup;
    var brecha = o.potencial - o.overall;
    var medVpr = median(sim.map(function (p) { return p.vpr; })), medSal = median(sim.map(function (p) { return p.wage; }));
    var medBrecha = median(sim.map(function (p) { return p.pot - p.ovr; }));
    var c1 = valor / o.overall >= medVpr, c2 = brecha <= medBrecha, c3 = salario > medSal;
    var votos = (c1 ? 1 : 0) + (c2 ? 1 : 0) + (c3 ? 1 : 0);
    Object.assign(r, { ok: true, cercanos: cerc, valor: valor, salario: salario, valorSupuesto: valorSup, salarioSupuesto: salarioSup,
      brecha: brecha, medVpr: medVpr, medSal: medSal, medBrecha: medBrecha, criterios: [c1, c2, c3], votos: votos,
      decision: votos >= o.votosMinimos ? 'VENDER' : 'RETENER', equilibrio: medVpr * o.overall });
    return r;
  }

  root.Prescriptivo = { cargarMercado: cargarMercado, transferencias: transferencias, equipo: equipo, venta: venta, FORMACIONES: FORMACIONES, CATS: CATS };
})(typeof window !== 'undefined' ? window : globalThis);
