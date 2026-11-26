// ══════════════════════════════════════════
// PDF DE REPORTES (diseño aprobado el 2026-11-26)
//
// El PDF se arma aparte de la pantalla, con los mismos datos, en hojas carta
// verticales. Cada hoja lleva su propio encabezado (logo, nombre del reporte
// tal como el nombre del archivo, fecha y hora) y su pie (Página X de Y):
// así salen en Chrome y en Safari aunque el navegador no imprima sus propios
// encabezados. Se pagina a mano, midiendo: si una tabla no cabe, sigue en la
// hoja siguiente con sus títulos de columna y "(continúa)", y un título nunca
// queda solo al final de una hoja.
//
// Safari ignora @page (tamaño y márgenes): ahí la hoja se arma más pequeña
// (7 × 9,6 pulgadas) para que quepa dentro de sus propios márgenes.
//
// Cada render de reportes.js deja en _repPdf lo que está mostrando.
// ══════════════════════════════════════════

let _repPdf = null;

const _PDF_ES_SAFARI = /^((?!chrome|chromium|crios|fxios|edg|android).)*safari/i.test(navigator.userAgent);
const _PDF_HOJA = _PDF_ES_SAFARI ? { ancho: '7in', alto: '9.6in' } : { ancho: '8.25in', alto: '10.85in' };

// ── Formatos ──
const _PDF_MESES = ['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'];
const _pdfNum = n => (Number(n) || 0).toLocaleString('es-CO');
const _pdfPct = x => (Number(x) || 0).toFixed(1).replace('.', ',') + '%';
function _pdfHora(v){
  return new Date(v).toLocaleTimeString('es-CO', { hour:'numeric', minute:'2-digit', timeZone:'America/Bogota' });
}
// "21 nov 2026 · 9:14 p. m."
function _pdfFechaHora(v){
  const [y, m, d] = fechaColombia(v).split('-');
  return `${d} ${_PDF_MESES[Number(m) - 1]} ${y} · ${_pdfHora(v)}`;
}
// "21/11/26"
function _pdfFechaCorta(v){
  const [y, m, d] = fechaColombia(v).split('-');
  return `${d}/${m}/${y.slice(2)}`;
}
function _pdfAhora(){
  const ahora = new Date();
  return {
    corta: ahora.toLocaleString('es-CO', { day:'2-digit', month:'2-digit', year:'2-digit', hour:'numeric', minute:'2-digit', timeZone:'America/Bogota' }),
    larga: `${ahora.toLocaleDateString('es-CO', { day:'numeric', month:'long', year:'numeric', timeZone:'America/Bogota' })} a las ${_pdfHora(ahora)}`
  };
}

// "Unidades" → "und", "Paquetes" → "paq"… (también corrige "1 Unidades")
const _PDF_UNIDADES = { unidad:'und', paquete:'paq', tableta:'tab', ampolla:'amp', envase:'env', sobre:'sob', tubo:'tubo',
  gotero:'got', frasco:'fco', caja:'caja', capsula:'cáp', vial:'vial', rollo:'rollo', bolsa:'bolsa', par:'par',
  litro:'L', galon:'gal', kit:'kit', blister:'blíster', tarro:'tarro', metro:'m' };
function _pdfUnidad(u){
  const t = String(u || '').trim();
  if(!t) return '';
  const b = t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  return _PDF_UNIDADES[b] || _PDF_UNIDADES[b.replace(/s$/, '')] || _PDF_UNIDADES[b.replace(/es$/, '')] || t.toLowerCase();
}
const _pdfCant = (n, u) => `${_pdfNum(n)}<span class="u">${escHtml(_pdfUnidad(u))}</span>`;

// ── Piezas ──
function _pdfPortada(nombre, chips){
  const ahora = _pdfAhora();
  return { html: `<div class="pdf-cv"><div>
      <div class="pdf-cv-eb">Reporte</div>
      <h1>${escHtml(nombre)}</h1>
      <div class="pdf-cv-ch">${chips.filter(Boolean).map(c => `<span>${escHtml(c)}</span>`).join('')}</div>
      <div class="pdf-cv-g">Generado el ${escHtml(ahora.larga)}</div>
    </div><img src="logo.png" alt="Nova Bridge"></div>` };
}
// items: [{n, l, c}] — c: 'hero' (el dato principal), 'warn', 'amber', 'orange', 'sm'
function _pdfKpis(items){
  const cols = items.map(k => /hero/.test(k.c || '') ? '1.45fr' : /sm/.test(k.c || '') ? '1.3fr' : '1fr').join(' ');
  return { html: `<div class="pdf-kp" style="grid-template-columns:${cols}">${items.map(k =>
    `<div class="pdf-k ${k.c || ''}"><div class="pdf-k-n">${k.n}</div><div class="pdf-k-l">${escHtml(k.l)}</div></div>`).join('')}</div>` };
}
function _pdfTitulo(texto, nota){
  return { junto: true, html: `<div class="pdf-st"><span>${escHtml(texto)}</span>${nota ? `<small>${escHtml(nota)}</small>` : ''}</div>` };
}
function _pdfVacio(texto){ return { html: `<div class="pdf-vacio">${escHtml(texto)}</div>` }; }
const _pdfCols = anchos => `<colgroup>${anchos.map(w => `<col style="width:${w}%">`).join('')}</colgroup>`;
// cols: [['Título', 'num'|'' ]]
const _pdfTh = cols => `<tr>${cols.map(([t, c]) => `<th${c ? ` class="${c}"` : ''}>${escHtml(t)}</th>`).join('')}</tr>`;
function _pdfBarra(pct, max){
  const w = max ? Math.max(2, pct / max * 100) : 0;
  return `<div class="pdf-bar"><span class="trk"><i style="width:${w}%"></i></span><span>${_pdfPct(pct)}</span></div>`;
}
// Tabla paginable. banda: { izq, der, tono } (tono: '', 'light', 'red', 'amber', 'green')
function _pdfTabla({ banda, titulo, anchos, cols, filas }){
  return { tabla: { banda, titulo, colgroup: _pdfCols(anchos), thead: _pdfTh(cols), filas } };
}
const _pdfFilaVacia = (n, texto) => `<tr class="vacia"><td colspan="${n}">${escHtml(texto)}</td></tr>`;

// Chips de los filtros activos
function _pdfFiltros({ fechas = true, ubicacion = true, deposito = true } = {}){
  const chips = [];
  if(fechas){
    const d = _repFechaTitulo(document.getElementById('rep-fecha-desde').value);
    const h = _repFechaTitulo(document.getElementById('rep-fecha-hasta').value);
    chips.push(d || h ? `Del ${d || '…'} al ${h || '…'}` : 'Todas las fechas');
  }
  if(ubicacion){
    const ub = document.getElementById('rep-ubicacion');
    chips.push(ub.value ? ub.options[ub.selectedIndex].textContent : 'Todas las ubicaciones');
  }
  if(deposito) chips.push(document.getElementById('rep-deposito').value || 'Todos los depósitos');
  return chips;
}

// ══════════════════════════════════════════
// CONTENIDO DE CADA REPORTE (lista de bloques)
// ══════════════════════════════════════════
function _pdfConsumos(movs){
  const { porUbicacion, totalUnidades, totalValor, itemsSinPrecio } = _repAgruparConsumos(movs);
  const ubs = Object.values(porUbicacion).sort((a, b) => b.valor - a.valor);
  const nDeps = ubs.reduce((a, u) => a + Object.keys(u.depositos).length, 0);
  const pct = v => totalValor ? v / totalValor * 100 : 0;
  const B = [
    _pdfPortada('Consumos y gastos', _pdfFiltros()),
    _pdfKpis([{ n: fmtCOP(totalValor), l: 'Gasto total', c: 'hero' }, { n: _pdfNum(totalUnidades), l: 'Unidades consumidas' },
      { n: _pdfNum(nDeps), l: 'Depósitos con movimiento' }, { n: _pdfNum(itemsSinPrecio), l: 'Ítems sin precio', c: itemsSinPrecio ? 'warn' : '' }])
  ];
  if(!ubs.length){ B.push(_pdfVacio('Sin consumos registrados en este período')); return B; }

  const maxPct = pct(ubs[0].valor);
  B.push(_pdfTitulo('Resumen por ubicación', `${ubs.length} ubicaci${ubs.length === 1 ? 'ón' : 'ones'}`));
  B.push(_pdfTabla({ titulo: 'Resumen por ubicación', anchos: [38, 12, 13, 17, 20],
    cols: [['Ubicación'], ['Depósitos', 'num'], ['Unidades', 'num'], ['Valor', 'num'], ['% del gasto', 'num']],
    filas: ubs.map(u => `<tr><td class="nm">${escHtml(u.nombre)}</td><td class="num">${Object.keys(u.depositos).length}</td><td class="num">${_pdfNum(u.unidades)}</td><td class="num">${fmtCOP(u.valor)}</td><td class="num">${_pdfBarra(pct(u.valor), maxPct)}</td></tr>`)
      .concat(`<tr class="tot"><td>Total</td><td class="num">${_pdfNum(nDeps)}</td><td class="num">${_pdfNum(totalUnidades)}</td><td class="num">${fmtCOP(totalValor)}</td><td class="num">100%</td></tr>`) }));

  B.push(_pdfTitulo('Por depósito', 'ordenado por valor'));
  ubs.forEach(u => {
    const deps = Object.entries(u.depositos).sort((a, b) => b[1].valor - a[1].valor);
    B.push(_pdfTabla({ banda: { izq: u.nombre, der: `${fmtCOP(u.valor)} · ${_pdfNum(u.unidades)} und` }, anchos: [44, 16, 20, 20],
      cols: [['Depósito'], ['Unidades', 'num'], ['Valor', 'num'], ['% del gasto', 'num']],
      filas: deps.map(([nombre, d]) => `<tr><td>${escHtml(nombre)}</td><td class="num">${_pdfNum(d.unidades)}</td><td class="num">${fmtCOP(d.valor)}</td><td class="num faint">${_pdfPct(pct(d.valor))}</td></tr>`)
        .concat(`<tr class="sub"><td>Subtotal ${escHtml(u.nombre)}</td><td class="num">${_pdfNum(u.unidades)}</td><td class="num">${fmtCOP(u.valor)}</td><td class="num">${_pdfPct(pct(u.valor))}</td></tr>`) }));
  });

  B.push(_pdfTitulo('Detalle por Sub-SKU', 'cada depósito, de mayor a menor cantidad'));
  ubs.forEach(u => {
    Object.entries(u.depositos).sort((a, b) => b[1].valor - a[1].valor).forEach(([nombre, d]) => {
      const items = Object.values(d.items).sort((a, b) => b.unidades - a.unidades);
      B.push(_pdfTabla({ banda: { izq: `${u.nombre} / ${nombre}`, der: `${items.length} ítem${items.length !== 1 ? 's' : ''} · ${fmtCOP(d.valor)}` },
        anchos: [44, 21, 13, 10, 12], cols: [['Ítem'], ['Sub-SKU'], ['Lote'], ['Cant.', 'num'], ['Valor', 'num']],
        filas: items.map(it => `<tr><td><span class="nm">${escHtml(it.nombre)}</span><span class="code">${escHtml(it.codigo)}</span></td><td class="mono">${escHtml(it.subSku)}</td><td class="mono faint">${escHtml(it.lote || '—')}</td><td class="num">${_pdfCant(it.unidades, it.unidad)}</td><td class="num">${fmtCOP(it.valor)}</td></tr>`)
          .concat(`<tr class="sub"><td colspan="3">Subtotal ${escHtml(nombre)}</td><td class="num">${_pdfNum(d.unidades)}</td><td class="num">${fmtCOP(d.valor)}</td></tr>`) }));
    });
  });
  return B;
}

// Consumos de un paciente agrupados por atención: los de una misma historia
// clínica, o los registrados seguidos (≤ 30 min) por la misma persona en el
// mismo depósito.
function _pdfAtencionesPaciente(movs){
  const orden = movs.slice().sort((a, b) => String(b.fecha_real || b.created_at).localeCompare(String(a.fecha_real || a.created_at)));
  const grupos = [];
  orden.forEach(m => {
    const t = new Date(m.fecha_real || m.created_at).getTime();
    const g = grupos.find(g => m.hc_client_id ? g.hc === m.hc_client_id
      : !g.hc && g.usuario === (m.usuario_nombre || '') && g.dep === (m.origen_nombre || '') && Math.abs(g.ultimo - t) <= 30 * 60000);
    if(g){ g.movs.push(m); g.ultimo = t; return; }
    grupos.push({ hc: m.hc_client_id || null, usuario: m.usuario_nombre || '', dep: m.origen_nombre || '', ub: m.origen_ubicacion_nombre || '',
      fecha: m.fecha_real || m.created_at, ultimo: t, movs: [m] });
  });
  return grupos;
}

function _pdfCedula(movs, cedula){
  const B = [_pdfPortada('Consumos del paciente', [cedula ? `Cédula ${cedula}` : '', 'Histórico completo, sin límite de fechas'])];
  if(!cedula){ B.push(_pdfVacio('Ingresa la cédula de un paciente para ver su historial de consumos')); return B; }
  if(!movs.length){ B.push(_pdfVacio(`Sin consumos registrados para la cédula ${cedula}`)); return B; }
  const valor = m => (Number(m.precio) || 0) * m.cantidad;
  const total = movs.reduce((a, m) => a + valor(m), 0);
  const ats = _pdfAtencionesPaciente(movs);
  const fechas = movs.map(m => String(m.fecha_real || m.created_at)).sort();
  B.push(_pdfKpis([{ n: fmtCOP(total), l: 'Valor total consumido', c: 'hero' }, { n: _pdfNum(movs.length), l: 'Consumos registrados' },
    { n: _pdfNum(ats.length), l: ats.length === 1 ? 'Atención' : 'Atenciones' },
    { n: `${_pdfFechaCorta(fechas[0])} – ${_pdfFechaCorta(fechas[fechas.length - 1])}`, l: 'Primera y última', c: 'sm' }]));
  B.push(_pdfTitulo('Consumos por atención', 'de la más reciente a la más antigua'));
  ats.forEach(a => {
    const sub = a.movs.reduce((s, m) => s + valor(m), 0);
    B.push(_pdfTabla({ banda: { izq: `${_pdfFechaHora(a.fecha)} — ${a.ub || 'Sin ubicación'} / ${a.dep || 'Sin depósito'}`, der: a.usuario ? `Registró ${a.usuario}` : '', tono: 'light' },
      anchos: [50, 24, 12, 14], cols: [['Ítem'], ['Sub-SKU'], ['Cant.', 'num'], ['Valor', 'num']],
      filas: a.movs.map(m => `<tr><td><span class="nm">${escHtml(m.nombre || '—')}</span><span class="code">${escHtml(m.sku_global_codigo || '')}</span></td><td class="mono">${escHtml(m.sub_sku || '—')}</td><td class="num">${_pdfCant(m.cantidad, m.unidad)}</td><td class="num">${fmtCOP(valor(m))}</td></tr>`)
        .concat(`<tr class="sub"><td colspan="3">Subtotal de la atención</td><td class="num">${fmtCOP(sub)}</td></tr>`) }));
  });
  B.push({ html: `<table class="pdf-t">${_pdfCols([86, 14])}<tbody><tr class="tot"><td>Total del paciente · ${_pdfNum(movs.length)} consumo${movs.length !== 1 ? 's' : ''} en ${_pdfNum(ats.length)} atenci${ats.length !== 1 ? 'ones' : 'ón'}</td><td class="num">${fmtCOP(total)}</td></tr></tbody></table>` });
  return B;
}

function _pdfPacientes(movs, atenciones){
  const { porFechaUbicacion, totalPorUbicacion, cedulas, totalGeneral, nHC, nFug, sinHC } = _repAgruparPacientes(movs, atenciones);
  const nDias = new Set(Object.values(porFechaUbicacion).map(d => d.fecha)).size;
  const B = [
    _pdfPortada('Pacientes atendidos', _pdfFiltros({ deposito: false })),
    _pdfKpis([{ n: _pdfNum(totalGeneral), l: 'Pacientes distintos', c: 'hero' }, { n: _pdfNum(nHC), l: 'Historias clínicas' },
      { n: _pdfNum(nFug), l: 'Atenciones fugaces' }, { n: _pdfNum(nDias), l: 'Días con atención' },
      { n: _pdfNum(sinHC.length), l: 'Consumos sin HC', c: sinHC.length ? 'amber' : '' }])
  ];

  const res = Object.entries(totalPorUbicacion).sort((a, b) => b[1].docs.size - a[1].docs.size);
  B.push({ junto: true, html: `<div class="pdf-st"><span>Atenciones por ubicación</span><span class="pdf-lg"><span><i class="a"></i>Historias clínicas</span><span><i class="b"></i>Fugaces</span></span></div>` });
  if(!res.length){
    B.push(_pdfVacio('Sin atenciones registradas en este período'));
  } else {
    const maxT = Math.max(...res.map(([, t]) => t.hc + t.fugaces));
    B.push(_pdfTabla({ titulo: 'Atenciones por ubicación', anchos: [30, 10, 10, 13, 37],
      cols: [['Ubicación'], ['HC', 'num'], ['Fugaces', 'num'], ['Pacientes', 'num'], ['']],
      filas: res.map(([ub, t]) => { const tot = t.hc + t.fugaces;
        return `<tr><td class="nm">${escHtml(ub)}</td><td class="num">${_pdfNum(t.hc)}</td><td class="num">${_pdfNum(t.fugaces)}</td><td class="num"><b>${_pdfNum(t.docs.size)}</b></td>
          <td><div class="pdf-stk" style="width:${maxT ? tot / maxT * 100 : 0}%"><span class="a" style="width:${tot ? t.hc / tot * 100 : 0}%"></span><span class="b" style="width:${tot ? t.fugaces / tot * 100 : 0}%"></span></div></td></tr>`; })
        .concat(`<tr class="tot"><td>Total</td><td class="num">${_pdfNum(nHC)}</td><td class="num">${_pdfNum(nFug)}</td><td class="num">${_pdfNum(totalGeneral)}</td><td class="nota">Un paciente atendido en varias ubicaciones cuenta una sola vez en el total</td></tr>`) }));

    // Detalle diario: TODOS los documentos atendidos cada día
    const porUb = {};
    Object.values(porFechaUbicacion).forEach(d => { (porUb[d.ubNombre] = porUb[d.ubNombre] || []).push(d); });
    B.push(_pdfTitulo('Detalle diario por ubicación'));
    Object.keys(porUb).sort().forEach(ub => {
      const dias = porUb[ub].sort((a, b) => b.fecha.localeCompare(a.fecha));
      const hc = dias.reduce((a, d) => a + d.hc, 0), fug = dias.reduce((a, d) => a + d.fugaces, 0);
      B.push(_pdfTabla({ banda: { izq: `${ub} · detalle diario`, der: `${dias.length} día${dias.length !== 1 ? 's' : ''} · ${_pdfNum(hc)} HC · ${_pdfNum(fug)} fugaces` },
        anchos: [13, 7, 10, 70], cols: [['Fecha'], ['HC', 'num'], ['Fugaces', 'num'], ['Documentos atendidos']],
        filas: dias.map(d => `<tr><td class="mono">${fmtDate(d.fecha)}</td><td class="num">${d.hc}</td><td class="num">${d.fugaces}</td><td class="docs">${[...d.docs].sort().map(escHtml).join(', ')}</td></tr>`) }));
    });
  }

  if(sinHC.length){
    B.push(_pdfTabla({ banda: { izq: 'Consumos registrados sin historia clínica', der: `${sinHC.length} atenci${sinHC.length !== 1 ? 'ones' : 'ón'} · no cuentan como atendidos`, tono: 'amber' },
      anchos: [20, 15, 38, 27], cols: [['Fecha'], ['Documento'], ['Medicamentos e insumos'], ['Ubicación · registró']],
      filas: sinHC.map(g => `<tr><td class="mono">${escHtml(_pdfFechaHora(g.fecha))}</td><td class="mono">${escHtml(g.cedula || '—')}</td><td>${g.items.map(escHtml).join(', ')}</td><td>${escHtml(g.ubNombre)} · ${escHtml(g.usuario)}</td></tr>`) }));
  }

  B.push(_pdfTitulo('Resumen por cédula', 'consumos registrados a cada paciente'));
  if(!cedulas.length){
    B.push(_pdfVacio('Sin consumos registrados a pacientes en este período'));
  } else {
    cedulas.forEach(c => {
      B.push(_pdfTabla({ banda: { izq: `Cédula ${c.cedula}`, der: `${c.consumos.length} consumo${c.consumos.length !== 1 ? 's' : ''} · ${_pdfNum(c.unidades)} und · ${fmtCOP(c.valor)}`, tono: 'light' },
        anchos: [17, 27, 17, 9, 17, 13], cols: [['Fecha'], ['Ítem'], ['Sub-SKU'], ['Cant.', 'num'], ['Ubicación / depósito'], ['Registró']],
        filas: c.consumos.map(m => `<tr><td class="mono">${escHtml(_pdfFechaHora(m.fecha_real || m.created_at))}</td><td><span class="nm">${escHtml(m.nombre || '—')}</span>${m.hc_client_id && !m.hc_enviada ? '<span class="marca-amb">sin HC</span>' : ''}</td><td class="mono">${escHtml(m.sub_sku || '—')}</td><td class="num">${_pdfCant(m.cantidad, m.unidad)}</td><td>${escHtml(m.origen_ubicacion_nombre || '—')} / ${escHtml(m.origen_nombre || '—')}</td><td>${escHtml(m.usuario_nombre || '—')}</td></tr>`) }));
    });
  }
  return B;
}

function _pdfTop(movs){
  const top = _repTopItemsDetallado(movs, 30);
  const valor = top.reduce((a, it) => a + it.valor, 0), und = top.reduce((a, it) => a + it.unidades, 0);
  const B = [
    _pdfPortada('Top ítems consumidos', _pdfFiltros()),
    _pdfKpis([{ n: fmtCOP(valor), l: 'Costo total del top', c: 'hero' }, { n: _pdfNum(top.length), l: 'Ítems en el ranking' }, { n: _pdfNum(und), l: 'Unidades totales' }])
  ];
  if(!top.length){ B.push(_pdfVacio('Sin consumos en este período')); return B; }
  const max = top[0].unidades, maxV = Math.max(...top.map(it => it.valor));
  B.push(_pdfTitulo('De mayor a menor cantidad', `${top.length} ítem${top.length !== 1 ? 's' : ''}`));
  B.push(_pdfTabla({ titulo: 'De mayor a menor cantidad', anchos: [5, 30, 16, 11, 13, 25],
    cols: [['#', 'num'], ['Ítem'], ['Unidades', 'num'], ['Costo unit.', 'num'], ['Costo total', 'num'], ['Dónde se consumió']],
    filas: top.map((it, i) => `<tr><td class="num faint">${i + 1}</td><td><span class="nm">${escHtml(it.nombre)}</span><span class="lote">${escHtml(it.codigo)} · ${escHtml(it.subSku)}</span></td>
      <td><div class="pdf-bar"><span class="trk"><i style="width:${max ? it.unidades / max * 100 : 0}%"></i></span><span class="num">${_pdfCant(it.unidades, it.unidad)}</span></div></td>
      <td class="num">${fmtCOP(it.precio)}</td>
      <td class="num">${top.length > 1 && it.valor === maxV && maxV > 0 ? `<b>${fmtCOP(it.valor)}</b><span class="marca">▲ mayor costo</span>` : fmtCOP(it.valor)}</td>
      <td><span class="donde">${[...it.ubicaciones].map(escHtml).join(', ') || '—'}</span><span class="lote">${[...it.depositos].map(escHtml).join(', ') || '—'}</span></td></tr>`) }));
  return B;
}

function _pdfSeguridad(depNombre){
  const bodega = (S.bodegasRaw || []).find(b => b.nombre === depNombre);
  const grupo = depNombre ? _repBuscarGrupoSeguridad(depNombre) : null;
  const B = [_pdfPortada('Stock de seguridad', [depNombre ? `Depósito ${depNombre}` : '', bodega?.ubicacion_nombre || '', grupo ? `Grupo ${grupo.nombre}` : ''])];
  if(!depNombre){ B.push(_pdfVacio('Selecciona un depósito para ver su stock de seguridad')); return B; }
  if(!grupo){ B.push(_pdfVacio(`${depNombre} no tiene stock de seguridad asignado. Asígnalo en Ubicaciones (clic en el depósito).`)); return B; }
  const { faltantes, diferencias, completos, sobrantes } = _repCompararSeguridad(depNombre, grupo);
  B.push(_pdfKpis([{ n: _pdfNum(grupo.items.length), l: 'Ítems en la lista', c: 'hero' }, { n: _pdfNum(faltantes.length), l: 'Faltantes', c: faltantes.length ? 'warn' : '' },
    { n: _pdfNum(diferencias.length), l: 'Con diferencia', c: diferencias.length ? 'amber' : '' }, { n: _pdfNum(sobrantes.length), l: 'Sobrantes' }, { n: _pdfNum(completos.length), l: 'Completos' }]));

  // Una línea por lote, en el orden en que conviene usarlos
  const lotes = ls => ls && ls.length
    ? ls.map(l => `<span class="lote">${l.lote ? 'Lote ' + escHtml(l.lote) : 'Sin lote'} · ${escHtml(l.subSku)}${l.caducidad ? ' · vence ' + fmtDate(l.caducidad) : ''}${l.caducidad && getSem(l.caducidad) === 'N' ? ' · <b class="venc">VENCIDO</b>' : ''} · ${_pdfNum(l.cantidad)} und</span>`).join('')
    : '<span class="lote">Sin existencias</span>';
  const caja = '<td class="centro"><span class="pdf-caja"></span></td>';
  const fila = it => { const d = it.actual - it.esperado;
    return `<tr><td><span class="nm">${escHtml(it.nombre)}</span>${lotes(it.lotes)}</td><td class="num">${_pdfNum(it.esperado)}</td><td class="num"><b>${_pdfNum(it.actual)}</b></td><td class="num ${d < 0 ? 'neg' : 'pos'}">${d > 0 ? '+' + d : d}</td>${caja}</tr>`; };
  const anchos = [58, 10, 10, 9, 13], cols = [['Ítem y lotes en el depósito'], ['Esperado', 'num'], ['Actual', 'num'], ['Dif.', 'num'], ['Conteo', 'centro']];
  const cuantos = n => `${n} ítem${n !== 1 ? 's' : ''}`;
  B.push(_pdfTabla({ banda: { izq: 'Faltantes — sin existencias en el depósito', der: cuantos(faltantes.length), tono: 'red' }, anchos, cols,
    filas: faltantes.length ? faltantes.map(fila) : [_pdfFilaVacia(5, 'Sin faltantes')] }));
  B.push(_pdfTabla({ banda: { izq: 'Con diferencia de cantidad', der: cuantos(diferencias.length), tono: 'amber' }, anchos, cols,
    filas: diferencias.length ? diferencias.map(fila) : [_pdfFilaVacia(5, 'Sin diferencias de cantidad')] }));
  B.push(_pdfTabla({ banda: { izq: 'Sobrantes — fuera de la lista de seguridad', der: cuantos(sobrantes.length) }, anchos, cols,
    filas: sobrantes.length ? sobrantes.map(s => `<tr><td><span class="nm">${escHtml(s.nombre)}</span>${lotes(s.lotes)}</td><td class="num faint">—</td><td class="num"><b>${_pdfNum(s.cantidad)}</b></td><td class="num faint">—</td>${caja}</tr>`) : [_pdfFilaVacia(5, 'Sin sobrantes')] }));
  // Completos en dos columnas
  const mitad = Math.ceil(completos.length / 2);
  const celda = it => it ? `<td>${escHtml(it.nombre)}</td><td class="num">${_pdfNum(it.actual)}</td>` : '<td></td><td></td>';
  B.push(_pdfTabla({ banda: { izq: 'Completos — cantidad correcta', der: cuantos(completos.length), tono: 'green' }, anchos: [39, 11, 39, 11],
    cols: [['Ítem'], ['Cant.', 'num'], ['Ítem'], ['Cant.', 'num']],
    filas: completos.length ? completos.slice(0, mitad).map((it, i) => `<tr class="dos">${celda(it)}${celda(completos[mitad + i])}</tr>`) : [_pdfFilaVacia(4, 'Ninguno completo')] }));
  B.push({ html: '<div class="pdf-firmas"><div>Contó (nombre y firma)</div><div>Verificó (nombre y firma)</div><div>Fecha y hora del conteo</div></div>' });
  return B;
}

function _pdfVencidos(){
  const L = { N: 'Vencido', P: 'Por vencer', R: 'Crítico', A: 'Alerta' };
  const estados = ['N', 'P', 'R', 'A'].filter(e => _repEstadosActivos.has(e)).map(e => L[e]);
  const filas = _repAgruparVencidos();
  const n = { N: 0, P: 0, R: 0, A: 0 }, ubs = new Set();
  filas.forEach(f => { n[f.sem]++; ubs.add(f.ubNombre); });
  const B = [
    _pdfPortada('Vencidos y por vencer', _pdfFiltros({ fechas: false }).concat(estados.length ? estados.join(' · ') : 'Ningún estado')),
    _pdfKpis([{ n: _pdfNum(n.N), l: 'Vencidos', c: 'hero' }, { n: _pdfNum(n.P), l: 'Por vencer · < 30 d', c: 'warn' }, { n: _pdfNum(n.R), l: 'Críticos · 30–90 d', c: 'orange' },
      { n: _pdfNum(n.A), l: 'Alertas · 90–180 d', c: 'amber' }, { n: _pdfNum(ubs.size), l: ubs.size === 1 ? 'Ubicación' : 'Ubicaciones' }])
  ];
  if(!estados.length){ B.push(_pdfVacio('Selecciona al menos un estado para ver resultados')); return B; }
  if(!filas.length){ B.push(_pdfVacio('Sin ítems vencidos o por vencer con los filtros actuales')); return B; }

  const grupos = [];
  filas.forEach(f => {
    const g = grupos[grupos.length - 1];
    if(g && g.ub === f.ubNombre && g.dep === f.bodegaNombre) g.items.push(f);
    else grupos.push({ ub: f.ubNombre, dep: f.bodegaNombre, items: [f] });
  });
  const hoy = new Date(fechaColombia() + 'T00:00:00');
  B.push(_pdfTitulo('Por ubicación / depósito', 'lo vencido primero'));
  grupos.forEach(g => {
    B.push(_pdfTabla({ banda: { izq: `${g.ub} / ${g.dep}`, der: `${g.items.length} ítem${g.items.length !== 1 ? 's' : ''}` },
      anchos: [14, 35, 9, 12, 13, 17], cols: [['Estado'], ['Producto'], ['Cant.', 'num'], ['Vence', 'num'], ['Restante', 'num'], ['Sub-SKU']],
      filas: g.items.map(f => {
        const dias = f.s.caducidad ? Math.round((new Date(f.s.caducidad.split('T')[0] + 'T00:00:00') - hoy) / 864e5) : null;
        const resta = dias === null ? '' : dias < 0 ? `hace ${-dias} día${dias !== -1 ? 's' : ''}` : `${dias} día${dias !== 1 ? 's' : ''}`;
        return `<tr><td><span class="pdf-pill ${f.sem}">${L[f.sem]}</span></td><td><span class="nm">${escHtml(f.s.nombre)}</span><span class="code">${escHtml(f.skuG?.codigo || '')}</span></td>
          <td class="num">${_pdfCant(f.cantidad, f.s.unidad)}</td><td class="num">${f.s.caducidad ? fmtDate(f.s.caducidad) : '—'}</td><td class="num${dias !== null && dias < 0 ? ' venc' : ''}">${resta}</td>
          <td class="mono">${escHtml(f.s.subSku)}${f.s.lote ? `<span class="lote">Lote ${escHtml(f.s.lote)}</span>` : ''}</td></tr>`; }) }));
  });

  const alm = _repExistenciasAlmacen(filas);
  B.push(_pdfTitulo('Reemplazo desde Almacén', 'solo para los vencidos'));
  B.push(_pdfTabla({ titulo: 'Reemplazo desde Almacén', anchos: [33, 47, 20], cols: [['Vencido'], ['Disponible en Almacén'], ['Estado']],
    filas: alm.length ? alm.map(v => `<tr><td class="nm">${escHtml(v.nombre)}</td><td class="mono">${v.existencias.length
        ? v.existencias.map(e => `<span class="linea">${escHtml(e.subSku)} · ${_pdfNum(e.cantidad)} ${escHtml(_pdfUnidad(e.unidad))} · ${escHtml(e.bodegaNombre)}</span>`).join('')
        : '<span class="faint">No hay existencias en Almacén</span>'}</td><td>${v.existencias.length ? '<span class="pdf-pill ok">Hay para reponer</span>' : '<span class="pdf-pill N">Pedir compra</span>'}</td></tr>`)
      : [_pdfFilaVacia(3, 'No hay ítems vencidos para cruzar con Almacén')] }));
  return B;
}

function _repPdfBloques(){
  const tipo = document.getElementById('rep-tipo-reporte')?.value;
  const d = _repPdf && _repPdf.tipo === tipo ? _repPdf : null;
  if(tipo === 'consumos') return _pdfConsumos(d ? d.movs : []);
  if(tipo === 'cedula') return _pdfCedula(d ? d.movs : [], d ? d.cedula : '');
  if(tipo === 'pacientes') return _pdfPacientes(d ? d.movs : [], d ? d.atenciones : []);
  if(tipo === 'top') return _pdfTop(d ? d.movs : []);
  if(tipo === 'seguridad') return _pdfSeguridad(document.getElementById('rep-deposito').value);
  if(tipo === 'vencidos') return _pdfVencidos();
  return [_pdfPortada(REP_NOMBRE_CORTO[tipo] || 'Reporte', [])];
}

// ══════════════════════════════════════════
// PAGINACIÓN (se llama con la hoja visible fuera de pantalla para medir)
// ══════════════════════════════════════════
function _repPdfPaginar(hoja){
  const bloques = _repPdfBloques();
  const titulo = _repTituloDocumento();
  const fecha = _pdfAhora().corta;
  hoja.innerHTML = '';
  const paginas = [];
  let cuerpo = null;

  const nueva = () => {
    const pg = document.createElement('div');
    pg.className = 'pdf-pg' + (_PDF_ES_SAFARI ? ' safari' : '');
    pg.style.width = _PDF_HOJA.ancho;
    pg.style.height = _PDF_HOJA.alto;
    pg.innerHTML = `<div class="pdf-h"><img src="logo.png" alt=""><div class="pdf-h-t">${escHtml(titulo)}</div><div class="pdf-h-d">${escHtml(fecha)}</div></div>
      <div class="pdf-b"></div><div class="pdf-f"><span>Nova Bridge · wms.novabridge.com.co</span><span class="pdf-num"></span></div>`;
    hoja.appendChild(pg);
    paginas.push(pg);
    cuerpo = pg.querySelector('.pdf-b');
  };
  const desborda = () => cuerpo.scrollHeight > cuerpo.clientHeight + 1;
  const nodo = html => { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; };

  // Títulos que esperan al bloque siguiente para no quedar solos al final de una hoja
  let pegados = [];
  // Pasa a una hoja nueva lo que no cupo (los títulos pendientes y el bloque)
  const aHojaNueva = (...nodos) => {
    const mover = pegados.concat(nodos);
    mover.forEach(n => n.remove());
    nueva();
    mover.forEach(n => cuerpo.appendChild(n));
  };
  // ¿Hay en la hoja algo más que los títulos pendientes y estos nodos?
  const soloEsto = (...nodos) => cuerpo.children.length <= pegados.length + nodos.length;

  const crearTabla = (t, continua) => {
    const div = document.createElement('div');
    div.className = 'pdf-blk';
    const cab = t.banda
      ? `<div class="pdf-gh ${t.banda.tono || ''}"><span>${escHtml(t.banda.izq)}${continua ? ' <em>(continúa)</em>' : ''}</span><span class="r">${escHtml(t.banda.der || '')}</span></div>`
      : (continua && t.titulo ? `<div class="pdf-st"><span>${escHtml(t.titulo)} <em>(continúa)</em></span></div>` : '');
    div.innerHTML = `${cab}<table class="pdf-t">${t.colgroup}<thead>${t.thead}</thead><tbody></tbody></table>`;
    return div;
  };

  nueva();
  bloques.forEach(b => {
    if(b.tabla){
      const t = b.tabla;
      let blk = crearTabla(t, false);
      cuerpo.appendChild(blk);
      let tbody = blk.querySelector('tbody');
      let enEstaHoja = 0;
      t.filas.forEach((html, i) => {
        tbody.insertAdjacentHTML('beforeend', html);
        const tr = tbody.lastElementChild;
        if(!desborda()) { enEstaHoja++; return; }
        if(i === 0){
          // Ni el encabezado y la primera fila caben: todo el grupo (con sus títulos) pasa a la hoja siguiente
          if(!soloEsto(blk)) aHojaNueva(blk);
          pegados = [];
          enEstaHoja = 1;
          return;
        }
        tr.remove();
        if(enEstaHoja === 0){ tbody.appendChild(tr); enEstaHoja = 1; return; }   // hoja nueva y aun así no cabe: se deja
        nueva();
        blk = crearTabla(t, true);
        cuerpo.appendChild(blk);
        tbody = blk.querySelector('tbody');
        tbody.appendChild(tr);
        enEstaHoja = 1;
      });
      if(!t.filas.length && desborda() && !soloEsto(blk)) aHojaNueva(blk);
      pegados = [];
      return;
    }
    const n = nodo(b.html);
    cuerpo.appendChild(n);
    if(desborda() && !soloEsto(n)) aHojaNueva(n);
    if(b.junto) pegados.push(n);
    else pegados = [];
  });

  // Indicadores: si un número no cabe en su tarjeta, se achica (nunca se corta)
  hoja.querySelectorAll('.pdf-k-n').forEach(el => {
    let px = parseFloat(getComputedStyle(el).fontSize);
    while(el.scrollWidth > el.clientWidth + 1 && px > 8){ px -= 0.5; el.style.fontSize = px + 'px'; }
  });
  paginas.forEach((pg, i) => { pg.querySelector('.pdf-num').textContent = `Página ${i + 1} de ${paginas.length}`; });
}
