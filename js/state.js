let currentRole = null;
let S = {
  skusGlobales: [],
  subSkus: [],
  stock: [],
  bodegas: [],
  ubicaciones: [],
  usuarios: [],
  movimientos: [],
};

async function loadState(){
  if(!localStorage.getItem('nb_token')) return;
  try {
    showLoading(true);
    const [bodegas, globales, stock, movs, ubicaciones] = await Promise.all([
      Bodegas.getAll(),
      SKUs.getGlobales(),
      SKUs.getStock(),
      Movimientos.getAll(),
      Ubicaciones.getAll()
    ]);

    S.bodegas = bodegas.map(b => b.nombre);
    S.bodegasRaw = bodegas; // objetos completos con ubicacion_id
    S.ubicaciones = ubicaciones;
    S.skusGlobales = globales;
    S.stock = stock;
    S.movimientos = movs;

    // Construir subSkus desde stock
    // Incluye filas con cantidad 0 y sub-SKUs sin stock registrado (LEFT JOIN)
    const subMap = {};
    stock.forEach(row => {
      const sid = row.sub_sku_id;
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
      // Solo agregar la bodega si existe (LEFT JOIN puede traer null)
      if(row.bodega_nombre){
        subMap[sid].stock[row.bodega_nombre] = row.cantidad || 0;
      }
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