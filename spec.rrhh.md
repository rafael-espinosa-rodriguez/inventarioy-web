Creé esta misma app pero usando sqlite en local y no supabase,ademas de otras tecnologias y en dicah app mejoré el modulo de "RRHH" ,te enviaré toda la info al respecto para que crees el plan de implementacion correspondiente para hacer dicha actualizacion en el modulo de "RRHH" y me hagas las preguntas que necesites para implementar dichas actualizaciones correctamente,de todo lo que te enviaré adaptalo en caso de que no esté ya implementado a esta app con las tecnologias que ya usa,solamente quiero que se integren las funcionalidades y secciones nuevas en caso de tener dicho modulo de "RRHH" primero te envio las historias tecnicas:Módulo: RRHH (Recursos Humanos) — menú principal RRHH (ruta /dashboard/hr). Restricción de acceso: módulo marcado como offlineLimited y requiere rol con permiso hr en MODULE_ROLES (owner, economist, admin, supervisor). El banner OfflineLimitBanner se muestra en la cabecera si la app detecta que el negocio está en modo offline limitado. 
8 pestañas: Personal, Departamentos, Nómina, Deducciones, Imp. Empresa, Liquidaciones, Configuración, Biblioteca. Persistencia de estado: la pestaña activa, búsqueda y páginas se guardan (localStorage persistente por sesión). 
Modelo de datos (tablas + campos): 
employees 
id, user_id, name, role, salary(REAL), phone, email, nit_id, category(→departments.id), 
photo_url, hire_date, created_at 
+ person_type('employee'|'partner'), base_contribution(REAL) 
+ contract_type('indefinite'|'fixed'|'probation'), contract_end_date 
+ expediente(INTEGER, autoincremental por negocio, único por user+expediente) 
+ vacation_balance(REAL) 
departments 
id, user_id, name, created_at 
employee_loans (deducciones/retenciones) 
id, user_id, employee_id, total_amount, monthly_payment, balance, start_date, 
status('active'|'paid'), deduction_type('prestamo'|'credito_bancario'|'inasistencia'|'sancion'|'rotura_equipo'|'otro'), 
reason, created_at, updated_at 
payroll_config 
id, user_id, tax_exemption_base, tax_rate, special_contribution_rate, 
last_calculated_month, monthly_hours(DEF 190.6), vacation_accrual_days(DEF 2.5), 
created_at, updated_at 
payroll_periods 
id, user_id, month, year, status('draft'|'applied'), applied_at, applied_by, created_at, updated_at 
UNIQUE(user_id, month, year) 
payroll_drafts (captación pre-nómina) 
id, user_id, month, year, employee_id, include(0/1), worked_hours, hourly_rate, 
bonus, advances, retention, vacation_days, note, created_at, updated_at 
UNIQUE(user_id, month, year, employee_id) 
payroll_entries 
id, user_id, employee_id, employee_name, employee_category, month, year, 
base_salary, earned_salary, exemption_base, taxable_base, tax_amount, 
special_contribution, net_salary, vacation_days, vacation_base, 
employer_contribution, is_custom(0/1), created_at, updated_at 
+ overtime_hours, overtime_type('diurna'|'nocturna'|'descanso'|'feriado'), 
overtime_pay, bonus, vacation_pay, advances, loan_deduction, 
other_deductions, gross_salary, worked_hours, hourly_rate, days_paid 
payroll_liquidations 
id, user_id, employee_id, employee_name, base_salary, hire_date, end_date, 
months_worked, vacation_accumulated, vacation_taken, vacation_pending, 
vacation_pay, severance_months, severance_pay, notice_days, notice_pay, 
gross_total, cess, iip, net_total, created_at 
employee_vacation_movements 
id, user_id, employee_id, month, year, type('accrual'|'paid'), days(+/-), note, created_at 
hr_documents (biblioteca) 
id, user_id, name, doc_type('MANUAL'|'REGLAMENTO'|'PNO'), file_url, file_name, file_size, created_at 
employee_documents (documentos por empleado) 
id, user_id, employee_id, name, doc_type('CONTRATO'|'IDENTIFICACION'|'OTRO'), 
file_url, file_name, file_size, created_at 
HISTORIAS TÉCNICAS 
HT-01 · Alta de empleado/socio 
Como dueño/supervisor con permiso hr, quiero registrar un trabajador, para gestionar nómina y documentación. 
Criterios: 
Formulario "Nuevo Empleado" con campos: N° Expediente (autogenerado #N, no editable; = máximo expediente existente + 1), Nombre Completo*, Puesto/Rol*, Tipo de Persona* (Empleado | Socio), Salario ("Salario Básico" para empleado / "Retiro Mensual" para socio), Teléfono (solo dígitos, máx 10), Correo, NIT/Carnet (solo dígitos, máx 11), Departamento* (select de departments), Fecha de Contratación, Tipo de Contrato* (empleados: indeterminado/ determinado/ prueba), Fecha fin contrato (solo si fixed, requerido), Foto (JPG/PNG/WebP, aviso si >500KB; sube a storage hr-documents). 
Validación de salario: validateNumber requerido, min 1. 
Si person_type='partner': base_contribution requerida, rango $2,000–$9,500 (DL 92/2024), con mensaje de error explícito. Se ocultan tipo de contrato y fecha fin. El campo salario se etiqueta "Retiro Mensual". 
Al registrar: insert en employees, subir foto si existe a storage, toast éxito "Empleado agregado exitosamente". 
expediente se asigna con subconsulta de conteo por orden de created_at/id y es único por negocio. 
HT-02 · Directorio de personal 
Como usuario con permiso hr, quiero listar y buscar trabajadores, para consultar su información. 
Criterios: 
Buscador por nombre o #expediente (case-insensitive). Botón "Limpiar". 
Cada tarjeta muestra: foto (o inicial en círculo), #expediente, nombre, badges de tipo (Empleado azul / Socio ámbar) y de contrato (Determinado celeste / Prueba ámbar), puesto, salario $X/mes, teléfono, email. 
Acciones por fila: 📎 expandir documentos del empleado, 🗑 eliminar (confirmación: "Se perderán sus documentos y registros asociados"). 
Paginación (PaginationControls) + contador total. 
Eliminar empleado: deleteEmployee(employeeId) con confirmación modal. 
HT-03 · Documentos por empleado 
Como usuario con permiso hr, quiero subir/ver/descargar/eliminar documentos de un empleado, para archivar contratos e identificaciones. 
Criterios: 
Panel desplegable al expandir un empleado: "Documentos de {nombre}" con contador. 
Botón "Subir documento" (deshabilitado si offline con indicador (offline)). 
Formulario de subida: Tipo* (Contrato | Identificación | Otro), Nombre (opcional, ej. "Contrato 2024"), archivo (drop/click; acepta .pdf,.jpg,.jpeg,.png,.doc,.docx). Preview con nombre y tamaño formateado (B/KB/MB). 
Al subir: sube a storage hr-documents bajo ruta {user_id}/employees/{employeeId}/{timestamp}_{nombre}; guarda registro en employee_documents; si falla la BD elimina el archivo subido (rollback). Toast éxito/error. 
Lista de docs: icono por tipo, nombre, badge de tipo (Contrato/Identificación/Otro), tamaño, fecha (toLocaleDateString es-ES), acciones Ver (nueva pestaña), Descargar, Eliminar (ConfirmDialog, visible en hover, deshabilitado offline). 
Eliminar: borra registro BD y luego archivo del storage (fileUrl.split('/hr-documents/')[1]). 
HT-04 · CRUD de departamentos 
Como usuario con permiso hr, quiero crear, renombrar y eliminar departamentos, para organizar al personal. 
Criterios: 
Formulario "Nuevo Departamento" + botón Crear. Validación: nombre no vacío y no duplicado (case-insensitive) → toast "Ya existe un departamento con ese nombre". 
Lista: avatar con inicial, nombre, contador {n} empleado(s). 
Acciones: ✏ editar (input inline + guardar/cancelar), 🗑 eliminar. 
Regla de negocio: no se puede eliminar un departamento con empleados → toast Hay {n} empleados en este departamento. 
Paginación. 
HT-05 · Captación pre-nómina 
Como usuario con permiso hr, quiero definir qué trabajadores se incluyen en la nómina de un mes y sus incidencias, para generar la nómina correctamente. 
Criterios: 
Selector Mes/Año (meses Enero–Diciembre, años 2024–2090). Al cambiar, carga payroll_drafts y payroll_periods del período. 
Tabla editable con columnas: ✓ (incluir, checkbox), Empleado (#exp + nombre), Departamento, Horas trab., Tasa $/h, A cobrar (calculado = tasa × horas, solo lectura), BON $, Anticipo $, RET $, Vac. días, Nota. 
Valores por defecto por empleado: include=true, worked_hours = monthly_hours (190.6), hourly_rate = round(salary / monthly_hours, 2). 
Si ya existen borradores del mes, se cargan (fusionando con defaults para campos en 0). 
Filtro por departamento (select "Todos los departamentos"). 
Acciones en lote (aplican solo a los incluidos del filtro actual): campo Bonificación $ + botón "Bonificar", campo Retención $ + botón "Retener". Valida monto > 0. 
Botón Guardar Captación: persiste todas las filas vía upsert (conflicto user_id,month,year,employee_id). Toast éxito/error. Deshabilitado si período Aplicado. 
Validación en blur de horas: si worked_hours > monthly_hours, toast warning "Las horas (X) superan el fondo de tiempo (Y h). Se pagará tasa × horas trabajadas." 
Todos los inputs deshabilitados si payrollApplied. 
HT-06 · Generar Nómina 
Como usuario con permiso hr, quiero generar la nómina mensual en Borrador, para calcular IIP, CESS y salarios. 
Criterios: 
Botón Generar Nómina: primero auto-guarda la captación (usa siempre lo que se ve en pantalla), luego calculatePayroll(month, year). 
Bloqueado si el período está Aplicado (error explícito). Con spinner "Calculando..." y toast. 
Proceso de cálculo (transacción atómica): 
Filtra solo trabajadores incluidos en captación (si no hay captación previa, siembra borradores por defecto). 
Por empleado: hourly_rate = draft.hourly_rate ?? round(salary/190.6,2); earned_salary = round(hourly_rate × worked_hours,2); days_paid = round(worked_hours/8,2); exemption_base = config.tax_exemption_base. 
loan_deduction = cuota mensual del préstamo activo del empleado (si tiene). 
Llama calcularNomina(earned_salary, {...}) con personType, baseContribution (socio), exemptionBase, bonus=draft.bonus, vacationDays=draft.vacation_days, advances=draft.advances, otherDeductions=draft.retention, loanDeduction. 
Deducciones de préstamos: SOLO en la primera generación del mes (isFirstGeneration = no había entries previas): resta monthly_payment del balance; si balance<=0 → status='paid'. 
Movimientos de vacaciones: se recalculan en cada generación (delete + reinsert del mes): por cada incluido se inserta {type:'accrual', days:+accrual_days (2.5)} y, si vacation_days>0, {type:'paid', days:-paidDays}. 
Saldo de vacaciones = suma de TODOS los movimientos históricos (excluyendo el mes actual que se recalcula); max(0, round); se actualiza employees.vacation_balance. 
Crea/actualiza payroll_periods en status='draft' (sin pisar uno aplicado). 
Borra y reinserta payroll_entries del mes + actualiza payroll_config.last_calculated_month. 
Log de actividad: logAction('payroll','GENERAR_NOMINA',{month,year,total_employees,total_net}). 
Validaciones: error "No hay personal que generarle nómina" si no hay empleados; "No hay trabajadores seleccionados para la nómina de este mes" si ningún incluido. 
HT-07 · Fórmulas de cálculo de nómina (exactas) 
Como desarrollador, quiero replicar las fórmulas idénticas, para que la web calcule igual. 
Empleado asalariado: 
tarifaHoraria = salarioBase / monthlyHours(190.6) 
overtimePay = round(tarifa × horasExtra × multiplicador, 2) 
diurna×2.0 · nocturna×2.5 · descanso×2.0 · feriado×3.0 
vacationPay = round((salarioBase/30) × vacDias, 2) 
grossSalary = round(salarioBase + overtimePay + bonus + vacationPay, 2) 
vacationBase = round(grossSalary × 1.0909, 2) // provisión 9.09% 
CESS = round(min(gross,15000)×0.05 + max(0,gross−15000)×0.10, 2) 
IIP = escala progresiva Res. 41/2023 sobre grossSalary, con primer tramo exento configurable: 
[0–exempt]=0% · [exempt–9510]=3% · [9510–15000]=5% · [15000–20000]=7.5% 
· [20000–25000]=10% · [25000–30000]=15% · [30000–∞]=20% (exempt DEF 3260) 
employerContribution = round(vacationBase × 0.14, 2) 
totalDeductions = CESS + IIP + advances + loanDeduction + otherDeductions 
netSalary = round(grossSalary − totalDeductions, 2) 
Socio (DL 92/2024): 
base = clamp(baseContribution, 2000, 9500) 
specialContribution = round(base × 0.20, 2) 
grossSalary = round(retiro + bonus, 2) 
vacationBase = 0 · taxableBase = 0 · taxAmount = 0 · employerContribution = 0 · overtimePay = 0 · vacationPay = 0 
netSalary = round(gross − specialContribution − advances − loan − other, 2) 
Regla: los socios NO generan IIP ni provisión de vacaciones; su base imponible se muestra en 0,00. Debe mostrarse tooltip al respecto. 
HT-08 · Revisión y edición de conceptos (fila de nómina) 
Como usuario con permiso hr, quiero ajustar conceptos de cada trabajador en Borrador, para corregir la nómina antes de aplicar. 
Criterios: 
Botón 🧮 por fila (deshabilitado si Aplicado) abre modal "Conceptos de Nómina" con: Horas Extra, Tipo de Hora Extra (Diurna ×2 / Nocturna ×2.5 / Día de descanso ×2 / Día feriado ×3), Bonificación/Estímulo $, Días de Vacaciones Pagadas (0–30), Anticipo $, Cuota de Préstamo $, Otras Deducciones $. 
Al guardar (updatePayrollEntry): si cambió cualquier concepto (earned_salary, overtime_hours, overtime_type, bonus, vacation_days, advances, loan_deduction, other_deductions) se recalcula todo con calcularNomina (usando los nuevos valores + exención/config actuales + tipo de persona + cuota de préstamo activa del empleado). Marca is_custom=true. 
Regla: Salario Devengado y días de vacaciones NO son editables en la tabla (se ajustan desde Captación o conceptos). 
Bloqueado si período Aplicado (error explícito). 
Texto guía: "El bruto = salario + horas extra + bonificación + pago de vacaciones… El neto = bruto − IIP − CESS − anticipo − cuota de préstamo − otras deducciones." 
Si is_custom=true y no aplicado, aparece botón 🔄 "Regenerar valores por defecto" (regeneratePayrollEntry): recalcula desde 0 (horas de captación, sin bonos/anticipos/etc.) y is_custom=false. 
HT-09 · Tabla de nómina y totales 
Como usuario con permiso hr, quiero ver la nómina agrupada por departamento con totales, para revisar y pagar. 
Criterios: 
Entradas agrupadas por employee_category, cada grupo con encabezado de departamento y subtotal de net_salary. 
Columnas: Código (#exp), Empleado (con badge Socio), NIT/Carnet, Tasa $/h, Horas/Días (X.X h + Y días), BON (verde +$X), H. Extra, Bruto (con detalle +$X vac si hay pago de vacaciones), Base Imponible (0,00 para socios), IIP (rojo), CESS/Contrib., RET (rojo -$X; = anticipo+cuota+otras; "0,00" si nada), Salario Devengado (a Cobrar) verde, Vac. Acum., Acciones (🖨 recibo, 🧮 conceptos, 🔄 regenerar). 
Vac. Acum. > 210 días → texto ámbar con ⚠ y tooltip. 
Paginación (20/página). 
Totales del período (panel): Total IIP, Total CESS, Total Provisión de Vacaciones (= sum max(0, vacation_base − earned_salary)); condicionales: Total Horas Extra (si alguna >0), Total Bonificaciones, Total Anticipos, Total RET; separador; Total Salario Devengado (a Pagar) destacado. 
HT-10 · Aplicar / Reabrir nómina 
Como dueño (rol owner), quiero certificar la nómina o reabrirla, para bloquear/editar el período. 
Criterios: 
Aplicar Nómina: ConfirmDialog "¿Certificar y aplicar la nómina de {Mes} {Año}? Una vez aplicada quedará bloqueada…". Setea payroll_periods.status='applied', applied_at, applied_by (nombre del usuario). Log APLICAR_NOMINA. Toast "Nómina aplicada y bloqueada". 
Reabrir (solo owner, botón visible en banner de período aplicado): ConfirmDialog "Volverá a estado Borrador… La acción quedará registrada". Setea status='draft', applied_at=null, applied_by=null. Log REABRIR_NOMINA con by:'owner'. Toast. 
Banner de período aplicado: fondo ámbar "Nómina aplicada (bloqueada)" + fecha/por quién + texto "No se puede modificar; las correcciones se realizan reabriendo (solo Dueño/a)". 
Todas las operaciones (captación, generar, conceptos) quedan bloqueadas mientras status='applied'. 
HT-11 · Recibo de pago (imprimible) 
Como usuario con permiso hr, quiero ver e imprimir el recibo de un trabajador, para entregárselo. 
Criterios: 
Botón 🖨 por fila abre modal "Recibo de Pago" ({empleado} — {Mes} {Año}). 
Cabecera "InventarioY" + datos: Expediente, Empleado, Cargo, NIT/Carnet, Departamento, Horas/Días (X.X h (Y días)), Período. 
Ingresos: Salario del período, Horas extra, Bonificación, Pago de vacaciones, Total bruto (usa gross_salary ?? earned_salary). 
Deducciones: IIP, CESS, Anticipo, Cuota de préstamo, Otras deducciones. 
Salario Devengado (a cobrar) verde. 
Botón Imprimir = window.print(). 
HT-12 · Exportaciones Excel (SC4-06, TA-6, TSS) 
Como usuario con permiso hr, quiero exportar reportes oficiales, para presentar ante ONAT. 
Criterios: 
Exportar Excel (nómina): botón 📊 → CSV con separador ; y decimales con coma. Columnas: Código, Empleado, Cargo/Ocupación, NIT/Carnet, Tasa $/h, Horas Trabajadas, Días a Cobrar, Salario Base, BON, Horas Extra, Pago Horas Extra, Pago de Vacaciones, Bruto, Base de Cotización, Base Exenta, Base Imponible, IIP, CESS, Anticipo, RET (Deducciones) (= loan+other), Salario Devengado (a Cobrar), Vac. Acumuladas. Archivo: Nomina_{Mes}_{Año}. 
Modelo TA-6: columnas NIT/Carnet, Empleado, Salario Devengado, Base Imponible, IIP, CESS. Archivo Modelo_TA6_{mes}_{año}. 
Planilla TSS: columnas NIT/Carnet, Empleado, Salario Devengado, Base de Cotización, CESS (trabajador), SS Empleador (14%), Provisión Vacaciones (= max(0, vacation_base − earned_salary)). Archivo Planilla_TSS_{mes}_{año}. 
Imprimir SC4-06: modal "MODELO SC4-06 NOMINA" con encabezado MIPYMES (nombre del negocio), Fecha, Código (business_code), "INTRAM DE PAGO Nº ____", período 01/MM/AÑO al último_día/MM/AÑO. Tabla por categoría con columnas Código, Nombre y Apellidos, CI, Cat (T=empleado/S=socio), Tarf. Sal, Días A cobrar, Bon., P.A.T (overtime+vacaciones), Deveng., Imp. S., Ret., Pagado, Vac. Acum. + fila "TOTAL POR ÁREA" + TOTAL NÓMINA + firmas "Elaborada por / Revisada por / Aprobada por / Contabilizada por". Imprime con window.print(). Se puede cerrar. 
HT-13 · Deducciones y retenciones (préstamos) 
Como usuario con permiso hr, quiero registrar préstamos, créditos, sanciones e inasistencias, para descontarlos automáticamente de la nómina. 
Criterios: 
Formulario "Nuevo Préstamo": Empleado* (select), Tipo de Deducción* (Préstamo | Crédito bancario | Inasistencia | Sanción | Rotura de equipo | Otro), Criterio/Motivo (texto libre, ej. "crédito bancario BPA"), Monto Total*, Cuota Mensual*, Fecha de Inicio (opcional). 
Validación: monto total > 0; cuota > 0 y ≤ monto total → toasts específicos. 
Insert en employee_loans con balance = total_amount, status='active'. 
Tabla "Deducciones / Retenciones de Personal": Empleado, Tipo (badge), Motivo, Monto Total, Cuota Mensual, Saldo (ámbar si >0 / verde si 0), Estado (Activo con icono ⏱ / Pagado con ✓), acciones: ✓ Registrar pago de cuota y 🗑 eliminar. 
Pago de cuota (payLoanInstallment): newBalance = max(0, balance − monthly_payment); si newBalance<=0 → status='paid'. 
Descuento automático: al generar la nómina, la cuota mensual del préstamo activo se descuenta del neto (columna RET) en cada período mientras esté activo. El balance se reduce solo en la PRIMERA generación del mes. 
Eliminar: modal de confirmación con empleado y monto. 
HT-14 · Impuestos de la empresa (Seguridad Social patronal) 
Como usuario con permiso hr, quiero ver la SS patronal por mes, para conocer el costo empresarial. 
Criterios: 
Selector Mes/Año (independiente, comparte el selector de nómina). 
Si no hay nómina del mes → "No hay nómina generada para este mes. Genera la nómina primero." 
Tabla: Empleado (#exp + nombre), Departamento, Base Cotización (vacation_base, incluye provisión 9.09%), SS Empleador (14%). 
Panel total: Total SS Empleador del mes = sum employer_contribution. 
Tooltip: "Aportación patronal: 14% de la base de cotización". 
HT-15 · Liquidación al cese 
Como usuario con permiso hr, quiero calcular y guardar la liquidación de un trabajador al finalizar su relación laboral, para pagarle lo adeudado. 
Criterios: 
Selector "Seleccionar empleado…" — filtra socios (solo empleados asalariados generan liquidación). 
Campos: Fecha de Cese (defecto hoy), Días de Vacaciones Tomados. 
Botón Calcular Liquidación → calcularLiquidacion({baseSalary, hireDate, endDate, vacationTaken, contractType}). 
Fórmulas exactas: 
days = floor((endDate − hireDate)/86400000) 
monthsWorked = days/30 yearsWorked = days/365 
vacationAccumulated = round(monthsWorked × 2.5, 2) 
vacationPending = max(0, round(vacationAccumulated − vacationTaken)) 
vacationPay = round((baseSalary/30) × vacationPending, 2) 
# Auxilio de despido (SOLO contrato indeterminado): 
severanceMonths = min(yearsWorked, 6) # tope 6 meses 
severancePay = round(severanceMonths × baseSalary, 2) 
# Preaviso (SOLO indeterminado): 
noticeDays = 30 ; noticePay = round((baseSalary/30) × 30, 2) 
grossTotal = round(vacationPay + severancePay + noticePay, 2) 
CESS = round(min(gross,15000)×0.05 + max(0,gross−15000)×0.10, 2) 
IIP = escala Res. 41/2023 completa sobre grossTotal (0–3260=0%, etc.) 
netTotal = round(grossTotal − cess − iip, 2) 
Resultado muestra: Meses trabajados, Vac. acumuladas (días), Vac. pendientes, Pago vacaciones, Auxilio de despido ({n} meses), Preaviso ({n} días), Total bruto, CESS (−), IIP (−), Neto a pagar (verde). 
Guardar Liquidación → insert en payroll_liquidations con todos los campos calculados. Toast "Liquidación guardada". 
Historial: tabla con Empleado, Fecha Cese, Bruto, CESS, IIP, Neto, acción 🗑 eliminar (con confirmación). Orden por created_at DESC. 
HT-16 · Configuración de parámetros de nómina 
Como usuario con permiso hr, quiero ajustar los parámetros de cálculo, para cumplir la normativa vigente. 
Criterios: 
Base Exenta Mensual ($) — DEF 3,260.00 (Res. 41/2023). Guarda en tax_exemption_base. 
Fondo de Tiempo Estimado (horas/mes) — DEF 190.6. Guarda en monthly_hours (fallback 190.6). 
Acumulación de Vacaciones (días/mes) — DEF 2.5. Guarda en vacation_accrual_days (fallback 2.5). 
Auto-guardado onBlur (al hacer clic fuera o Tab) con toast "actualizado" (duración 1500ms). 
Panel informativo con las bases legales: IIP escala Res. 41/2023 (0% exento; 3%–20% por tramo), CESS 5% hasta $15,000 / 10% exceso (Ley 164/2023), SS patronal 14% sobre base de cotización con provisión 9.09%, vacaciones 30 días/año (2.5/mes, Ley 116), socios 20% de la base (DL 92/2024) sin IIP mensual. Nota "Verifique posibles cambios normativos con la MFP/ONAT". 
Ejemplo en fondo de tiempo: "$26,000 ÷ 190.6 h = $136.41/h". 
HT-17 · Biblioteca de documentos organizacionales (PNO / Reglamento) 
Como usuario con permiso hr, quiero gestionar PNO y Reglamento del negocio, para tenerlos disponibles. 
Criterios: 
Dos tarjetas: PNO (Procedimientos Normalizados de Operación) y Reglamento del Negocio. 
Estado: si hay documento → enlace "Ver documento" + botón "Reemplazar documento"; si no → "Subir documento PNO"/"Subir reglamento". 
Modal de subida: tipo fijo (PNO/reglamento), selector de archivo (cualquier tipo), Subir Documento / Cancelar. 
Al subir: storage hr-documents con ruta {docType}-{timestamp}-{nombre}; guarda la URL en localStorage (org_doc_pno / org_doc_reglamento). Toast éxito. 
Biblioteca general (no es pestaña): también existe la gestión de hr_documents con tipos Manual | Reglamento Interno | PNO — el panel de biblioteca agrupa por tipo (reduce en hr_documents por doc_type). 
HT-18 · Guías de ayuda integradas (Help modals) 
Como usuario, quiero consultar guías contextuales, para entender cada sección. 
Criterios: 
Botón ❓ en Nómina, Deducciones, Liquidaciones y Configuración abre modal con pasos numerados (contenido fijo ya definido — copiar texto de HELP_CONTENT en HRView.tsx). 
Incluye: flujo de nómina (período → captación → generación → revisión → aplicación → deducciones/vacaciones → totales → exportación → socios), registro/descuento/estado/pago de deducciones, liquidaciones (selección → datos → cálculo → registro), y configuración (base exenta, autoguardado, incidencia, escala). 
🔒 Reglas transversales (todas las historias) 
Permisos: acceso al módulo requiere rol con permiso hr. Solo owner puede reabrir nómina aplicada. 
Período Aplicado = inmutable: captación, generar, conceptos y edición quedan bloqueados; solo owner puede reabrir (queda registrado en action_logs). 
Acciones con log: GENERAR_NOMINA, APLICAR_NOMINA, REABRIR_NOMINA se registran en action_logs. 
Documentos y fotos: requieren conexión (revisión en web/Supabase: el shim local falla offline con "No hay conexión — los documentos se pueden subir solo cuando hay internet"). 
Redondeo: todas las operaciones round(valor × 100)/100. 
Locales: fechas con toLocaleDateString('es-ES') / toLocaleString('es'). 
Módulo offline limitado: si aplica, mostrar banner OfflineLimitBanner ("Recursos Humanos"). 
Persistencia de UI: tab activa, búsqueda de personal, páginas de departamentos/empleados/nómina se restauran en la sesión. Y ademas ten en cuenta tambien lo siguiente : "MODELO DE DATOS (crear/ajustar estas tablas en Supabase) 
- employees: id, user_id, name, role, salary, phone, email, nit_id, category (→departments.id), 
photo_url, hire_date, person_type('employee'|'partner'), base_contribution, 
contract_type('indefinite'|'fixed'|'probation'), contract_end_date, expediente (INT único por negocio, 
autoincremental: máx existente + 1), vacation_balance (REAL), created_at. 
- departments: id, user_id, name, created_at. 
- employee_loans: id, user_id, employee_id, total_amount, monthly_payment, balance, start_date, 
status('active'|'paid'), deduction_type('prestamo'|'credito_bancario'|'inasistencia'|'sancion'|'rotura_equipo'|'otro'), 
reason, created_at, updated_at. 
- payroll_config: id, user_id, tax_exemption_base (DEF 3260), tax_rate, special_contribution_rate, 
last_calculated_month, monthly_hours (DEF 190.6), vacation_accrual_days (DEF 2.5), created_at, updated_at. 
- payroll_periods: id, user_id, month, year, status('draft'|'applied'), applied_at, applied_by, created_at, 
updated_at. UNIQUE(user_id, month, year). 
- payroll_drafts: id, user_id, month, year, employee_id, include(0/1), worked_hours, hourly_rate, bonus, 
advances, retention, vacation_days, note, created_at, updated_at. UNIQUE(user_id, month, year, employee_id). 
- payroll_entries: id, user_id, employee_id, employee_name, employee_category, month, year, base_salary, 
earned_salary, exemption_base, taxable_base, tax_amount, special_contribution, net_salary, vacation_days, 
vacation_base, employer_contribution, is_custom(0/1), overtime_hours, overtime_type('diurna'|'nocturna'|'descanso'|'feriado'), 
overtime_pay, bonus, vacation_pay, advances, loan_deduction, other_deductions, gross_salary, worked_hours, 
hourly_rate, days_paid, created_at, updated_at. 
- payroll_liquidations: id, user_id, employee_id, employee_name, base_salary, hire_date, end_date, months_worked, 
vacation_accumulated, vacation_taken, vacation_pending, vacation_pay, severance_months, severance_pay, 
notice_days, notice_pay, gross_total, cess, iip, net_total, created_at. 
- employee_vacation_movements: id, user_id, employee_id, month, year, type('accrual'|'paid'), days(+/-), note, created_at. 
- hr_documents: id, user_id, name, doc_type('MANUAL'|'REGLAMENTO'|'PNO'), file_url, file_name, file_size, created_at. 
- employee_documents: id, user_id, employee_id, name, doc_type('CONTRATO'|'IDENTIFICACION'|'OTRO'), file_url, 
file_name, file_size, created_at. 
- Configurar RLS: cada tabla restringida a user_id = auth.uid() (o el mecanismo de multi-tenant que ya uses). 
REGLAS DE NEGOCIO OBLIGATORIAS (no negociables) 
1. Fórmulas de nómina (empleado asalariado): 
- tarifaHoraria = salario / monthly_hours (190.6) 
- salarioDelPeriodo = round(tarifa × horasTrabajadas, 2) 
- horasExtra: diurna ×2, nocturna ×2.5, descanso ×2, feriado ×3 
- gross = salario + horasExtra + bonus + vacacionesPagadas 
- vacationBase = round(gross × 1.0909, 2) 
- CESS = min(gross,15000)×0.05 + max(0,gross−15000)×0.10 
- IIP escala progresiva Res.41/2023 sobre gross: [0–exento]=0%, [exento–9510]=3%, [9510–15000]=5%, 
[15000–20000]=7.5%, [20000–25000]=10%, [25000–30000]=15%, [30000+]=20% (exento configurable, DEF 3260) 
- SS patronal = round(vacationBase × 0.14, 2) 
- neto = gross − CESS − IIP − anticipos − cuotaPréstamo − otrasDeducciones 
2. Fórmulas de socio (DL 92/2024): NO genera IIP ni provisión de vacaciones; contribución = 20% de 
base_contribution (entre 2000 y 9500); taxable_base = 0; employerContribution = 0. 
3. Liquidación: vacaciones acumuladas 2.5 días/mes; pendientes = acumulado − tomadas; pago = (salario/30)×pendientes. 
Auxilio de despido y preaviso (30 días) SOLO para contrato indeterminado; auxilio = min(años,6)×salario. 
CESS e IIP sobre el bruto; neto = bruto − CESS − IIP. 
4. Un período Aplicado (status='applied') es INMUTABLE: captación, generación y edición de conceptos bloqueadas. 
Solo el rol owner puede reabrir (status='draft') y queda registrado en el registro de acciones. 
5. Los préstamos activos descuentan su cuota mensual automáticamente al generar la nómina; el balance se reduce 
SOLO en la primera generación del mes; si balance≤0 → status='paid'. Pago manual de cuota = balance − cuota. 
6. Vacaciones: al generar se recalcula todo el mes (delete+reinsert de movimientos); saldo = suma de todos los 
movimientos históricos; max(0). Si saldo > 210 días mostrar aviso ámbar con ⚠. 
7. Registro de actividad: loguear GENERAR_NOMINA, APLICAR_NOMINA, REABRIR_NOMINA con detalles. 
8. No se puede eliminar un departamento con empleados. El expediente es único por negocio y se asigna 
automáticamente (no editable). 
ENTREGABLES 
1. Esquema de BD (migración SQL) para las tablas anteriores. 
2. Lógica de negocio (fórmulas, generación de nómina, vacaciones, préstamos, liquidación). 
3. UI de las 8 pestañas con todas las interacciones. 
4. Exportaciones Excel/CSV (separador ';', decimales con coma) de: Nómina (SC4-06), Modelo TA-6, Planilla TSS. 
5. Recibo de pago imprimible (window.print) y hoja SC4-06 imprimible con firmas 
(Elaborada/Revisada/Aprobada/Contabilizada por). 
6. Guías de ayuda (modales ❓) para Nómina, Deducciones, Liquidaciones y Configuración. 
"

