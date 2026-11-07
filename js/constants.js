const FAMILIAS = {
  MED:'Medicamento', INS:'Insumo', INP:'Insumo Pediátrico',
  DM:'Dispositivo Médico', EB:'Equipo Biomédico', DOT:'Dotación', ASE:'Aseo'
};

const SUBGRUPOS = {
  MED:['AINES','ANALGÉSICO','ANESTÉSICO','ANESTÉSICO TÓPICO','ANTAGONISTA OPIOIDE',
       'ANTIARRÍTMICO','ANTIBIÓTICO TÓPICO','ANTICOLINÉRGICO','ANTICONVULSIVO',
       'ANTIDIARRÉICO','ANTIESPAMÓDICOS','ANTIHEMETICOS','ANTIHIPERTENSIVO',
       'ANTIHISTAMÍNICO','ANTIPIRÉTICO','BRONCODILATADOR','CARDIOTÓNICOS',
       'CIRCULATORIO','CORTICOIDE','CORTICOIDE TÓPICO','PROTECTOR GÁSTRICO',
       'REPOSICIÓN ELECTROLÍTICA','RESPIRATORIO','SIQUIÁTRICO','SOLUCIÓN OFTÁLMICA'],
  INS:['INSUMO','QUIRÚRGICO'],
  INP:['INSUMO','QUIRÚRGICO'],
  DM:['DISPOSITIVO MÉDICO','DISPOSITIVO MÉDICO PEDIÁTRICO'],
  EB:['EQUIPO BIOMÉDICO'],
  DOT:['DOTACIÓN'],
  ASE:['ASEO']
};

// Foto de perfil por nivel (img/avatares): reemplaza las burbujas con
// iniciales en Usuarios, el personal de los eventos y el menú lateral
const AVATAR_NIVEL = { 1:'medico', 2:'enfermero', 3:'supervisor', 4:'admin' };
function avatarNivel(nivel){ return `img/avatares/${AVATAR_NIVEL[nivel] || 'enfermero'}.svg`; }

const NIVELES = {
  // Médico: sin acceso a la app (solo se asigna a eventos para la historia clínica)
  1:{label:'Médico',cls:'n1',nav:[]},
  2:{label:'Enfermero/a',cls:'n2',nav:['dashboard','inventario','movimientos','trazabilidad']},
  3:{label:'Supervisor',cls:'n3',nav:['dashboard','inventario','movimientos','registro','trazabilidad']},
  4:{label:'Administrador',cls:'n4',nav:['dashboard','inventario','movimientos','registro','sku','usuarios','bodegas','eventos','historias','segstock','reportes','trazabilidad']}
};

const NAV_CONFIG = [
  {id:'dashboard',icon:'ti-layout-dashboard',label:'Dashboard',section:''},
  {id:'inventario',icon:'ti-pill',label:'Inventario',section:''},
  {id:'movimientos',icon:'ti-transfer',label:'Movimientos',section:''},
  {id:'registro',icon:'ti-package-import',label:'Registro de entradas',section:''},
  {id:'sku',icon:'ti-tag',label:'SKUs Globales',section:'ADMINISTRACIÓN'},
  {id:'usuarios',icon:'ti-users',label:'Usuarios',section:''},
  {id:'bodegas',icon:'ti-building-warehouse',label:'Ubicaciones',section:''},
  {id:'eventos',icon:'ti-calendar-event',label:'Eventos',section:''},
  {id:'historias',icon:'ti-clipboard-heart',label:'Historias clínicas',section:''},
  {id:'reportes',icon:'ti-report-analytics',label:'Reportes',section:''},
  {id:'trazabilidad',icon:'ti-timeline',label:'Trazabilidad',section:''},
  {id:'segstock',icon:'ti-shield-check',label:'Stock de Seguridad',section:''},
];
