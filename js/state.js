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

async function loadState(){
  if(!localStorage.getItem('nb_token')) return;
  try {
    showLoading(true);
    const [bodegas, globales, stock, movs, ubicaciones, eventos] = await Promise.all([
      Bodegas.getAll(),
      SKUs.getGlobales(),
      SKUs.getStock(),
      Movimientos.getAll(),
      Ubicaciones.getAll(),
      Eventos.getAll()
    ]);

    S.bodegas = bodegas.map(b => b.nombre);
    S.bodegasRaw = bodegas;
    S.ubicaciones = ubicaciones;
    S.skusGlobales = globales;
    S.stock = stock;
    S.movimientos = movs;
    S.eventos = eventos;

    // Construir subSkus desde stock
    const subMap = {};
    stock.forEach(row => {
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

    if(currentRole === 4){
      S.usuarios = await Usuarios.getAll();
      S.stockSeguridad = await StockSeguridad.getAll();
      S.ubicacionesHistoricas = await Ubicaciones.getHistoricas();
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
