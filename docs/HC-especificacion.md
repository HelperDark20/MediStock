# Historia clínica prehospitalaria en el panel de enfermero — especificación acordada

Fuente: formato SIG_08NB_0030, documento HC_InterOperable (comentarios de Jorge Cardona) y decisiones del usuario (2026-11-06).
Todo se desarrolla y prueba primero en este laboratorio. **Restricciones permanentes:**
- Panel de enfermero en **ES5**: iPad mini 2 (iOS 12) y la iPad más vieja (iOS 9.3.5).
- **Funciona sin conexión.**
- **Sin evento asignado, el enfermero no puede continuar** (se mantiene).

## Flujo del enfermero
Login → verificación de evento → lista de **HC en curso** + **Nueva HC** → módulos 1–7 con barra de avance.
- Autoguardado local campo a campo (borrador en localStorage).
- Cada módulo valida sus campos obligatorios antes de avanzar. Se puede volver atrás hasta enviar.
- Al enviar, la HC se sincroniza; el servidor asigna el consecutivo. Tras confirmar la sincronización, la tablet borra la copia local.

## Módulo 1 · Datos administrativos (automático)
| Campo | Regla |
|---|---|
| Consecutivo | Lo asigna el **servidor al sincronizar**, en orden de llegada. Formato **`HC-AAAA-NNNN`** (año de la atención + contador de 4 dígitos que **empieza en 0000** y reinicia cada año: HC-2026-0000, HC-2026-0001…; pasa a 5 dígitos si supera 9999). Mientras no se sincronice: "Pendiente de número" + id interno (uuid) |
| Fecha / hora inicio | Del dispositivo al pulsar Nueva HC. También se guarda la hora de recepción en el servidor |
| Lugar de atención | Ubicación del evento (temporal o permanente) |
| Municipio | De la ubicación. Nuevo campo en Ubicaciones: **lista DIVIPOLA del DANE (1.122 municipios) con buscador**, sin texto libre |

## Módulo 2 · Identificación del paciente
- **Nombres** y **Apellidos** en campos separados, obligatorios, en MAYÚSCULAS automáticas.
- **Tipo de documento** (una opción): CC, TI, CE, PAS, RC, PPT, Otro.
  - PAS y Otro aceptan letras y números.
  - Los demás, incluido PPT, solo números.
- **Fecha de nacimiento**: selector nativo, se muestra como DD/MM/AAAA.
- **Edad**: automática a la fecha de atención (meses y días en menores de 1 año).
- **Selección única**:
  - Sexo: Masculino / Femenino / Otro.
  - RH: + / −. En la vista admin y el PDF se muestra POSITIVO / NEGATIVO.
  - Grupo: A / B / AB / O.
  - Estado civil: Soltero / Casado / Divorciado / Viudo / Unión libre.
- **Campos de texto**:
  - Dirección (alfanumérico).
  - Ciudad.
  - Teléfono (solo números).
  - Ocupación, EPS, ARL. EPS o ARL vacías se registran "NO APLICA".
  - **Sin Barrio.**
- **Otra aseguradora**: interruptor SÍ/NO; en SÍ, campo de texto.
- **Acompañante**: interruptor SÍ/NO; en SÍ, nombre completo, parentesco y teléfono.
- **Con internet**: al escribir el documento, ofrecer precargar los datos y antecedentes de HC anteriores del mismo paciente.

## Módulo 3 · Motivo, antecedentes y consentimiento
- **Motivo de consulta / relato**: un campo de texto grande.
- **Antecedentes**, con interruptor global:
  - NO: todo queda "NO REFIERE INFORMACIÓN".
  - SÍ: se muestran los campos (patológicos, quirúrgicos, farmacológicos, alérgicos, tóxicos, traumáticos, hospitalarios, otros). Los vacíos quedan "NO REFIERE INFORMACIÓN".
- **Gestación**:
  - Oculta si el sexo es Masculino (queda "No aplica").
  - Con Femenino u Otro: interruptor SÍ/NO; en SÍ, semanas (numérico).
- **Consentimiento**:
  - Texto literal, grande y guardado con la HC: «Declaro que recibí información clara sobre mi condición de salud, procedimiento realizado, necesidad de traslado y posibles riesgos derivados de aceptar o rechazar la atención brindada.»
  - **Acepto**: pasa al módulo 4.
  - **Rechazo**: motivo, firma del paciente o acudiente (panel blanco a pantalla completa) y testigo (nombre, apellido, cédula, teléfono). La HC salta al cierre (responsables y firmas) con disposición "Rechazo de atención".
  - **Urgencia vital: sin capacidad de consentir**: opción para el paciente inconsciente o el menor sin acudiente. Permite continuar.

## Módulo 4 · ABCDE, signos vitales y Glasgow
- **A. Vía aérea**: Adecuada / Permeable / Obstruida / Instrumentada.
- **B. Respiración**: Adecuada / Dificultad respiratoria / Ausente.
- **C. Circulación**: Adecuada / Comprometida.
- **Observaciones en A, B y C**: solo si no es "Adecuada".
- **D. Estado neurológico**: Alerta / Somnoliento / Confuso / Inconsciente (una opción). Orientado en persona, tiempo y espacio (varias opciones).
- **E. Exposición**: interruptor de hallazgos. En NO queda "NO REFIERE INFORMACIÓN"; en SÍ, campo de texto.
- **Signos vitales**:
  - Hora HH:MM de la toma: se llena sola con la hora en que se entra al módulo 4 y se puede corregir.
  - TA sistólica / diastólica.
  - FC, FR, SpO₂, temperatura (con decimal), glucometría, EVA 0–10.
  - Fuera de rango clínico: en rojo, sin bloquear. Valores imposibles: se bloquean.
- **Glasgow**: ocular 4–1, verbal 5–1, motora 6–1 (las opciones no muestran el número; solo se muestra el puntaje total). Total automático /15. Aviso de incoherencia (p. ej. Inconsciente con 15).

## Módulo 5 · Examen físico, triage y procedimientos
- **Examen cefalocaudal**: 11 segmentos (cabeza, cara, cuello, tórax, campos pulmonares, abdomen, pelvis, espalda, EESS, EEII, osteomuscular). Cada fila muestra "ESTADO ADECUADO"; al tocarla se escribe el hallazgo. Las no diligenciadas quedan "ESTADO ADECUADO". Sin piel ni órganos de los sentidos.
- **Triage**: **manual**, con botones I–V. Sin sugerencia automática ni IA.
- **Procedimientos**:
  - Botón "+ Agregar procedimiento".
  - Cada fila: hora HH:MM, procedimiento en **texto libre** (el enfermero escribe con exactitud lo que hizo) y responsable (médico del evento).

## Módulo 6 · Suministro de medicamentos e insumos
- Mismo flujo del panel actual: depósito → buscar → cantidad. **Sin pedir cédula**: sale del módulo 2.
- Para medicamentos se agregan **dosis** y **vía** (VO, IV, IM, SC, SL, tópica, inhalada, otra). Los insumos solo llevan cantidad.
- Botones "Registrar otro consumo" y "Continuar HC". Se muestra la lista de lo registrado en esta HC.
- El stock se descuenta al registrar, como hoy, y cada consumo queda vinculado a la HC (uuid). Sin conexión va a la cola actual (idempotente con client_id).
- Quitar un consumo antes de enviar la HC genera una reversión.
- **Implementación (Fase 4):**
  - Medicamento = familia del SKU "MED" o que empiece por "MEDICAMENT" o "FARMAC"/"FÁRMAC", sin importar mayúsculas (la familia es texto libre: "Medicamento", "MEDICAMENTOS"…). Dosis, vía y hora obligatorias. Cualquier otra familia = insumo (solo cantidad).
  - Cada consumo guarda `hc_client_id`. El documento del paciente sale del módulo 2: acepta pasaporte con letras o vacío si es NN. Al enviarse la HC, los consumos quedan con el documento definitivo.
  - La lista de medicamentos de la HC la arma el servidor con lo que realmente salió del inventario. De la tablet solo toma dosis, vía y hora.
  - No se acepta la HC si tiene consumos que no están en el inventario (pendientes o rechazados).
  - Quitar un consumo ya sincronizado requiere conexión (`POST /api/movimientos/anular-consumo`, solo los propios y solo si la HC no se ha enviado). Si no está sincronizado, se borra de la tablet.
  - Una HC enviada no admite más consumos.
  - Sincronizar sube primero los consumos y después las HC.
  - No se puede cambiar el consentimiento a "rechazo" si la HC ya tiene consumos.

## Módulo 7 · Evolución, cierre y responsables
- **Evolución y descripción del servicio**: texto.
- **Condición final**: Estable / Mejorado / Sin cambios / Deteriorado / Fallecido.
- **Destino**: Alta en sitio / Entrega a familiar o acudiente / Traslado asistencial / Remisión a IPS / Rechazo de traslado / Fallecido en el sitio.
- **Datos del traslado**: solo con **Traslado asistencial**.
  - Origen: la ubicación del evento.
  - Destino: texto.
  - Ambulancia: TAB / TAM / APH / Neonatal.
  - Móvil, placa, conductor y teléfono: **manuales, sin precarga**.
- **Responsables** (datos automáticos, solo la firma es manual):
  - Médico del evento: nombre, cédula / registro profesional (el mismo número), firma.
  - Enfermero que diligencia: nombre, cédula, firma.
  - Se usa el **nombre completo** del usuario tal como está registrado, sin campo de apellidos aparte ni cargo.
- **Envío**:
  - Sin traslado: queda **Cerrada**.
  - Con traslado: queda **Abierta: pendiente de entrega**.

## Panel de administración
- **Ubicaciones**: campo Municipio (lista DIVIPOLA con buscador).
- **Usuarios**:
  - Se quita la fecha de nacimiento del formulario. La columna se conserva en la base y deja de pedirse.
  - **Nivel 1 = Médico**, antes "Auditor":
    - Sin contraseña y sin acceso a la app; los auditores actuales pierden el acceso.
    - Sin campo de registro profesional: al elegir Nivel 1 el campo cédula se llama "Cédula / Registro profesional" (normalmente son el mismo número).
- **Eventos**: "AGREGAR PERSONAL" (enfermeros y médicos). Normalmente un médico por evento. Los médicos no reciben depósitos.
- **Nuevo módulo "Historias clínicas"**:
  - Filtros por rango de fechas, ubicación, evento y documento del paciente.
  - Estados: Abierta (traslado pendiente de entrega) y Cerrada.
  - **Entrega del paciente**, solo admin: fecha, hora, institución, servicio receptor (Urgencias / Otro), nombre y cargo de quien recibe, y **foto o PDF del recibido de la IPS** en lugar de la firma.
  - **Edición completa** para administradores, con **rastro de cambios**: quién, cuándo, valor anterior y nuevo.
  - Descarga en PDF con la estructura del formato SIG_08NB_0030.

## Decisiones confirmadas (2026-11-06)
- **Triage**: manual con botones I–V.
- **Paciente sin identificar**: se permite HC con nombres "NN" y sin documento; el admin la completa después.
- **Urgencia vital**: opción "Sin capacidad de consentir" que permite continuar.
- **Consentimiento**:
  - Rechazo: pasa al cierre (responsables y firmas) con destino "Rechazo de atención".
  - Aceptación: solo se marca, sin firma.
- **Medicamentos**: con dosis y vía (no aplica a insumos).
- **Datos del traslado**: solo con "Traslado asistencial" (no con "Remisión a IPS").
- **Signos vitales**: solo la toma inicial.
- **Médico**: normalmente uno por evento.
- **Usuarios**: solo nombre completo, sin apellidos aparte ni cargo.
- **Auditores (nivel 1)**: pierden el acceso.
- **Admin**: rastro de cambios aceptado.
- **Entrega**: nombre y cargo de quien recibe + foto o PDF del recibido de la IPS.
- **Barrio**: no se usa.
- **Registro de consumos**: ya no existe por fuera de la HC. El panel muestra solo "Historias clínicas"; los consumos se registran en el módulo 6.
- **Campos obligatorios del paciente** (si no es NN): nombres, apellidos, tipo y número de documento, fecha de nacimiento y sexo. RH, grupo, dirección, EPS, etc. son opcionales.
- **Consecutivo**: se asigna al enviar (una HC descartada no deja huecos). La HC vive solo en la tablet hasta enviarse.

## Ajustes después de las pruebas en tablet (2026-11-06)
- Todos los cuadros de texto quedan en MAYÚSCULAS (tablet al escribir; el servidor también lo aplica, incluidas las ediciones del admin).
- EPS / ARL vacías → "NO APLICA".
- Hora de la toma de signos automática al entrar al módulo 4.
- Glasgow sin números en las opciones; solo el puntaje total.
- RH como POSITIVO / NEGATIVO en la vista admin y el PDF.
- Familia del SKU en texto libre reconocida como medicamento (antes solo "MED": "ACIDO ACETILSALICILICO 500 MG TAB" con familia "Medicamento" salía como insumo).
- La barra de estado (en línea / offline) cuenta historias clínicas pendientes por sincronizar, no consumos: los consumos son parte de su HC.

## Decisiones de la Fase 3 (propuestas, pendientes de revisión del usuario)
- **Signos vitales obligatorios**: hora, TA, FC, FR, SpO₂ y temperatura. Glucometría y EVA son opcionales.
- **Valores imposibles** (se bloquean): TA sistólica 40–300 y diastólica 20–200 (diastólica menor que sistólica), FC 20–300, FR 4–80, SpO₂ 30–100, T° 25–45, glucometría 10–1000, EVA 0–10.
- **Fuera de rango** (en rojo, sin bloquear; solo en mayores de 14 años): TA sistólica 90–139, diastólica 60–89, FC 60–100, FR 12–20, SpO₂ 94–100, T° 36–37,9, glucometría 70–180, EVA 0–6.
- **Glasgow**: aviso (sin bloquear) si "Inconsciente" con 13 o más, o "Alerta" con 8 o menos.
- **Responsable de un procedimiento**: el médico del evento (por defecto si es uno) o el enfermero que diligencia.
- **Procedimientos**: texto libre, sin catálogo (decisión del usuario, 2026-11-06).
- **"Fuera de rango" y aviso de Glasgow**: solo avisos visuales; no bloquean ni cambian lo digitado (aclarado al usuario).

## Implementación del módulo 7 (Fase 5)
- Evolución, condición final y destino obligatorios. Con rechazo de la atención, el destino queda fijo en "Rechazo de atención".
- Traslado asistencial: origen automático (lugar y municipio del evento). Destino, ambulancia, móvil, placa, conductor y teléfono obligatorios. La HC queda **abierta** hasta que el admin registre la entrega. Los demás destinos la dejan **cerrada**.
- Aviso (no bloquea) si el destino es "Fallecido en el sitio" y la condición no es "Fallecido".
- Responsables:
  - El médico del evento viene elegido si es uno solo; si hay varios, se elige. Se muestran nombre y cédula / registro profesional.
  - La firma del médico es opcional: si falta, queda `medico_firma_pendiente` y se completa en el admin (Fase 6).
  - La firma de quien diligencia (nombre y cédula automáticos) es obligatoria.
  - Evento sin médico: la atención queda bajo la responsabilidad de quien diligencia (`responsable_principal: 'enfermero'`).
- **Títulos de sección sin numeración** (pedido del usuario).
- **Dosis sugerida**: se toma de la concentración en el nombre del medicamento (500 MG, 1 G, 100 MCG, 10 ML, UI, MEQ; los % se ignoran) × la cantidad. Se puede editar; deja de recalcularse si el enfermero la cambia a mano.

## Fases
0. Panel admin copiado al laboratorio. Migraciones base: municipios, médico y tablas de HC. ✔
1. Admin: municipio en ubicaciones, usuarios (médico, sin fecha de nacimiento), "Agregar personal" en eventos. ✔
2. Enfermero, módulos 1–3: borrador offline, sincronización, consecutivo, firma táctil. ✔
3. Módulos 4–5. ✔
4. Módulo 6: consumos vinculados a la HC. ✔
5. Módulo 7 y envío. ✔
6. Admin: Historias clínicas (filtros, entrega, edición con rastro, PDF). ✔

## Implementación del módulo admin (Fase 6)
- **Acceso**: solo Nivel 4 (menú "Historias clínicas").
- **Listado**: filtros por fechas de atención, ubicación, evento, estado (abiertas, cerradas, firma médica pendiente) y búsqueda por documento, nombre o número de HC. 50 por página.
- **Detalle**: todas las secciones del formato, adjuntos e historial de cambios.
- **Entrega del paciente** (solo HC con traslado): fecha, hora, institución, servicio receptor (Urgencias u Otro), nombre y cargo de quien recibe, y, opcionalmente, foto JPG/PNG o PDF del recibido de la IPS (máx. 5 MB). Al registrarla, la HC se cierra.
- **Firma médica pendiente**: el médico puede firmar después en el panel (mouse o pantalla táctil). Es opcional: sin ella la HC sigue siendo válida.
- **Edición**:
  - Se puede corregir todo lo diligenciado.
  - No se pueden cambiar el servicio, quien diligencia, la decisión del consentimiento, el médico, las firmas, ni el producto y la cantidad de los consumos (esos se corrigen en el inventario).
  - Se vuelve a validar con las mismas reglas de la tablet y exige el motivo de la corrección.
  - El rastro (tabla `hc_cambios`) guarda quién, cuándo, el motivo y cada campo con su valor antes y después.
  - Si se corrige el documento del paciente, sus consumos se actualizan.
  - Si se cambia el destino, la HC se abre o se cierra según corresponda.
- **Imprimir / PDF**: versión con la estructura del SIG_08NB_0030, que se guarda como PDF desde el diálogo de impresión del navegador.
- **Adjuntos**: se guardan en la base de datos (tabla `hc_adjuntos`, BYTEA) y se verifica que el contenido coincida con el tipo de archivo.
