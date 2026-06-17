let currentRole = null;
let S = {
  skusGlobales: [],
  subSkus: [],
  stock: [],
  bodegas: [],
  usuarios: [],
  movimientos: [],
};

async function loadState(){
  if(!localStorage.getItem('nb_token')) return;
  try {
    showLoading(true);
    const [bodegas, globales, stock, movs] = await Promise.all([
      Bodegas.getAll(),
      SKUs.getGlobales(),
      SKUs.getStock(),
      Movimientos.getAll()
    ]);

    S.bodegas = bodegas.map(b => b.nombre);
    S.skusGlobales = globales;
    S.stock = stock;
    S.movimientos = movs;

    // Construir subSkus desde stock
    // Incluye filas con cantidad 0 para no perder sub-SKUs agotados
    const subMap = {};
    stock.forEach(row => {
      if(!subMap[row.sub_sku_id]){
        subMap[row.sub_sku_id] = {
          id: row.sub_sku_id,
          skuGlobalId: row.sku_global_id,
          subSku: row.sub_sku,
          nombre: row.nombre,
          proveedor: row.proveedor,
          lote: row.lote,
          invima: row.invima,
          caducidad: row.caducidad,
          unidad: row.unidad,
          agotado: false,
          stock: {}
        };
      }
      subMap[row.sub_sku_id].stock[row.bodega_nombre] = row.cantidad;
    });

    // Marcar agotado si el stock total es 0 en todas las ubicaciones
    S.subSkus = Object.values(subMap).map(s => ({
      ...s,
      agotado: Object.values(s.stock).reduce((a, v) => a + v, 0) === 0
    }));

    if(currentRole === 4){
      S.usuarios = await Usuarios.getAll();
    }

  } catch(err){
    console.error('Error cargando datos:', err);
    toast('Error cargando datos del servidor', 'error');
  } finally {
    showLoading(false);
  }
}

function resetState(){
  loadState().then(()=>{ renderAll(); toast('Datos actualizados','success'); });
}