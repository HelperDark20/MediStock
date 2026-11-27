let currentRole = null;
let S = {
  skusGlobales: [],
  subSkus: [],
  stock: [],
  bodegas: [],
  ubicaciones: [],          // activas (permanentes + temporales en curso)
  ubicacionesHistoricas: [], // + temporales finalizadas (solo admin, filtros de Reportes)
  usuarios: [],
  movimientos: [],
  eventos: [],
  stockSeguridad: [],
};

// Lo que cambia al registrar un movimiento (entrada, traslado, consumo,
// destrucción, reversión): el stock (y con él los Sub-SKU) y el historial.
const CARGA_MOVIMIENTO = ['stock', 'movimientos'];

// partes: qué recargar ('bodegas', 'globales', 'stock', 'movimientos',
// 'ubicaciones', 'eventos', 'usuarios', 'seguridad'); sin partes, todo.
// Recargar todo tras cada acción eran 9 consultas por clic y mantenía la base
// de datos (Neon cobra por hora encendida) trabajando de más.
async function loadState(partes){
  if(!localStorage.getItem('nb_token')) return;
  const quiere = p => !partes || partes.includes(p);
  const admin = currentRole === 4;
  try {
    showLoading(true);
    const tareas = {
      bodegas:     quiere('bodegas')     ? Bodegas.getAll()       : null,
      globales:    quiere('globales')    ? SKUs.getGlobales()     : null,
      stock:       quiere('stock')       ? SKUs.getStock()        : null,
      movimientos: quiere('movimientos') ? Movimientos.getAll()   : null,
      ubicaciones: quiere('ubicaciones') ? Ubicaciones.getAll()   : null,
      eventos:     quiere('eventos')     ? Eventos.getAll()       : null,
      usuarios:    admin && quiere('usuarios')    ? Usuarios.getAll()           : null,
      seguridad:   admin && quiere('seguridad')   ? StockSeguridad.getAll()     : null,
      historicas:  admin && quiere('ubicaciones') ? Ubicaciones.getHistoricas() : null,
    };
    const claves = Object.keys(tareas);
    const res = await Promise.all(claves.map(k => tareas[k]));
    const r = {};
    claves.forEach((k, i) => { r[k] = res[i]; });

    // S solo se reemplaza si todo cargó (Promise.all falla si falla una)
    if(r.bodegas){ S.bodegas = r.bodegas.map(b => b.nombre); S.bodegasRaw = r.bodegas; }
    if(r.ubicaciones) S.ubicaciones = r.ubicaciones;
    if(r.globales) S.skusGlobales = r.globales;
    if(r.movimientos) S.movimientos = r.movimientos;
    if(r.eventos) S.eventos = r.eventos;
    if(r.usuarios) S.usuarios = r.usuarios;
    if(r.seguridad) S.stockSeguridad = r.seguridad;
    if(r.historicas) S.ubicacionesHistoricas = r.historicas;

    if(r.stock){
    S.stock = r.stock;
    // Construir subSkus desde stock
    const subMap = {};
    r.stock.forEach(row => {
      // FIX: ignorar filas con sub_sku_id null (LEFT JOIN sin stock)
      const sid = row.sub_sku_id;
      if(!sid) return;

      if(!subMap[sid]){
        subMap[sid] = {
          id: sid,
          skuGlobalId: row.sku_global_id,
          subSku: row.sub_sku,
          nombre: row.nombre,
          proveedor: row.proveedor,
          lote: row.lote,
          invima: row.invima,
          caducidad: row.caducidad,
          unidad: row.unidad,
          precio: Number(row.precio)||0,
          agotado: false,
          stock: {}
        };
      }
      // Solo agregar bodega si existe (LEFT JOIN puede traer null)
      if(row.bodega_nombre){
        subMap[sid].stock[row.bodega_nombre] = row.cantidad || 0;
      }
    });

    // Marcar agotado si stock total es 0 en todas las ubicaciones
    S.subSkus = Object.values(subMap).map(s => ({
      ...s,
      agotado: Object.values(s.stock).reduce((a, v) => a + v, 0) === 0
    }));
    }

    _avisoCargaDatos(null);
  } catch(err){
    // Los datos anteriores se conservan (S solo se reemplaza si todo cargó).
    // Al entrar, S está vacío: sin este aviso parecía un inventario en blanco.
    console.error('Error cargando datos:', err);
    _avisoCargaDatos(err.message);
  } finally {
    showLoading(false);
  }
}

// Aviso fijo arriba del contenido mientras los datos no se puedan cargar
function _avisoCargaDatos(motivo){
  let el = document.getElementById('aviso-carga-datos');
  if(!motivo){ if(el) el.remove(); return; }
  if(!el){
    el = document.createElement('div');
    el.id = 'aviso-carga-datos';
    el.className = 'alert-banner show red';
    document.querySelector('#app .content')?.prepend(el);
  }
  el.innerHTML = `<i class="ti ti-alert-circle"></i><span style="flex:1"><strong>No se pudieron cargar los datos.</strong> ${escHtml(motivo)} Lo que ves puede estar incompleto o vacío.</span><button class="tb-btn" onclick="resetState()"><i class="ti ti-refresh"></i>Reintentar</button>`;
}

function resetState(){
  loadState().then(()=>{
    renderAll();
    if(!document.getElementById('aviso-carga-datos')) toast('Datos actualizados','success');
  });
}
