import React, { useState, useRef, useEffect, useMemo } from 'react';
import { useDatabaseStore, type PayrollEntry, type EmployeeLoan, type EmployeeDocument } from '../../store/dbStore';
import { useAuthStore } from '../../store/authStore';
import { supabase } from '../../lib/supabase';
import { Users, UserPlus, Trash2, Mail, Phone, Briefcase, DollarSign, FileText, Upload, Download, X, FolderOpen, BookOpen, ShieldCheck, Paperclip, Eye, ChevronDown, Check, Building2, Calculator, Settings, RefreshCw, Save, Edit, FileSpreadsheet, Camera, RotateCcw, IdCard, Printer, HelpCircle, Lock, Unlock, ListChecks, Clock3, AlertTriangle, CircleCheck } from 'lucide-react';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { Button } from '../../components/ui/button';
import { Badge } from '../../components/ui/Badge';
import { toast } from 'sonner';
import { validateNumber, getNumberFromString, exportToExcel } from '../../lib/utils';
import { calcularLiquidacion, type LiquidationResult } from '../../utils/payrollCalculations';
import { useStaggerEnter } from '../../lib/animations/useStaggerEnter';
import { usePersistentFilters } from '../../lib/hooks/usePersistentFilters';
import { useIsOffline } from '../../hooks/useOfflineDisabled';
import PaginationControls from '../../components/PaginationControls';
import OfflineLimitBanner from '../../components/OfflineLimitBanner';
import ConfirmDialog from '../../components/ConfirmDialog';
import { Modal } from '../../components/ui/Modal';

const DOC_TYPE_LABELS: Record<string, string> = {
  MANUAL: 'Manual',
  REGLAMENTO: 'Reglamento Interno',
  PNO: 'PNO',
  CONTRATO: 'Contrato',
  IDENTIFICACION: 'Identificación',
  OTRO: 'Otro',
};

const DOC_TYPE_PLURALS: Record<string, string> = {
  MANUAL: 'Manuales',
  REGLAMENTO: 'Reglamentos Internos',
  PNO: 'PNOs',
};

const DOC_TYPE_ICONS: Record<string, React.ElementType> = {
  MANUAL: BookOpen,
  REGLAMENTO: ShieldCheck,
  PNO: FolderOpen,
  CONTRATO: FileText,
  IDENTIFICACION: Paperclip,
  OTRO: FileText,
};

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

interface CaptacionRow {
  employee_id: string;
  include: boolean;
  worked_hours: number;
  hourly_rate: number;
  bonus: number;
  advances: number;
  retention: number;
  vacation_days: number;
  note: string;
}

const EMPLOYEES_PER_PAGE = 10;
const DEPARTMENTS_PER_PAGE = 10;
const PAYROLL_PER_PAGE = 20;

function EmployeeDocumentsPanel({ employeeId, employeeName }: { employeeId: string; employeeName: string }) {
  const { employeeDocuments, uploadEmployeeDocument, fetchEmployeeDocuments, deleteEmployeeDocument } = useDatabaseStore();
  const [showUploadForm, setShowUploadForm] = useState(false);
  const [docType, setDocType] = useState<'CONTRATO' | 'IDENTIFICACION' | 'OTRO'>('CONTRATO');
  const [customName, setCustomName] = useState('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [confirmDeleteDoc, setConfirmDeleteDoc] = useState<EmployeeDocument | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const isOffline = useIsOffline();

  useEffect(() => {
    if (isOffline) return;
    fetchEmployeeDocuments(employeeId).catch(() => {});
  }, [employeeId, isOffline]);

  const docs = employeeDocuments.filter(d => d.employee_id === employeeId);

  const handleUpload = async () => {
    if (!selectedFile) {
      toast.error('Selecciona un archivo primero');
      return;
    }

    setIsUploading(true);
    const result = await uploadEmployeeDocument(selectedFile, employeeId, docType, customName || undefined);
    setIsUploading(false);

    if (result.success) {
      toast.success('Documento subido exitosamente');
      setShowUploadForm(false);
      setSelectedFile(null);
      setCustomName('');
      setDocType('CONTRATO');
    } else {
      toast.error(result.error || 'Error al subir el documento');
    }
  };

  const handleConfirmDelete = async () => {
    if (!confirmDeleteDoc) return;
    try {
      await deleteEmployeeDocument(confirmDeleteDoc.id, confirmDeleteDoc.file_url);
      setConfirmDeleteDoc(null);
      toast.success('Documento eliminado');
    } catch {
      setConfirmDeleteDoc(null);
      toast.error('Error al eliminar el documento');
    }
  };

  return (
    <div className="mt-4 rounded-xl border border-border bg-bg/50 p-4">
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Paperclip className="h-4 w-4 text-primary" />
          <h4 className="text-sm font-semibold text-text">Documentos de {employeeName}</h4>
          <span className="rounded-full bg-surface px-2 py-0.5 text-xs text-text-secondary">{docs.length}</span>
        </div>
        <Button
          size="sm"
          variant={showUploadForm ? 'ghost' : 'outline'}
          onClick={() => setShowUploadForm(!showUploadForm)}
          className="h-8 gap-1.5 text-xs"
          title={isOffline ? 'Requiere conexión para subir documentos' : (showUploadForm ? 'Cerrar panel de subida' : 'Subir un documento para este empleado')}
          disabled={isOffline}
        >
          {showUploadForm ? <X className="h-3.5 w-3.5" /> : <Upload className="h-3.5 w-3.5" />}
          {showUploadForm ? 'Cancelar' : 'Subir documento'}
          {isOffline && <span className="text-[10px] opacity-70">(offline)</span>}
        </Button>
      </div>

      {showUploadForm && (
        <div className="mb-4 space-y-3 rounded-lg border border-dashed border-border bg-surface/50 p-4">
          <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label className="text-xs text-text-secondary">Tipo de documento *</Label>
                <select
                  className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm text-text focus:border-primary focus:outline-none"
                  value={docType}
                  onChange={e => setDocType(e.target.value as typeof docType)}
                  title="Tipo de documento que vas a subir"
                >
                  <option value="CONTRATO">Contrato</option>
                  <option value="IDENTIFICACION">Identificación</option>
                  <option value="OTRO">Otro</option>
                </select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs text-text-secondary">Nombre (opcional)</Label>
                <Input
                  className="h-9 text-sm"
                  placeholder="Ej: Contrato 2024"
                  value={customName}
                  onChange={e => setCustomName(e.target.value)}
                  title="Nombre personalizado para identificar el documento"
                />
              </div>
          </div>

          <div
            className="flex flex-col items-center justify-center rounded-lg border-2 border-dashed border-border bg-surface/30 p-6 cursor-pointer hover:border-primary/50 transition-colors"
            onClick={() => fileInputRef.current?.click()}
            title="Arrastra un archivo o haz clic para seleccionar"
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,.jpg,.jpeg,.png,.doc,.docx"
              className="hidden"
              onChange={e => {
                const file = e.target.files?.[0];
                if (file) setSelectedFile(file);
              }}
            />
            {selectedFile ? (
              <div className="flex items-center gap-2 text-sm text-success">
                <FileText className="h-4 w-4" />
                <span className="font-medium">{selectedFile.name}</span>
                <span className="text-text-secondary">({formatFileSize(selectedFile.size)})</span>
              </div>
            ) : (
              <div className="text-center text-sm text-text-secondary">
                <Upload className="mx-auto mb-2 h-6 w-6 opacity-50" />
                <p>Haz clic o arrastra un archivo</p>
                <p className="text-xs mt-1">PDF, JPG, PNG, DOC, DOCX</p>
              </div>
            )}
          </div>

          <Button
            onClick={handleUpload}
            disabled={!selectedFile || isUploading || isOffline}
            className="w-full gap-2"
            size="sm"
            title={isOffline ? 'Requiere conexión para subir documentos' : 'Subir el documento seleccionado'}
          >
            {isUploading ? 'Subiendo...' : <><Upload className="h-4 w-4" /> Subir documento</>}
            {isOffline && <span className="text-[10px] opacity-70">(offline)</span>}
          </Button>
        </div>
      )}

      {docs.length === 0 ? (
        <div className="py-6 text-center text-sm text-text-secondary">
          No hay documentos cargados para este empleado.
        </div>
      ) : (
        <div className="space-y-2">
          {docs.map(doc => {
            const Icon = DOC_TYPE_ICONS[doc.doc_type] || FileText;
            return (
              <div key={doc.id} className="flex items-center justify-between rounded-lg border border-border bg-surface p-3 hover:border-primary/30 transition-colors group">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                    <Icon className="h-4 w-4 text-primary" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-text truncate">{doc.name}</p>
                    <p className="text-xs text-text-secondary flex items-center gap-2">
                      <span className="rounded bg-surface px-1.5 py-0.5 text-[10px] font-medium uppercase">{DOC_TYPE_LABELS[doc.doc_type]}</span>
                      <span>{formatFileSize(doc.file_size || 0)}</span>
                      <span>{new Date(doc.created_at).toLocaleDateString('es-ES')}</span>
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0 ml-2">
                  <a
                    href={doc.file_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center justify-center h-8 w-8 rounded-lg text-text-secondary hover:text-primary hover:bg-primary/10 transition-colors"
                    title="Ver documento"
                  >
                    <Eye className="h-4 w-4" />
                  </a>
                  <a
                    href={doc.file_url}
                    download={doc.file_name}
                    className="flex items-center justify-center h-8 w-8 rounded-lg text-text-secondary hover:text-success hover:bg-success/10 transition-colors"
                    title="Descargar"
                  >
                    <Download className="h-4 w-4" />
                  </a>
<button
                      onClick={() => setConfirmDeleteDoc(doc)}
                      disabled={isOffline}
                      className={`flex items-center justify-center h-8 w-8 rounded-lg text-text-secondary hover:text-danger hover:bg-danger/10 transition-colors opacity-0 group-hover:opacity-100 ${isOffline ? 'opacity-30 cursor-not-allowed' : ''}`}
                      title={isOffline ? 'Requiere conexión para eliminar documentos' : 'Eliminar'}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <ConfirmDialog
        isOpen={confirmDeleteDoc !== null}
        title="Eliminar documento"
        message={`¿Eliminar el documento "${confirmDeleteDoc?.name}"?`}
        confirmLabel="Eliminar"
        cancelLabel="Cancelar"
        tone="danger"
        onCancel={() => setConfirmDeleteDoc(null)}
        onConfirm={handleConfirmDelete}
      />
    </div>
  );
}

export default function HRView() {
  const { user } = useAuthStore();
  const { 
    employees, departments, addEmployee, deleteEmployee, 
    hrDocuments, uploadHRDocument, fetchHRDocuments, deleteHRDocument,
    payrollConfig, payrollEntries, calculatePayroll, getPayrollEntries, 
    updatePayrollConfig, updatePayrollEntry, logAction, forceRefreshData,
    getEmployeesCount, getDepartmentsCount, getPayrollEntriesCount,
    payrollPeriods, verifiedRole,
    employeeLoans, addLoan, deleteLoan, payLoanInstallment,
    payrollLiquidations, getPayrollLiquidations, saveLiquidation, deleteLiquidation,
  } = useDatabaseStore();

  const { filters, setFilters, resetFilters } = usePersistentFilters<{
    activeTab: 'personal' | 'departamentos' | 'nomina' | 'deducciones' | 'impuestos' | 'liquidaciones' | 'configuracion' | 'biblioteca';
    employeeSearchTerm: string;
    departmentsPage: number;
    employeesPage: number;
    payrollPage: number;
  }>('hr', { activeTab: 'personal', employeeSearchTerm: '', departmentsPage: 1, employeesPage: 1, payrollPage: 1 });
  const { employeeSearchTerm, departmentsPage, employeesPage, payrollPage } = filters;
  const activeTab = (['personal', 'departamentos', 'nomina', 'deducciones', 'impuestos', 'liquidaciones', 'configuracion', 'biblioteca'] as const).includes(filters.activeTab)
    ? filters.activeTab
    : 'personal';
  const setActiveTab = (v: 'personal' | 'departamentos' | 'nomina' | 'deducciones' | 'impuestos' | 'liquidaciones' | 'configuracion' | 'biblioteca') => setFilters({ activeTab: v });
  const setEmployeeSearchTerm = (v: string) => setFilters({ employeeSearchTerm: v });
  const setDepartmentsPage = (v: number | ((p: number) => number)) => setFilters(prev => ({ ...prev, departmentsPage: typeof v === 'function' ? v(prev.departmentsPage) : v }));
  const setEmployeesPage = (v: number | ((p: number) => number)) => setFilters(prev => ({ ...prev, employeesPage: typeof v === 'function' ? v(prev.employeesPage) : v }));
  const setPayrollPage = (v: number | ((p: number) => number)) => setFilters(prev => ({ ...prev, payrollPage: typeof v === 'function' ? v(prev.payrollPage) : v }));
  const [expandedEmployee, setExpandedEmployee] = useState<string | null>(null);
  const [uploadDocType, setUploadDocType] = useState<'MANUAL' | 'REGLAMENTO' | 'PNO'>('MANUAL');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [selectedEmployeeDoc, setSelectedEmployeeDoc] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [newEmployee, setNewEmployee] = useState({
    name: '', role: '', salary: 0, phone: '', email: '', nit_id: '', category: '', hire_date: '', photo_url: '',
    person_type: 'employee' as 'employee' | 'partner',
    base_contribution: 0,
    contract_type: 'indefinite' as 'indefinite' | 'fixed' | 'probation',
    contract_end_date: '',
  });
  const [newEmployeePhoto, setNewEmployeePhoto] = useState<File | null>(null);
  const [newEmployeePhotoUrl, setNewEmployeePhotoUrl] = useState<string | null>(null);
  const [confirmDeleteEmployee, setConfirmDeleteEmployee] = useState<{ id: string; name: string } | null>(null);
  const [confirmDeleteDepartment, setConfirmDeleteDepartment] = useState<{ id: string; name: string } | null>(null);

  const [newLoan, setNewLoan] = useState({
    employee_id: '',
    deduction_type: 'prestamo' as EmployeeLoan['deduction_type'],
    reason: '',
    total_amount: 0,
    monthly_payment: 0,
    start_date: '',
  });
  const [isCreatingLoan, setIsCreatingLoan] = useState(false);
  const [confirmDeleteLoan, setConfirmDeleteLoan] = useState<EmployeeLoan | null>(null);

  const [liqEmployeeId, setLiqEmployeeId] = useState('');
  const [liqEndDate, setLiqEndDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [liqVacationTaken, setLiqVacationTaken] = useState(0);
  const [liqResult, setLiqResult] = useState<LiquidationResult | null>(null);
  const [confirmDeleteLiquidation, setConfirmDeleteLiquidation] = useState<string | null>(null);

  useEffect(() => {
    if (newEmployeePhoto) {
      const url = URL.createObjectURL(newEmployeePhoto);
      setNewEmployeePhotoUrl(url);
      return () => URL.revokeObjectURL(url);
    }
    setNewEmployeePhotoUrl(null);
  }, [newEmployeePhoto]);

  const nextExpediente = useMemo(() => {
    const exps = employees.map(e => e.expediente).filter((x): x is number => x != null);
    return exps.length ? Math.max(...exps) + 1 : 1;
  }, [employees]);

  const filteredEmployees = useMemo(() => {
    const term = employeeSearchTerm.trim().toLowerCase();
    if (!term) return employees;
    return employees.filter(e =>
      e.name.toLowerCase().includes(term) ||
      String(e.expediente ?? '').includes(term)
    );
  }, [employees, employeeSearchTerm]);

  const paginatedEmployees = useMemo(() => {
    const start = (employeesPage - 1) * EMPLOYEES_PER_PAGE;
    return filteredEmployees.slice(start, start + EMPLOYEES_PER_PAGE);
  }, [filteredEmployees, employeesPage]);

  const paginatedDepartments = useMemo(() => {
    const start = (departmentsPage - 1) * DEPARTMENTS_PER_PAGE;
    return departments.slice(start, start + DEPARTMENTS_PER_PAGE);
  }, [departments, departmentsPage]);

  const paginatedPayrollEntries = useMemo(() => {
    const start = (payrollPage - 1) * PAYROLL_PER_PAGE;
    return payrollEntries.slice(start, start + PAYROLL_PER_PAGE);
  }, [payrollEntries, payrollPage]);

  const [newDepartment, setNewDepartment] = useState('');
  const [editingDepartment, setEditingDepartment] = useState<{id: string, name: string} | null>(null);
  const [payrollMonth, setPayrollMonth] = useState(() => {
    const now = new Date();
    return { month: now.getMonth() + 1, year: now.getFullYear() };
  });
  const [isCalculatingPayroll, setIsCalculatingPayroll] = useState(false);
  const [isCreatingDepartment, setIsCreatingDepartment] = useState(false);
  const [isCreatingEmployee, setIsCreatingEmployee] = useState(false);

  const [configBaseExenta, setConfigBaseExenta] = useState(0);
  const [configMonthlyHours, setConfigMonthlyHours] = useState(190.6);
  const [configAccrualDays, setConfigAccrualDays] = useState(2.5);

  const [draftRows, setDraftRows] = useState<CaptacionRow[]>([]);
  const [draftDeptFilter, setDraftDeptFilter] = useState('');
  const [batchBonus, setBatchBonus] = useState(0);
  const [batchRetention, setBatchRetention] = useState(0);
  const [conceptsEntryId, setConceptsEntryId] = useState<string | null>(null);
  const [conceptsForm, setConceptsForm] = useState<Record<string, number>>({});
  const [payslipEntry, setPayslipEntry] = useState<PayrollEntry | null>(null);
  const [sc406Open, setSc406Open] = useState(false);
  const [confirmApply, setConfirmApply] = useState(false);
  const [confirmReopen, setConfirmReopen] = useState(false);
  const [helpModal, setHelpModal] = useState<'nomina' | 'deducciones' | 'liquidaciones' | 'configuracion' | null>(null);

  const activePeriod = payrollPeriods.find(p => p.month === payrollMonth.month && p.year === payrollMonth.year);
  const payrollApplied = activePeriod?.status === 'applied';
  const verifiedRoleResolved = verifiedRole || useDatabaseStore.getState().accessPins.find(p => p.is_active)?.role || null;
  const isOwner = verifiedRoleResolved === 'owner';

  const filteredDraftRows = draftRows.filter(r => {
    const emp = employees.find(e => e.id === r.employee_id);
    return !draftDeptFilter || emp?.category === draftDeptFilter;
  });

  const loadPayrollData = async (month: number, year: number) => {
    const store = useDatabaseStore.getState();
    await store.getPayrollPeriod(month, year);
    await store.getPayrollEntries(month, year);
    const drafts = await store.getPayrollDrafts(month, year);
    const monthlyHours = payrollConfig?.monthly_hours ?? 190.6;
    const rows = employees.map(emp => {
      const existing = drafts.find(d => d.employee_id === emp.id);
      return {
        employee_id: emp.id,
        include: existing ? existing.include : true,
        worked_hours: existing && existing.worked_hours > 0 ? existing.worked_hours : monthlyHours,
        hourly_rate: existing && existing.hourly_rate > 0 ? existing.hourly_rate : Math.round((emp.salary / monthlyHours) * 100) / 100,
        bonus: existing?.bonus ?? 0,
        advances: existing?.advances ?? 0,
        retention: existing?.retention ?? 0,
        vacation_days: existing?.vacation_days ?? 0,
        note: existing?.note ?? '',
      };
    });
    setDraftRows(rows);
  };

  useEffect(() => {
    if (activeTab === 'nomina' && payrollMonth.month && payrollMonth.year) {
      setPayrollPage(1);
      loadPayrollData(payrollMonth.month, payrollMonth.year);
    }
  }, [activeTab, payrollMonth.month, payrollMonth.year, employees, payrollConfig?.id]);

  useEffect(() => {
    setEmployeesPage(1);
  }, [employeeSearchTerm]);

  const updateDraft = (employeeId: string, patch: Partial<CaptacionRow>) => {
    setDraftRows(prev => prev.map(r => r.employee_id === employeeId ? { ...r, ...patch } : r));
  };

  const handleSaveCaptacion = async () => {
    try {
      const store = useDatabaseStore.getState();
      await store.savePayrollDrafts(payrollMonth.month, payrollMonth.year, draftRows.map(r => ({ ...r, month: payrollMonth.month, year: payrollMonth.year })));
      toast.success('Captación guardada');
    } catch (err) {
      toast.error((err as Error).message || 'Error al guardar la captación');
    }
  };

  const handleGeneratePayroll = async () => {
    const toastId = toast.loading('Calculando nómina...', { duration: 30000 });
    setIsCalculatingPayroll(true);
    try {
      const store = useDatabaseStore.getState();
      await store.savePayrollDrafts(payrollMonth.month, payrollMonth.year, draftRows.map(r => ({ ...r, month: payrollMonth.month, year: payrollMonth.year })));
      await store.calculatePayroll(payrollMonth.month, payrollMonth.year);
      await store.getPayrollEntries(payrollMonth.month, payrollMonth.year);
      await store.getPayrollPeriod(payrollMonth.month, payrollMonth.year);
      toast.success('Nómina calculada exitosamente');
    } catch (err) {
      toast.error((err as Error).message || 'Error al calcular nómina');
    } finally {
      setIsCalculatingPayroll(false);
      toast.dismiss(toastId);
    }
  };

  const handleApplyBatchBonus = () => {
    if (!batchBonus || batchBonus <= 0) { toast.error('Ingresa un monto de bonificación mayor que 0'); return; }
    const ids = new Set(filteredDraftRows.filter(r => r.include).map(r => r.employee_id));
    setDraftRows(prev => prev.map(r => ids.has(r.employee_id) ? { ...r, bonus: r.bonus + batchBonus } : r));
    setBatchBonus(0);
    toast.success('Bonificación aplicada');
  };

  const handleApplyBatchRetention = () => {
    if (!batchRetention || batchRetention <= 0) { toast.error('Ingresa un monto de retención mayor que 0'); return; }
    const ids = new Set(filteredDraftRows.filter(r => r.include).map(r => r.employee_id));
    setDraftRows(prev => prev.map(r => ids.has(r.employee_id) ? { ...r, retention: r.retention + batchRetention } : r));
    setBatchRetention(0);
    toast.success('Retención aplicada');
  };

  const OT_CODES: Record<string, number> = { diurna: 1, nocturna: 2, descanso: 3, feriado: 4 };
  const OT_LABELS: Record<number, string> = { 1: 'diurna', 2: 'nocturna', 3: 'descanso', 4: 'feriado' };

  const openConcepts = (entry: PayrollEntry) => {
    setConceptsEntryId(entry.id);
    setConceptsForm({
      overtime_hours: entry.overtime_hours ?? 0,
      overtime_type: entry.overtime_type ? OT_CODES[entry.overtime_type] : 0,
      bonus: entry.bonus ?? 0,
      vacation_days: entry.vacation_days ?? 0,
      advances: entry.advances ?? 0,
      loan_deduction: entry.loan_deduction ?? 0,
      other_deductions: entry.other_deductions ?? 0,
    });
  };

  const saveConcepts = async () => {
    if (!conceptsEntryId) return;
    try {
      const store = useDatabaseStore.getState();
      const updates: any = {
        overtime_hours: conceptsForm.overtime_hours || 0,
        overtime_type: conceptsForm.overtime_type ? OT_LABELS[conceptsForm.overtime_type] : null,
        bonus: conceptsForm.bonus || 0,
        vacation_days: conceptsForm.vacation_days || 0,
        advances: conceptsForm.advances || 0,
        loan_deduction: conceptsForm.loan_deduction || 0,
        other_deductions: conceptsForm.other_deductions || 0,
      };
      await store.updatePayrollEntry(conceptsEntryId, updates);
      await store.getPayrollEntries(payrollMonth.month, payrollMonth.year);
      setConceptsEntryId(null);
      toast.success('Conceptos actualizados');
    } catch (err) {
      toast.error((err as Error).message || 'Error al guardar conceptos');
    }
  };

  const exportPayrollCsv = () => {
    const monthNames = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
    const fmt = (v: any) => (v === null || v === undefined ? '' : Number(v).toFixed(2).replace('.', ','));
    const columns = [
      { header: 'Código', key: 'codigo' },
      { header: 'Empleado', key: 'employee_name' },
      { header: 'Cargo/Ocupación', key: 'role' },
      { header: 'NIT/Carnet', key: 'nit_id' },
      { header: 'Tasa $/h', key: 'hourly_rate', format: fmt },
      { header: 'Horas Trabajadas', key: 'worked_hours', format: (v: any) => (v ?? 0).toFixed(2).replace('.', ',') },
      { header: 'Días a Cobrar', key: 'days_paid', format: fmt },
      { header: 'Salario Base', key: 'base_salary', format: fmt },
      { header: 'BON', key: 'bonus', format: fmt },
      { header: 'Horas Extra', key: 'overtime_hours', format: (v: any) => (v ?? 0).toFixed(2).replace('.', ',') },
      { header: 'Pago Horas Extra', key: 'overtime_pay', format: fmt },
      { header: 'Pago de Vacaciones', key: 'vacation_pay', format: fmt },
      { header: 'Bruto', key: 'gross_salary', format: fmt },
      { header: 'Base de Cotización', key: 'vacation_base', format: fmt },
      { header: 'Base Exenta', key: 'exemption_base', format: fmt },
      { header: 'Base Imponible', key: 'taxable_base', format: fmt },
      { header: 'IIP', key: 'tax_amount', format: fmt },
      { header: 'CESS', key: 'special_contribution', format: fmt },
      { header: 'Anticipo', key: 'advances', format: fmt },
      { header: 'RET (Deducciones)', key: 'ret', format: fmt },
      { header: 'Salario Devengado (a Cobrar)', key: 'earned_salary', format: fmt },
      { header: 'Vac. Acumuladas', key: 'vac_balance', format: (v: any) => (v ?? 0).toFixed(2).replace('.', ',') },
    ];
    const data = payrollEntries.map(entry => {
      const employee = employees.find(e => e.id === entry.employee_id);
      return {
        ...entry,
        codigo: employee?.expediente ? `#${employee.expediente}` : '',
        role: employee?.role || '',
        nit_id: employee?.nit_id || '',
        ret: (entry.loan_deduction ?? 0) + (entry.other_deductions ?? 0),
        vac_balance: employee?.vacation_balance ?? 0,
      };
    });
    exportToExcel(columns, data, `Nomina_${monthNames[payrollMonth.month - 1]}_${payrollMonth.year}`);
    toast.success('Nómina exportada correctamente');
  };

  const exportTA6 = () => {
    const monthNames = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
    const fmt = (v: any) => (v === null || v === undefined ? '' : Number(v).toFixed(2).replace('.', ','));
    const columns = [
      { header: 'NIT/Carnet', key: 'nit_id' },
      { header: 'Empleado', key: 'employee_name' },
      { header: 'Salario Devengado', key: 'earned_salary', format: fmt },
      { header: 'Base Imponible', key: 'taxable_base', format: fmt },
      { header: 'IIP', key: 'tax_amount', format: fmt },
      { header: 'CESS', key: 'special_contribution', format: fmt },
    ];
    const data = payrollEntries.map(entry => {
      const employee = employees.find(e => e.id === entry.employee_id);
      return { ...entry, nit_id: employee?.nit_id || '' };
    });
    exportToExcel(columns, data, `Modelo_TA6_${monthNames[payrollMonth.month - 1].toLowerCase()}_${payrollMonth.year}`);
    toast.success('Modelo TA-6 exportado');
  };

  const exportTSS = () => {
    const monthNames = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
    const fmt = (v: any) => (v === null || v === undefined ? '' : Number(v).toFixed(2).replace('.', ','));
    const columns = [
      { header: 'NIT/Carnet', key: 'nit_id' },
      { header: 'Empleado', key: 'employee_name' },
      { header: 'Salario Devengado', key: 'earned_salary', format: fmt },
      { header: 'Base de Cotización', key: 'vacation_base', format: fmt },
      { header: 'CESS (trabajador)', key: 'special_contribution', format: fmt },
      { header: 'SS Empleador (14%)', key: 'employer_contribution', format: fmt },
      { header: 'Provisión Vacaciones', key: 'vac_provision', format: fmt },
    ];
    const data = payrollEntries.map(entry => {
      const employee = employees.find(e => e.id === entry.employee_id);
      return {
        ...entry,
        nit_id: employee?.nit_id || '',
        vac_provision: Math.max(0, (entry.vacation_base ?? 0) - entry.earned_salary),
      };
    });
    exportToExcel(columns, data, `Planilla_TSS_${monthNames[payrollMonth.month - 1].toLowerCase()}_${payrollMonth.year}`);
    toast.success('Planilla TSS exportada');
  };
  
  const [orgDocModal, setOrgDocModal] = useState<'PNO' | 'REGLAMENTO' | null>(null);
  const [orgDocFile, setOrgDocFile] = useState<File | null>(null);
  const [isUploadingOrgDoc, setIsUploadingOrgDoc] = useState(false);
  const [showDocDropdown, setShowDocDropdown] = useState(false);
  
  const orgDocsData = {
    PNO: localStorage.getItem('org_doc_pno') || null,
    REGLAMENTO: localStorage.getItem('org_doc_reglamento') || null,
  };

  useEffect(() => {
    if (payrollConfig) {
      setConfigBaseExenta(payrollConfig.tax_exemption_base);
      setConfigMonthlyHours(payrollConfig.monthly_hours ?? 190.6);
      setConfigAccrualDays(payrollConfig.vacation_accrual_days ?? 2.5);
    }
  }, [payrollConfig]);

  useEffect(() => {
    const store = useDatabaseStore.getState();
    if (activeTab === 'deducciones') store.getEmployeeLoans();
    if (activeTab === 'liquidaciones') store.getPayrollLiquidations();
  }, [activeTab]);

  const handleAddEmployee = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;

    const isPartner = newEmployee.person_type === 'partner';

    const salaryValidation = validateNumber(String(newEmployee.salary), { required: true, min: 1, fieldName: isPartner ? 'Retiro Mensual' : 'Salario' });
    if (!salaryValidation.isValid) {
      toast.error(salaryValidation.error);
      return;
    }

    if (isPartner) {
      const bc = newEmployee.base_contribution;
      if (!bc || bc < 2000 || bc > 9500) {
        toast.error('La base de contribución del socio debe estar entre $2,000 y $9,500 (DL 92/2024)');
        return;
      }
    }

    if (newEmployee.contract_type === 'fixed' && !newEmployee.contract_end_date) {
      toast.error('El tipo de contrato "Determinado" requiere fecha fin de contrato');
      return;
    }

    try {
      let photoUrl = null;
      if (newEmployeePhoto) {
        if (!navigator.onLine) {
          toast.warning('Sin conexión — la foto se subirá cuando haya conexión');
        } else {
          const fileName = `employee-${Date.now()}-${newEmployeePhoto.name.replace(/[^a-zA-Z0-9.]/g, '')}`;
          const { data: uploadData, error: uploadError } = await supabase.storage
            .from('hr-documents')
            .upload(fileName, newEmployeePhoto);
          
          if (uploadError) {
            console.error('Error uploading photo:', uploadError);
            toast.error('Error al subir la foto');
            return;
          }
          
          if (uploadData) {
            const { data: urlData } = supabase.storage.from('hr-documents').getPublicUrl(fileName);
            photoUrl = urlData.publicUrl;
          }
        }
      }

      await addEmployee({ 
        name: newEmployee.name, 
        role: newEmployee.role, 
        salary: newEmployee.salary, 
        phone: newEmployee.phone, 
        email: newEmployee.email, 
        nit_id: newEmployee.nit_id, 
        category: newEmployee.category,
        hire_date: newEmployee.hire_date || undefined,
        photo_url: photoUrl || undefined,
        person_type: newEmployee.person_type,
        base_contribution: isPartner ? newEmployee.base_contribution : undefined,
        contract_type: isPartner ? undefined : newEmployee.contract_type,
        contract_end_date: isPartner ? undefined : (newEmployee.contract_end_date || undefined),
      });
      setNewEmployee({ name: '', role: '', salary: 0, phone: '', email: '', nit_id: '', category: '', hire_date: '', photo_url: '', person_type: 'employee', base_contribution: 0, contract_type: 'indefinite', contract_end_date: '' });
      setNewEmployeePhoto(null);
      toast.success('Empleado agregado exitosamente');
    } catch (err) {
      toast.error((err as Error).message || 'Error al agregar el empleado');
    }
  };

  const handleUploadDoc = async () => {
    if (!selectedFile) {
      toast.error('Selecciona un archivo primero');
      return;
    }

    setIsUploading(true);
    const result = await uploadHRDocument(selectedFile, uploadDocType);
    setIsUploading(false);

    if (result.success) {
      toast.success('Documento subido exitosamente');
      setSelectedFile(null);
      setUploadDocType('MANUAL');
    } else {
      toast.error(result.error || 'Error al subir el documento');
    }
  };

  const handleDeleteDoc = async (doc: typeof hrDocuments[0]) => {
    if (!window.confirm(`¿Eliminar "${doc.name}"?`)) return;
    try {
      await deleteHRDocument(doc.id, doc.file_url);
      toast.success('Documento eliminado');
    } catch {
      toast.error('Error al eliminar el documento');
    }
  };

  const groupedDocs = hrDocuments.reduce((acc, doc) => {
    if (!acc[doc.doc_type]) acc[doc.doc_type] = [];
    acc[doc.doc_type].push(doc);
    return acc;
  }, {} as Record<string, typeof hrDocuments>);

  const hrTbodyRef = useStaggerEnter<HTMLTableSectionElement>([]);

  return (
    <div className="space-y-6">
      <OfflineLimitBanner moduleName="Recursos Humanos" />
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-text">Recursos Humanos</h1>
          <p className="text-sm text-text-secondary">Gestión de personal y documentación laboral</p>
        </div>

<div className="flex rounded-xl border border-border bg-surface p-1 shadow-sm overflow-x-auto">
          <button
            onClick={() => setActiveTab('personal')}
            className={`flex items-center gap-2 rounded-lg px-3 sm:px-4 py-2 text-xs sm:text-sm font-medium transition-all whitespace-nowrap ${
              activeTab === 'personal'
                ? 'bg-primary text-white shadow-sm'
                : 'text-text-secondary hover:text-text'
            }`}
          >
            <Users className="h-4 w-4" />
            <span className="hidden xs:inline">Personal</span>
            <span className="inline xs:hidden">Pers.</span>
          </button>
          <button
            onClick={() => setActiveTab('departamentos')}
            className={`flex items-center gap-2 rounded-lg px-3 sm:px-4 py-2 text-xs sm:text-sm font-medium transition-all whitespace-nowrap ${
              activeTab === 'departamentos'
                ? 'bg-primary text-white shadow-sm'
                : 'text-text-secondary hover:text-text'
            }`}
          >
            <Building2 className="h-4 w-4" />
            <span className="hidden xs:inline">Departamentos</span>
            <span className="inline xs:hidden">Deptos.</span>
          </button>
<button
            onClick={() => setActiveTab('nomina')}
            className={`flex items-center gap-2 rounded-lg px-3 sm:px-4 py-2 text-xs sm:text-sm font-medium transition-all whitespace-nowrap ${
              activeTab === 'nomina'
                ? 'bg-primary text-white shadow-sm'
                : 'text-text-secondary hover:text-text'
            }`}
          >
            <DollarSign className="h-4 w-4" />
            <span className="hidden xs:inline">Nómina</span>
            <span className="inline xs:hidden">Nóm.</span>
          </button>
          <button
            onClick={() => setActiveTab('deducciones')}
            className={`flex items-center gap-2 rounded-lg px-3 sm:px-4 py-2 text-xs sm:text-sm font-medium transition-all whitespace-nowrap ${
              activeTab === 'deducciones'
                ? 'bg-primary text-white shadow-sm'
                : 'text-text-secondary hover:text-text'
            }`}
          >
            <ShieldCheck className="h-4 w-4" />
            <span className="hidden xs:inline">Deducciones</span>
            <span className="inline xs:hidden">Deduc.</span>
          </button>
          <button
            onClick={() => setActiveTab('impuestos')}
            className={`flex items-center gap-2 rounded-lg px-3 sm:px-4 py-2 text-xs sm:text-sm font-medium transition-all whitespace-nowrap ${
              activeTab === 'impuestos'
                ? 'bg-primary text-white shadow-sm'
                : 'text-text-secondary hover:text-text'
            }`}
          >
            <FileText className="h-4 w-4" />
            <span className="hidden xs:inline">Imp. Empresa</span>
            <span className="inline xs:hidden">Imp.</span>
          </button>
          <button
            onClick={() => setActiveTab('liquidaciones')}
            className={`flex items-center gap-2 rounded-lg px-3 sm:px-4 py-2 text-xs sm:text-sm font-medium transition-all whitespace-nowrap ${
              activeTab === 'liquidaciones'
                ? 'bg-primary text-white shadow-sm'
                : 'text-text-secondary hover:text-text'
            }`}
          >
            <Clock3 className="h-4 w-4" />
            <span className="hidden xs:inline">Liquidaciones</span>
            <span className="inline xs:hidden">Liq.</span>
          </button>
          <button
            onClick={() => setActiveTab('configuracion')}
            className={`flex items-center gap-2 rounded-lg px-3 sm:px-4 py-2 text-xs sm:text-sm font-medium transition-all whitespace-nowrap ${
              activeTab === 'configuracion'
                ? 'bg-primary text-white shadow-sm'
                : 'text-text-secondary hover:text-text'
            }`}
          >
            <Settings className="h-4 w-4" />
            <span className="hidden xs:inline">Configuración</span>
            <span className="inline xs:hidden">Config.</span>
          </button>
          <button
            onClick={() => setActiveTab('biblioteca')}
            className={`flex items-center gap-2 rounded-lg px-3 sm:px-4 py-2 text-xs sm:text-sm font-medium transition-all whitespace-nowrap ${
              activeTab === 'biblioteca'
                ? 'bg-primary text-white shadow-sm'
                : 'text-text-secondary hover:text-text'
            }`}
          >
            <FolderOpen className="h-4 w-4" />
            <span className="hidden xs:inline">Biblioteca</span>
            <span className="inline xs:hidden">Docs</span>
          </button>
        </div>
      </div>

      {activeTab === 'personal' && (
        <div className="grid gap-6 lg:grid-cols-3">
          <div className="rounded-xl border border-border bg-surface p-6 shadow-sm lg:col-span-1 h-fit">
            <div className="mb-6 flex items-center gap-3 border-b border-border pb-4">
              <div className="rounded-lg bg-primary/10 p-2 text-primary">
                <UserPlus className="h-5 w-5" />
              </div>
              <h2 className="text-lg font-semibold text-text">Nuevo Empleado</h2>
            </div>

            <form onSubmit={handleAddEmployee} className="space-y-4">
              <div className="space-y-2">
                <Label>N° Expediente</Label>
                <div className="flex h-10 items-center gap-2 rounded-lg border border-border bg-bg px-3 text-sm text-text-secondary">
                  <IdCard className="h-4 w-4 text-primary/70" />
                  <span className="font-medium text-text">#{nextExpediente}</span>
                </div>
                <p className="text-xs text-text-secondary">Se asigna automáticamente (no editable)</p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="person_type">Tipo de Persona *</Label>
                <select
                  id="person_type"
                  className="flex h-10 w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm text-text focus:outline-none focus:ring-2 focus:ring-primary/50"
                  value={newEmployee.person_type}
                  onChange={e => setNewEmployee({ ...newEmployee, person_type: e.target.value as 'employee' | 'partner' })}
                >
                  <option value="employee">Empleado</option>
                  <option value="partner">Socio</option>
                </select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="name">Nombre Completo *</Label>
                <Input
                  id="name"
                  required
                  value={newEmployee.name}
                  onChange={e => setNewEmployee({ ...newEmployee, name: e.target.value })}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="role">Puesto / Rol *</Label>
                <Input
                  id="role"
                  required
                  placeholder="Ej: Cajero, Cocinero, Mesero..."
                  value={newEmployee.role}
                  onChange={e => setNewEmployee({ ...newEmployee, role: e.target.value })}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="salary">{newEmployee.person_type === 'partner' ? 'Retiro Mensual *' : 'Salario Básico *'}</Label>
                <Input
                  id="salary"
                  type="number"
                  min="0"
                  step="0.01"
                  required
                  value={newEmployee.salary || ''}
                  onChange={e => setNewEmployee({ ...newEmployee, salary: Number(e.target.value) })}
                />
              </div>

              {newEmployee.person_type === 'partner' && (
                <div className="space-y-2">
                  <Label htmlFor="base_contribution">Base de Contribución *</Label>
                  <Input
                    id="base_contribution"
                    type="number"
                    min="2000"
                    max="9500"
                    step="0.01"
                    required
                    value={newEmployee.base_contribution || ''}
                    onChange={e => setNewEmployee({ ...newEmployee, base_contribution: Number(e.target.value) })}
                  />
                  <p className="text-xs text-text-secondary">Rango $2,000 – $9,500 según DL 92/2024</p>
                </div>
              )}

              {newEmployee.person_type !== 'partner' && (
                <>
                  <div className="space-y-2">
                    <Label htmlFor="contract_type">Tipo de Contrato *</Label>
                    <select
                      id="contract_type"
                      className="flex h-10 w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm text-text focus:outline-none focus:ring-2 focus:ring-primary/50"
                      value={newEmployee.contract_type}
                      onChange={e => setNewEmployee({ ...newEmployee, contract_type: e.target.value as 'indefinite' | 'fixed' | 'probation' })}
                    >
                      <option value="indefinite">Indeterminado</option>
                      <option value="fixed">Determinado</option>
                      <option value="probation">Prueba</option>
                    </select>
                  </div>

                  {newEmployee.contract_type === 'fixed' && (
                    <div className="space-y-2">
                      <Label htmlFor="contract_end_date">Fecha Fin de Contrato *</Label>
                      <Input
                        id="contract_end_date"
                        type="date"
                        required
                        value={newEmployee.contract_end_date}
                        onChange={e => setNewEmployee({ ...newEmployee, contract_end_date: e.target.value })}
                      />
                    </div>
                  )}
                </>
              )}

              <div className="space-y-2">
                <Label htmlFor="phone">Teléfono (opcional)</Label>
                <Input
                  id="phone"
                  type="tel"
                  maxLength={10}
                  placeholder="Máximo 10 dígitos"
                  value={newEmployee.phone}
                  onChange={e => {
                    const val = e.target.value.replace(/\D/g, '').slice(0, 10);
                    setNewEmployee({ ...newEmployee, phone: val });
                  }}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="email">Correo Electrónico</Label>
                <Input
                  id="email"
                  type="email"
                  value={newEmployee.email}
                  onChange={e => setNewEmployee({ ...newEmployee, email: e.target.value })}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="nit_id">NIT / Carnet de Identidad (opcional)</Label>
                <Input
                  id="nit_id"
                  maxLength={11}
                  placeholder="Máximo 11 dígitos"
                  value={newEmployee.nit_id}
                  onChange={e => {
                    const val = e.target.value.replace(/\D/g, '').slice(0, 11);
                    setNewEmployee({ ...newEmployee, nit_id: val });
                  }}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="category">Departamento *</Label>
                <select
                  id="category"
                  required
                  className="flex h-10 w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm text-text focus:outline-none focus:ring-2 focus:ring-primary/50"
                  value={newEmployee.category}
                  onChange={e => setNewEmployee({ ...newEmployee, category: e.target.value })}
                >
                  <option value="">Seleccionar departamento...</option>
                  {departments.map(dept => (
                    <option key={dept.id} value={dept.id}>{dept.name}</option>
                  ))}
                </select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="hire_date">Fecha de Contratación</Label>
                <Input
                  id="hire_date"
                  type="date"
                  value={newEmployee.hire_date}
                  onChange={e => setNewEmployee({ ...newEmployee, hire_date: e.target.value })}
                />
              </div>

              <div className="space-y-2">
                <Label>Foto del Empleado</Label>
                <div className="flex items-center gap-3">
                  <label className="flex items-center justify-center w-24 h-24 sm:w-20 sm:h-20 rounded-lg border-2 border-dashed border-border hover:border-primary cursor-pointer transition-colors overflow-hidden bg-bg">
                    {newEmployeePhoto ? (
                      <img src={newEmployeePhotoUrl || ''} alt="Preview" className="w-full h-full object-cover" />
                    ) : (
                      <div className="flex flex-col items-center">
                        <Camera className="h-6 w-6 text-text-secondary" />
                        <span className="text-[10px] text-text-secondary">Subir</span>
                      </div>
                    )}
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      className="hidden"
                      onChange={e => {
                        if (e.target.files && e.target.files[0]) {
                          const file = e.target.files[0];
                          if (file.size > 500 * 1024) {
                            toast.warning('Archivo muy grande. Se recomienda max 500KB para mejor rendimiento.');
                          }
                          setNewEmployeePhoto(file);
                        }
                      }}
                    />
                  </label>
                  {newEmployeePhoto && (
                    <button
                      type="button"
                      onClick={() => setNewEmployeePhoto(null)}
                      className="text-xs text-danger hover:underline"
                    >
                      Eliminar
                    </button>
                  )}
                </div>
                <p className="text-xs text-text-secondary">Formato: JPG, PNG o WebP. Tamaño máx: 500KB (optimizado: 100-200KB)</p>
              </div>

              <Button type="submit" className="mt-6 px-8 w-full gap-2">
                <UserPlus className="h-4 w-4" />
                Registrar Empleado
              </Button>
            </form>
          </div>

          <div className="rounded-xl border border-border bg-surface p-6 shadow-sm lg:col-span-2">
            <div className="mb-6 flex items-center gap-3 border-b border-border pb-4">
              <div className="rounded-lg bg-primary/10 p-2 text-primary">
                <Users className="h-5 w-5" />
              </div>
              <h2 className="text-lg font-semibold text-text">Directorio de Personal</h2>
              <span className="ml-auto rounded-full bg-surface-hover px-2.5 py-0.5 text-xs font-medium text-text-secondary">
                {employees.length} empleado{employees.length !== 1 ? 's' : ''}
              </span>
            </div>

            <div className="mb-4 flex items-center gap-2">
              <Input
                placeholder="Buscar por nombre o #expediente..."
                value={employeeSearchTerm}
                onChange={(e) => setEmployeeSearchTerm(e.target.value)}
                className="h-9"
              />
              <button
                onClick={() => setEmployeeSearchTerm('')}
                className="inline-flex items-center gap-1.5 shrink-0 rounded-lg border border-border bg-bg px-3 py-1.5 text-xs text-text-secondary hover:text-text hover:border-primary transition-colors"
                title="Limpiar filtros"
              >
                <X className="h-3 w-3" /> Limpiar
              </button>
            </div>

            <div className="space-y-3">
              {filteredEmployees.length === 0 ? (
                <div className="col-span-full py-12 text-center text-text-secondary">
                  No hay empleados registrados.
                </div>
              ) : (
                paginatedEmployees.map(employee => {
                  const isPartner = employee.person_type === 'partner';
                  const contractBadge =
                    !isPartner && employee.contract_type === 'fixed'
                      ? { label: 'Determinado', cls: 'bg-sky-500/15 text-sky-400 border border-sky-500/30' }
                      : !isPartner && employee.contract_type === 'probation'
                        ? { label: 'Prueba', cls: 'bg-warning/15 text-warning border border-warning/30' }
                        : null;
                  return (
                  <div key={employee.id} className="rounded-xl border border-border bg-bg transition-colors hover:border-primary/30">
                    <div className="flex items-center justify-between p-4">
                      <div className="flex items-center gap-3 min-w-0 flex-1">
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full bg-primary/10 text-primary font-bold text-sm">
                          {employee.photo_url ? (
                            <img src={employee.photo_url} alt={employee.name} className="h-full w-full object-cover" />
                          ) : (
                            employee.name.charAt(0).toUpperCase()
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <h3 className="font-semibold text-text">{employee.name}</h3>
                            {employee.expediente != null && (
                              <span className="rounded bg-surface px-1.5 py-0.5 text-[10px] font-medium text-text-secondary">#{employee.expediente}</span>
                            )}
                            <Badge variant={isPartner ? 'warning' : 'info'} size="sm">
                              {isPartner ? 'Socio' : 'Empleado'}
                            </Badge>
                            {contractBadge && (
                              <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${contractBadge.cls}`}>{contractBadge.label}</span>
                            )}
                          </div>
                          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-text-secondary">
                            <span className="flex items-center gap-1">
                              <Briefcase className="h-3 w-3 text-primary/70" />
                              {employee.role}
                            </span>
                            <span className="flex items-center gap-1">
                              <DollarSign className="h-3 w-3 text-primary/70" />
                              ${employee.salary.toFixed(2)}/mes
                            </span>
                            {employee.phone && (
                              <span className="flex items-center gap-1">
                                <Phone className="h-3 w-3 text-primary/70" />
                                {employee.phone}
                              </span>
                            )}
                            {employee.email && (
                              <span className="flex items-center gap-1">
                                <Mail className="h-3 w-3 text-primary/70" />
                                {employee.email}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-1 shrink-0 ml-2">
                        <button
                          onClick={() => setExpandedEmployee(expandedEmployee === employee.id ? null : employee.id)}
                          className={`flex items-center justify-center h-9 w-9 rounded-lg transition-all ${
                            expandedEmployee === employee.id
                              ? 'bg-primary/10 text-primary'
                              : 'text-text-secondary hover:text-primary hover:bg-primary/10'
                          }`}
                          title="Ver documentos del empleado"
                        >
                          <Paperclip className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => setConfirmDeleteEmployee({ id: employee.id, name: employee.name })}
                          className="flex items-center justify-center h-9 w-9 rounded-lg text-text-secondary hover:text-danger hover:bg-danger/10 transition-colors"
                          title="Eliminar empleado"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </div>

                    {expandedEmployee === employee.id && (
                      <EmployeeDocumentsPanel employeeId={employee.id} employeeName={employee.name} />
                    )}
                  </div>
                  );
                })
              )}
            </div>

            <PaginationControls page={employeesPage} total={filteredEmployees.length} onPageChange={setEmployeesPage} />
          </div>
        </div>
      )}

      {activeTab === 'departamentos' && (
        <div className="grid gap-6 lg:grid-cols-3">
          <div className="rounded-xl border border-border bg-surface p-6 shadow-sm lg:col-span-1 h-fit">
            <div className="mb-6 flex items-center gap-3 border-b border-border pb-4">
              <div className="rounded-lg bg-primary/10 p-2 text-primary">
                <Building2 className="h-5 w-5" />
              </div>
              <h2 className="text-lg font-semibold text-text">Nuevo Departamento</h2>
            </div>
            <form onSubmit={async (e) => {
              e.preventDefault();
              if (!newDepartment.trim()) return;
              if (departments.some(d => d.name.toLowerCase() === newDepartment.trim().toLowerCase())) {
                toast.error('Ya existe un departamento con ese nombre');
                return;
              }
              setIsCreatingDepartment(true);
              try {
                const { addDepartment } = useDatabaseStore.getState();
                await addDepartment(newDepartment);
                setNewDepartment('');
                toast.success('Departamento creado');
              } catch (err) {
                toast.error((err as Error).message);
              } finally {
                setIsCreatingDepartment(false);
              }
            }} className="space-y-4">
              <div className="space-y-2">
                <Label>Nombre del Departamento *</Label>
                <Input
                  placeholder="Ej: Cocina, Limpieza..."
                  value={newDepartment}
                  onChange={e => setNewDepartment(e.target.value)}
                />
              </div>
              <Button type="submit" disabled={isCreatingDepartment} className="w-full gap-2">
                {isCreatingDepartment ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Building2 className="h-4 w-4" />}
                {isCreatingDepartment ? 'Creando...' : 'Crear'}
              </Button>
            </form>
          </div>
          <div className="rounded-xl border border-border bg-surface p-6 shadow-sm lg:col-span-2">
            <div className="mb-6 flex items-center gap-3 border-b border-border pb-4">
              <h2 className="text-lg font-semibold text-text">Lista de Departamentos</h2>
              <span className="ml-auto bg-surface-hover px-2.5 py-0.5 text-xs font-medium text-text-secondary rounded-full">
                {departments.length}
              </span>
            </div>
            <div className="space-y-3">
              {departments.length === 0 ? (
                <div className="py-12 text-center text-text-secondary">No hay departamentos</div>
              ) : (
                paginatedDepartments.map(dept => {
                  const empCount = employees.filter(e => e.category === dept.id).length;
                  return (
                    <div key={dept.id} className="flex items-center justify-between p-4 rounded-xl border border-border bg-bg hover:border-primary/30">
                      <div className="flex items-center gap-3">
                        <div className="h-10 w-10 rounded-full bg-primary/10 text-primary flex items-center justify-center font-bold">
                          {dept.name.charAt(0).toUpperCase()}
                        </div>
                        <div>
                          {editingDepartment?.id === dept.id ? (
                            <div className="flex items-center gap-2">
                              <Input
                                value={editingDepartment.name}
                                onChange={e => setEditingDepartment({ ...editingDepartment, name: e.target.value })}
                                className="h-8 w-full sm:w-48 max-w-[200px]"
                              />
                              <Button size="sm" onClick={async () => {
                                const { updateDepartment } = useDatabaseStore.getState();
                                await updateDepartment(dept.id, editingDepartment.name);
                                setEditingDepartment(null);
                              }}><Save className="h-4 w-4" /></Button>
                              <Button size="sm" variant="ghost" onClick={() => setEditingDepartment(null)}><X className="h-4 w-4" /></Button>
                            </div>
                          ) : (
                            <>
                              <h3 className="font-semibold text-text">{dept.name}</h3>
                              <p className="text-xs text-text-secondary">{empCount} empleado{empCount !== 1 ? 's' : ''}</p>
                            </>
                          )}
                        </div>
                      </div>
                      {editingDepartment?.id !== dept.id && (
                        <div className="flex gap-1">
                          <Button size="sm" variant="ghost" onClick={() => setEditingDepartment({ id: dept.id, name: dept.name })}>
                            <Edit className="h-4 w-4" />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => {
                              if (empCount > 0) { toast.error(`Hay ${empCount} empleados en este departamento`); return; }
                              setConfirmDeleteDepartment({ id: dept.id, name: dept.name });
                            }}
                            className="text-danger hover:text-danger"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>

            <PaginationControls page={departmentsPage} total={departments.length} onPageChange={setDepartmentsPage} />
          </div>
        </div>
      )}

{activeTab === 'nomina' && (
        <div className="space-y-6">
          <div className="rounded-xl border border-border bg-surface p-6 shadow-sm">
            <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="rounded-lg bg-primary/10 p-2 text-primary">
                  <Calculator className="h-5 w-5" />
                </div>
                <div>
                  <h2 className="text-lg font-semibold text-text">Nómina</h2>
                  <p className="text-sm text-text-secondary">Período → Captación → Generación → Revisión → Aplicación</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <select
                  className="h-10 rounded-lg border border-border bg-bg px-3 py-2 text-sm"
                  value={payrollMonth.month}
                  onChange={e => setPayrollMonth({ ...payrollMonth, month: Number(e.target.value) })}
                >
                  {Array.from({ length: 12 }, (_, i) => (
                    <option key={i + 1} value={i + 1}>
                      {new Date(0, i).toLocaleString('es', { month: 'long' }).charAt(0).toUpperCase() + new Date(0, i).toLocaleString('es', { month: 'long' }).slice(1)}
                    </option>
                  ))}
                </select>
                <select
                  className="h-10 rounded-lg border border-border bg-bg px-3 py-2 text-sm"
                  value={payrollMonth.year}
                  onChange={e => setPayrollMonth({ ...payrollMonth, year: Number(e.target.value) })}
                >
                  {Array.from({ length: 67 }, (_, i) => 2024 + i).map(y => <option key={y} value={y}>{y}</option>)}
                </select>
                <Button variant="outline" size="icon" onClick={() => setHelpModal('nomina')} title="Guía de nómina">
                  <HelpCircle className="h-4 w-4" />
                </Button>
              </div>
            </div>

            {payrollApplied && (
              <div className="mt-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-xl border border-warning/40 bg-warning/10 p-4">
                <div className="flex items-start gap-3">
                  <Lock className="h-5 w-5 text-warning shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm font-semibold text-warning">Nómina aplicada (bloqueada)</p>
                    <p className="text-xs text-text-secondary">
                      {activePeriod?.applied_at ? new Date(activePeriod.applied_at).toLocaleDateString('es-ES') : ''}
                      {activePeriod?.applied_by ? ` por ${activePeriod.applied_by}` : ''}
                    </p>
                    <p className="text-xs text-text-secondary mt-1">No se puede modificar; las correcciones se realizan reabriendo (solo Dueño/a).</p>
                  </div>
                </div>
                {isOwner && (
                  <Button variant="outline" size="sm" onClick={() => setConfirmReopen(true)}>
                    <Unlock className="h-4 w-4 mr-1" /> Reabrir
                  </Button>
                )}
              </div>
            )}

            <div className="mt-4 flex flex-wrap items-center gap-2">
              <Button variant="outline" size="sm" onClick={handleSaveCaptacion} disabled={payrollApplied} title="Guardar la captación del período">
                <Save className="h-4 w-4 mr-1" /> Guardar Captación
              </Button>
              <Button size="sm" onClick={handleGeneratePayroll} disabled={isCalculatingPayroll || payrollApplied} className="gap-2">
                {isCalculatingPayroll ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Calculator className="h-4 w-4" />}
                {isCalculatingPayroll ? 'Calculando...' : 'Generar Nómina'}
              </Button>
              {payrollEntries.length > 0 && !payrollApplied && isOwner && (
                <Button variant="default" size="sm" onClick={() => setConfirmApply(true)} className="gap-2">
                  <CircleCheck className="h-4 w-4" /> Aplicar Nómina
                </Button>
              )}
              {payrollEntries.length > 0 && (
                <>
                  <Button variant="outline" size="sm" onClick={exportPayrollCsv} title="Exportar nómina (CSV/Excel)">
                    <FileSpreadsheet className="h-4 w-4 mr-1" /> Excel
                  </Button>
                  <Button variant="outline" size="sm" onClick={exportTA6} title="Exportar Modelo TA-6">
                    TA-6
                  </Button>
                  <Button variant="outline" size="sm" onClick={exportTSS} title="Exportar Planilla TSS">
                    TSS
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => setSc406Open(true)} title="Imprimir modelo SC4-06">
                    <Printer className="h-4 w-4 mr-1" /> SC4-06
                  </Button>
                </>
              )}
            </div>
          </div>

          {/* Captación pre-nómina */}
          <div className="rounded-xl border border-border bg-surface p-6 shadow-sm">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="rounded-lg bg-primary/10 p-2 text-primary">
                  <ListChecks className="h-5 w-5" />
                </div>
                <h3 className="text-lg font-semibold text-text">Captación pre-nómina</h3>
              </div>
              <select
                className="h-10 rounded-lg border border-border bg-bg px-3 py-2 text-sm"
                value={draftDeptFilter}
                onChange={e => setDraftDeptFilter(e.target.value)}
              >
                <option value="">Todos los departamentos</option>
                {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </div>

            {draftRows.length === 0 ? (
              <div className="py-8 text-center text-sm text-text-secondary">No hay personal registrado.</div>
            ) : (
              <>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-bg text-text-secondary">
                      <tr>
                        <th className="px-3 py-2 text-center" title="Incluir en la nómina"><Check className="h-3.5 w-3.5 inline-block" /></th>
                        <th className="px-3 py-2 text-left" title="Expediente y nombre del trabajador">Empleado</th>
                        <th className="px-3 py-2 text-left hidden md:table-cell">Departamento</th>
                        <th className="px-3 py-2 text-right" title="Horas trabajadas en el período">Horas trab.</th>
                        <th className="px-3 py-2 text-right" title="Tasa por hora">Tasa $/h</th>
                        <th className="px-3 py-2 text-right" title="Tasa × horas (solo lectura)">A cobrar</th>
                        <th className="px-3 py-2 text-right" title="Bonificación/estímulo">BON $</th>
                        <th className="px-3 py-2 text-right" title="Anticipo">Anticipo $</th>
                        <th className="px-3 py-2 text-right" title="Retención">RET $</th>
                        <th className="px-3 py-2 text-right" title="Días de vacaciones pagadas">Vac. días</th>
                        <th className="px-3 py-2 text-left hidden lg:table-cell">Nota</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {filteredDraftRows.map(row => {
                        const emp = employees.find(e => e.id === row.employee_id);
                        const dept = departments.find(d => d.id === emp?.category);
                        const earns = Math.round((row.hourly_rate * row.worked_hours) * 100) / 100;
                        return (
                          <tr key={row.employee_id} className="hover:bg-bg/50">
                            <td className="px-3 py-2 text-center">
                              <input type="checkbox" checked={row.include} onChange={e => updateDraft(row.employee_id, { include: e.target.checked })} disabled={payrollApplied} />
                            </td>
                            <td className="px-3 py-2">
                              <span className="font-medium">{emp?.name || '—'}</span>
                              {emp?.expediente != null && <span className="ml-1 text-xs text-text-secondary">#{emp.expediente}</span>}
                            </td>
                            <td className="px-3 py-2 text-text-secondary hidden md:table-cell">{dept?.name || '—'}</td>
                            <td className="px-3 py-2 text-right">
                              <input
                                type="number"
                                step="0.01"
                                className="w-20 rounded border border-border bg-bg px-2 py-1 text-right text-sm"
                                value={row.worked_hours || ''}
                                disabled={payrollApplied}
                                onBlur={e => {
                                  const v = Number(e.target.value) || 0;
                                  const monthlyHours = payrollConfig?.monthly_hours ?? 190.6;
                                  if (v > monthlyHours) {
                                    toast.warning(`Las horas (${v}) superan el fondo de tiempo (${monthlyHours} h). Se pagará tasa × horas trabajadas.`);
                                  }
                                  updateDraft(row.employee_id, { worked_hours: v });
                                }}
                              />
                            </td>
                            <td className="px-3 py-2 text-right">
                              <input
                                type="number"
                                step="0.01"
                                className="w-20 rounded border border-border bg-bg px-2 py-1 text-right text-sm"
                                value={row.hourly_rate || ''}
                                disabled={payrollApplied}
                                onChange={e => updateDraft(row.employee_id, { hourly_rate: Number(e.target.value) || 0 })}
                              />
                            </td>
                            <td className="px-3 py-2 text-right text-text-secondary">${earns.toFixed(2)}</td>
                            <td className="px-3 py-2 text-right">
                              <input type="number" step="0.01" className="w-20 rounded border border-border bg-bg px-2 py-1 text-right text-sm" value={row.bonus || ''} disabled={payrollApplied} onChange={e => updateDraft(row.employee_id, { bonus: Number(e.target.value) || 0 })} />
                            </td>
                            <td className="px-3 py-2 text-right">
                              <input type="number" step="0.01" className="w-20 rounded border border-border bg-bg px-2 py-1 text-right text-sm" value={row.advances || ''} disabled={payrollApplied} onChange={e => updateDraft(row.employee_id, { advances: Number(e.target.value) || 0 })} />
                            </td>
                            <td className="px-3 py-2 text-right">
                              <input type="number" step="0.01" className="w-20 rounded border border-border bg-bg px-2 py-1 text-right text-sm" value={row.retention || ''} disabled={payrollApplied} onChange={e => updateDraft(row.employee_id, { retention: Number(e.target.value) || 0 })} />
                            </td>
                            <td className="px-3 py-2 text-right">
                              <input type="number" step="0.5" min="0" max="30" className="w-16 rounded border border-border bg-bg px-2 py-1 text-right text-sm" value={row.vacation_days || ''} disabled={payrollApplied} onChange={e => updateDraft(row.employee_id, { vacation_days: Number(e.target.value) || 0 })} />
                            </td>
                            <td className="px-3 py-2 hidden lg:table-cell">
                              <input type="text" className="w-full rounded border border-border bg-bg px-2 py-1 text-sm" value={row.note} disabled={payrollApplied} onChange={e => updateDraft(row.employee_id, { note: e.target.value })} />
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                <div className="mt-4 flex flex-wrap items-end gap-3 border-t border-border pt-4">
                  <div className="space-y-1">
                    <Label className="text-xs text-text-secondary">Bonificación $ (lote)</Label>
                    <div className="flex gap-2">
                      <Input type="number" step="0.01" className="h-9 w-28" value={batchBonus || ''} disabled={payrollApplied} onChange={e => setBatchBonus(Number(e.target.value))} />
                      <Button size="sm" variant="outline" onClick={handleApplyBatchBonus} disabled={payrollApplied}>Bonificar</Button>
                    </div>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs text-text-secondary">Retención $ (lote)</Label>
                    <div className="flex gap-2">
                      <Input type="number" step="0.01" className="h-9 w-28" value={batchRetention || ''} disabled={payrollApplied} onChange={e => setBatchRetention(Number(e.target.value))} />
                      <Button size="sm" variant="outline" onClick={handleApplyBatchRetention} disabled={payrollApplied}>Retener</Button>
                    </div>
                  </div>
                </div>
              </>
            )}
          </div>

          {payrollEntries.length > 0 ? (
            <div className="space-y-4">
              {Object.entries(paginatedPayrollEntries.reduce((acc, entry) => {
                if (!acc[entry.employee_category]) acc[entry.employee_category] = [];
                acc[entry.employee_category].push(entry);
                return acc;
              }, {} as Record<string, typeof payrollEntries>)).map(([category, entries]) => {
                const categoryTotal = entries.reduce((sum, e) => sum + e.net_salary, 0);
                return (
                  <div key={category} className="rounded-xl border border-border bg-surface overflow-hidden">
                    <div className="bg-primary/5 border-b px-6 py-3 flex justify-between">
                      <h3 className="font-semibold">{category}</h3>
                      <span className="text-sm">Total: <span className="font-bold text-primary">${categoryTotal.toFixed(2)}</span></span>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead className="bg-bg text-text-secondary">
                          <tr>
                            <th className="px-4 py-2 text-left" title="Número de expediente">Código</th>
                            <th className="px-4 py-2 text-left" title="Nombre del trabajador">Empleado</th>
                            <th className="px-4 py-2 text-left hidden md:table-cell" title="NIT o Carnet de Identidad">NIT/Carnet</th>
                            <th className="px-4 py-2 text-right hidden md:table-cell" title="Tasa por hora">Tasa $/h</th>
                            <th className="px-4 py-2 text-right hidden lg:table-cell" title="Horas trabajadas y días a cobrar">Horas/Días</th>
                            <th className="px-4 py-2 text-right" title="Bonificación o estímulo">BON</th>
                            <th className="px-4 py-2 text-right" title="Horas extra del período">H. Extra</th>
                            <th className="px-4 py-2 text-right" title="Salario base + horas extra + bonificación + vacaciones">Bruto</th>
                            <th className="px-4 py-2 text-right hidden md:table-cell" title="Base sobre la que se aplica IIP (0,00 para socios)">Base Imponible</th>
                            <th className="px-4 py-2 text-right" title="Impuesto sobre los Ingresos Personales">IIP</th>
                            <th className="px-4 py-2 text-right" title="CESS / Contribución especial">CESS/Contrib.</th>
                            <th className="px-4 py-2 text-right" title="Anticipo + cuota de préstamo + otras deducciones">RET</th>
                            <th className="px-4 py-2 text-right" title="Salario devengado a cobrar">Salario Devengado</th>
                            <th className="px-4 py-2 text-right" title="Saldo acumulado de vacaciones">Vac. Acum.</th>
                            <th className="px-4 py-2 text-center" title="Acciones">Acciones</th>
                          </tr>
                        </thead>
                        <tbody ref={hrTbodyRef} className="divide-y divide-border">
                          {entries.map(entry => {
                            const employee = employees.find(e => e.id === entry.employee_id);
                            const isPartner = employee?.person_type === 'partner';
                            const ret = (entry.advances ?? 0) + (entry.loan_deduction ?? 0) + (entry.other_deductions ?? 0);
                            const vacBalance = employee?.vacation_balance ?? 0;
                            return (
                            <tr key={entry.id} className="hover:bg-bg/50">
                              <td className="px-4 py-2 text-text-secondary">{employee?.expediente ? `#${employee.expediente}` : '—'}</td>
                              <td className="px-4 py-2 font-medium">
                                <span className="flex items-center gap-2">
                                  {entry.employee_name}
                                  {isPartner && <Badge variant="warning" size="sm">Socio</Badge>}
                                </span>
                              </td>
                              <td className="px-4 py-2 text-text-secondary hidden md:table-cell">{employee?.nit_id || '-'}</td>
                              <td className="px-4 py-2 text-right text-text-secondary hidden md:table-cell">{(entry.hourly_rate ?? 0).toFixed(2)}</td>
                              <td className="px-4 py-2 text-right text-text-secondary hidden lg:table-cell">{(entry.worked_hours ?? 0).toFixed(1)} h + {(entry.days_paid ?? 0).toFixed(0)} d</td>
                              <td className="px-4 py-2 text-right text-success">{(entry.bonus ?? 0) > 0 ? `+$${(entry.bonus ?? 0).toFixed(2)}` : '—'}</td>
                              <td className="px-4 py-2 text-right text-text-secondary">{(entry.overtime_hours ?? 0) > 0 ? `${(entry.overtime_hours ?? 0).toFixed(1)}h / $${(entry.overtime_pay ?? 0).toFixed(2)}` : '—'}</td>
                              <td className="px-4 py-2 text-right">
                                <span className="font-medium">${(entry.gross_salary ?? entry.earned_salary).toFixed(2)}</span>
                                {(entry.vacation_pay ?? 0) > 0 && <span className="block text-[10px] text-text-secondary">+${(entry.vacation_pay ?? 0).toFixed(2)} vac</span>}
                              </td>
                              <td className="px-4 py-2 text-right text-text-secondary hidden md:table-cell">${(entry.taxable_base ?? 0).toFixed(2)}</td>
                              <td className="px-4 py-2 text-right text-danger">${(entry.tax_amount ?? 0).toFixed(2)}</td>
                              <td className="px-4 py-2 text-right text-danger">${(entry.special_contribution ?? 0).toFixed(2)}</td>
                              <td className="px-4 py-2 text-right text-danger">{ret > 0 ? `-$${ret.toFixed(2)}` : '0,00'}</td>
                              <td className="px-4 py-2 text-right font-bold text-success">${(entry.earned_salary ?? 0).toFixed(2)}</td>
                              <td className={`px-4 py-2 text-right ${vacBalance > 210 ? 'text-warning font-semibold' : 'text-text-secondary'}`}>
                                {vacBalance > 210 ? (
                                  <span className="flex items-center justify-end gap-1" title="Saldo de vacaciones acumulado mayor a 210 días">
                                    {vacBalance.toFixed(1)} <AlertTriangle className="h-3 w-3" />
                                  </span>
                                ) : vacBalance.toFixed(1)}
                              </td>
                              <td className="px-4 py-2 text-center">
                                <div className="flex items-center justify-center gap-1">
                                  <button
                                    onClick={() => setPayslipEntry(entry)}
                                    className="flex items-center justify-center h-8 w-8 rounded-lg text-text-secondary hover:text-primary hover:bg-primary/10 transition-colors"
                                    title="Ver recibo de pago"
                                  >
                                    <Printer className="h-3.5 w-3.5" />
                                  </button>
                                  <button
                                    onClick={() => openConcepts(entry)}
                                    disabled={payrollApplied}
                                    className="flex items-center justify-center h-8 w-8 rounded-lg text-text-secondary hover:text-primary hover:bg-primary/10 transition-colors disabled:opacity-30"
                                    title="Editar conceptos"
                                  >
                                    <Calculator className="h-3.5 w-3.5" />
                                  </button>
                                  {entry.is_custom && (
                                    <button
                                      onClick={async () => {
                                        try {
                                          const store = useDatabaseStore.getState();
                                          await store.regeneratePayrollEntry(entry.id);
                                          await store.getPayrollEntries(payrollMonth.month, payrollMonth.year);
                                          toast.success('Valores regenerados');
                                        } catch (err) {
                                          toast.error((err as Error).message);
                                        }
                                      }}
                                      disabled={payrollApplied}
                                      className="flex items-center justify-center h-8 w-8 rounded-lg text-text-secondary hover:text-primary hover:bg-primary/10 transition-colors disabled:opacity-30"
                                      title="Regenerar valores por defecto"
                                    >
                                      <RefreshCw className="h-3.5 w-3.5" />
                                    </button>
                                  )}
                                </div>
                              </td>
                            </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                );
              })}

              <PaginationControls page={payrollPage} total={payrollEntries.length} itemsPerPage={20} onPageChange={setPayrollPage} />

              <div className="rounded-xl border border-primary bg-primary/5 p-4 space-y-2">
                <div className="flex justify-between text-sm">
                  <span title="Suma del Impuesto sobre los Ingresos Personales">Total IIP</span>
                  <span className="font-semibold text-danger">${payrollEntries.reduce((sum, e) => sum + (e.tax_amount ?? 0), 0).toFixed(2)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span title="Suma de la CESS / contribución especial">Total CESS</span>
                  <span className="font-semibold text-danger">${payrollEntries.reduce((sum, e) => sum + (e.special_contribution ?? 0), 0).toFixed(2)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span title="Suma de la provisión mensual de vacaciones (base − devengado)">Total Provisión de Vacaciones</span>
                  <span className="font-semibold text-text-secondary">${payrollEntries.reduce((sum, e) => sum + Math.max(0, (e.vacation_base ?? 0) - e.earned_salary), 0).toFixed(2)}</span>
                </div>
                {payrollEntries.some(e => (e.overtime_pay ?? 0) > 0) && (
                  <div className="flex justify-between text-sm">
                    <span>Total Horas Extra</span>
                    <span className="font-semibold text-text-secondary">${payrollEntries.reduce((sum, e) => sum + (e.overtime_pay ?? 0), 0).toFixed(2)}</span>
                  </div>
                )}
                {payrollEntries.some(e => (e.bonus ?? 0) > 0) && (
                  <div className="flex justify-between text-sm">
                    <span>Total Bonificaciones</span>
                    <span className="font-semibold text-text-secondary">${payrollEntries.reduce((sum, e) => sum + (e.bonus ?? 0), 0).toFixed(2)}</span>
                  </div>
                )}
                {payrollEntries.some(e => (e.advances ?? 0) > 0) && (
                  <div className="flex justify-between text-sm">
                    <span>Total Anticipos</span>
                    <span className="font-semibold text-text-secondary">${payrollEntries.reduce((sum, e) => sum + (e.advances ?? 0), 0).toFixed(2)}</span>
                  </div>
                )}
                {payrollEntries.some(e => ((e.loan_deduction ?? 0) + (e.other_deductions ?? 0)) > 0) && (
                  <div className="flex justify-between text-sm">
                    <span>Total RET</span>
                    <span className="font-semibold text-text-secondary">${payrollEntries.reduce((sum, e) => sum + ((e.loan_deduction ?? 0) + (e.other_deductions ?? 0)), 0).toFixed(2)}</span>
                  </div>
                )}
                <hr className="border-border" />
                <div className="flex justify-between">
                  <span className="font-semibold" title="Total a pagar a los trabajadores">Total Salario Devengado (a Pagar)</span>
                  <span className="text-xl font-bold text-primary">
                    ${payrollEntries.reduce((sum, e) => sum + (e.earned_salary ?? 0), 0).toFixed(2)}
                  </span>
                </div>
              </div>
            </div>
          ) : (
            <div className="rounded-xl border border-border bg-surface p-12 text-center">
              <Calculator className="h-12 w-12 text-text-secondary mx-auto mb-4" />
              <h3 className="text-lg font-semibold mb-2">No hay nómina generada</h3>
              <p className="text-text-secondary">Ajusta la captación y haz clic en "Generar Nómina"</p>
            </div>
          )}
</div>
      )}

      {activeTab === 'deducciones' && (
        <div className="grid gap-6 lg:grid-cols-3">
          <div className="rounded-xl border border-border bg-surface p-6 shadow-sm lg:col-span-1 h-fit">
            <div className="mb-6 flex items-center gap-3 border-b border-border pb-4">
              <div className="rounded-lg bg-primary/10 p-2 text-primary">
                <ShieldCheck className="h-5 w-5" />
              </div>
              <h2 className="text-lg font-semibold text-text">Nuevo Préstamo / Deducción</h2>
              <Button variant="ghost" size="icon" className="ml-auto" onClick={() => setHelpModal('deducciones')} title="Guía de deducciones">
                <HelpCircle className="h-4 w-4" />
              </Button>
            </div>
            <form onSubmit={async (e) => {
              e.preventDefault();
              if (!newLoan.employee_id) { toast.error('Selecciona un empleado'); return; }
              if (!newLoan.total_amount || newLoan.total_amount <= 0) { toast.error('El monto total debe ser mayor que 0'); return; }
              if (!newLoan.monthly_payment || newLoan.monthly_payment <= 0) { toast.error('La cuota mensual debe ser mayor que 0'); return; }
              if (newLoan.monthly_payment > newLoan.total_amount) { toast.error('La cuota mensual no puede superar el monto total'); return; }
              setIsCreatingLoan(true);
              try {
                await addLoan({
                  employee_id: newLoan.employee_id,
                  total_amount: newLoan.total_amount,
                  monthly_payment: newLoan.monthly_payment,
                  start_date: newLoan.start_date || undefined,
                  deduction_type: newLoan.deduction_type,
                  reason: newLoan.reason || undefined,
                });
                setNewLoan({ employee_id: '', deduction_type: 'prestamo', reason: '', total_amount: 0, monthly_payment: 0, start_date: '' });
                toast.success('Deducción registrada');
              } catch (err) {
                toast.error((err as Error).message);
              } finally {
                setIsCreatingLoan(false);
              }
            }} className="space-y-4">
              <div className="space-y-2">
                <Label>Empleado *</Label>
                <select required value={newLoan.employee_id} onChange={e => setNewLoan({ ...newLoan, employee_id: e.target.value })} className="flex h-10 w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm text-text focus:outline-none focus:ring-2 focus:ring-primary/50">
                  <option value="">Seleccionar empleado...</option>
                  {employees.map(emp => <option key={emp.id} value={emp.id}>{emp.name}{emp.expediente != null ? ` (#${emp.expediente})` : ''}</option>)}
                </select>
              </div>
              <div className="space-y-2">
                <Label>Tipo de Deducción *</Label>
                <select value={newLoan.deduction_type} onChange={e => setNewLoan({ ...newLoan, deduction_type: e.target.value as EmployeeLoan['deduction_type'] })} className="flex h-10 w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm text-text focus:outline-none focus:ring-2 focus:ring-primary/50">
                  <option value="prestamo">Préstamo</option>
                  <option value="credito_bancario">Crédito bancario</option>
                  <option value="inasistencia">Inasistencia</option>
                  <option value="sancion">Sanción</option>
                  <option value="rotura_equipo">Rotura de equipo</option>
                  <option value="otro">Otro</option>
                </select>
              </div>
              <div className="space-y-2">
                <Label>Criterio / Motivo</Label>
                <Input placeholder="Ej: crédito bancario BPA" value={newLoan.reason} onChange={e => setNewLoan({ ...newLoan, reason: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label>Monto Total *</Label>
                <Input type="number" step="0.01" min="0" required value={newLoan.total_amount || ''} onChange={e => setNewLoan({ ...newLoan, total_amount: Number(e.target.value) })} />
              </div>
              <div className="space-y-2">
                <Label>Cuota Mensual *</Label>
                <Input type="number" step="0.01" min="0" required value={newLoan.monthly_payment || ''} onChange={e => setNewLoan({ ...newLoan, monthly_payment: Number(e.target.value) })} />
              </div>
              <div className="space-y-2">
                <Label>Fecha de Inicio (opcional)</Label>
                <Input type="date" value={newLoan.start_date} onChange={e => setNewLoan({ ...newLoan, start_date: e.target.value })} />
              </div>
              <Button type="submit" disabled={isCreatingLoan} className="w-full gap-2">
                {isCreatingLoan ? <RefreshCw className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
                {isCreatingLoan ? 'Registrando...' : 'Registrar Deducción'}
              </Button>
            </form>
          </div>

          <div className="rounded-xl border border-border bg-surface p-6 shadow-sm lg:col-span-2">
            <div className="mb-6 flex items-center gap-3 border-b border-border pb-4">
              <h2 className="text-lg font-semibold text-text">Deducciones / Retenciones de Personal</h2>
              <span className="ml-auto rounded-full bg-surface-hover px-2.5 py-0.5 text-xs font-medium text-text-secondary">{employeeLoans.length}</span>
            </div>
            <p className="mb-4 rounded-lg bg-primary/5 border border-primary/20 p-3 text-xs text-text-secondary">
              Las deducciones activas descuentan su cuota mensual automáticamente al generar la nómina (columna RET). El saldo se reduce solo en la primera generación del mes.
            </p>
            {employeeLoans.length === 0 ? (
              <div className="py-10 text-center text-text-secondary">No hay deducciones registradas.</div>
            ) : (
              <div className="space-y-2">
                {employeeLoans.map(loan => {
                  const emp = employees.find(e => e.id === loan.employee_id);
                  const typeLabels: Record<string, string> = { prestamo: 'Préstamo', credito_bancario: 'Crédito bancario', inasistencia: 'Inasistencia', sancion: 'Sanción', rotura_equipo: 'Rotura de equipo', otro: 'Otro' };
                  const paid = loan.status === 'paid';
                  return (
                    <div key={loan.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-bg p-4">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="font-semibold text-text">{emp?.name || '—'}</p>
                          {loan.deduction_type === 'prestamo' && <Badge variant="info" size="sm">Préstamo</Badge>}
                          {loan.deduction_type === 'credito_bancario' && <Badge variant="warning" size="sm">Crédito bancario</Badge>}
                          {loan.deduction_type === 'inasistencia' && <Badge variant="danger" size="sm">Inasistencia</Badge>}
                          {loan.deduction_type === 'sancion' && <Badge variant="danger" size="sm">Sanción</Badge>}
                          {loan.deduction_type === 'rotura_equipo' && <Badge variant="danger" size="sm">Rotura de equipo</Badge>}
                          {loan.deduction_type === 'otro' && <Badge size="sm">Otro</Badge>}
                        </div>
                        {loan.reason && <p className="mt-1 text-xs text-text-secondary">{loan.reason}</p>}
                        <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-text-secondary">
                          <span>Monto Total: <span className="font-medium text-text">${(loan.total_amount ?? 0).toFixed(2)}</span></span>
                          <span>Cuota Mensual: <span className="font-medium text-text">${(loan.monthly_payment ?? 0).toFixed(2)}</span></span>
                          <span>Saldo: <span className={`font-semibold ${loan.balance > 0 ? 'text-warning' : 'text-success'}`}>${(loan.balance ?? 0).toFixed(2)}</span></span>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <Badge variant={paid ? 'success' : 'warning'} size="sm">
                          <span className="inline-flex items-center gap-1">
                            {paid ? <><CircleCheck className="h-3.5 w-3.5" /> Pagado</> : <><Clock3 className="h-3.5 w-3.5" /> Activo</>}
                          </span>
                        </Badge>
                        {!paid && (
                          <button
                            onClick={async () => {
                              try {
                                await payLoanInstallment(loan.id);
                                toast.success('Cuota registrada');
                              } catch (err) {
                                toast.error((err as Error).message);
                              }
                            }}
                            className="flex h-9 w-9 items-center justify-center rounded-lg text-text-secondary hover:text-success hover:bg-success/10 transition-colors"
                            title="Registrar pago de cuota"
                          >
                            <CircleCheck className="h-4 w-4" />
                          </button>
                        )}
                        <button
                          onClick={() => setConfirmDeleteLoan(loan)}
                          className="flex h-9 w-9 items-center justify-center rounded-lg text-text-secondary hover:text-danger hover:bg-danger/10 transition-colors"
                          title="Eliminar deducción"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {activeTab === 'impuestos' && (
        <div className="max-w-4xl space-y-6">
          <div className="rounded-xl border border-border bg-surface p-6 shadow-sm">
            <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="rounded-lg bg-primary/10 p-2 text-primary">
                  <FileText className="h-5 w-5" />
                </div>
                <div>
                  <h2 className="text-lg font-semibold text-text">Impuestos de la Empresa — Seguridad Social patronal</h2>
                  <p className="text-sm text-text-secondary" title="Aportación patronal: 14% de la base de cotización">Aportación patronal: 14% de la base de cotización (incluye provisión de vacaciones 9.09%)</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <select className="h-10 rounded-lg border border-border bg-bg px-3 py-2 text-sm" value={payrollMonth.month} onChange={e => setPayrollMonth({ ...payrollMonth, month: Number(e.target.value) })}>
                  {Array.from({ length: 12 }, (_, i) => (
                    <option key={i + 1} value={i + 1}>{new Date(0, i).toLocaleString('es', { month: 'long' }).charAt(0).toUpperCase() + new Date(0, i).toLocaleString('es', { month: 'long' }).slice(1)}</option>
                  ))}
                </select>
                <select className="h-10 rounded-lg border border-border bg-bg px-3 py-2 text-sm" value={payrollMonth.year} onChange={e => setPayrollMonth({ ...payrollMonth, year: Number(e.target.value) })}>
                  {Array.from({ length: 67 }, (_, i) => 2024 + i).map(y => <option key={y} value={y}>{y}</option>)}
                </select>
              </div>
            </div>
          </div>

          {payrollEntries.length === 0 ? (
            <div className="rounded-xl border border-border bg-surface p-12 text-center">
              <FileText className="h-12 w-12 text-text-secondary mx-auto mb-4" />
              <p className="text-text-secondary">No hay nómina generada para este mes. Genera la nómina primero.</p>
            </div>
          ) : (
            <div className="rounded-xl border border-border bg-surface p-6 shadow-sm">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-bg text-text-secondary">
                    <tr>
                      <th className="px-4 py-2 text-left">Empleado</th>
                      <th className="px-4 py-2 text-left hidden md:table-cell">Departamento</th>
                      <th className="px-4 py-2 text-right" title="Base de cotización (vacation_base, incluye provisión 9.09%)">Base Cotización</th>
                      <th className="px-4 py-2 text-right" title="Aportación patronal: 14% de la base de cotización">SS Empleador (14%)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {payrollEntries.map(entry => {
                      const employee = employees.find(e => e.id === entry.employee_id);
                      return (
                        <tr key={entry.id} className="hover:bg-bg/50">
                          <td className="px-4 py-2 font-medium">
                            {entry.employee_name}
                            {employee?.expediente != null && <span className="ml-1 text-xs text-text-secondary">#{employee.expediente}</span>}
                          </td>
                          <td className="px-4 py-2 text-text-secondary hidden md:table-cell">{entry.employee_category}</td>
                          <td className="px-4 py-2 text-right">${(entry.vacation_base ?? 0).toFixed(2)}</td>
                          <td className="px-4 py-2 text-right font-semibold text-danger">${(entry.employer_contribution ?? 0).toFixed(2)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className="mt-4 rounded-xl border border-primary bg-primary/5 p-4 flex justify-between">
                <span className="font-semibold">Total SS Empleador del mes</span>
                <span className="text-xl font-bold text-primary">${payrollEntries.reduce((s, e) => s + (e.employer_contribution ?? 0), 0).toFixed(2)}</span>
              </div>
            </div>
          )}
        </div>
      )}

      {activeTab === 'liquidaciones' && (
        <div className="grid gap-6 lg:grid-cols-3">
          <div className="rounded-xl border border-border bg-surface p-6 shadow-sm lg:col-span-1 h-fit">
            <div className="mb-6 flex items-center gap-3 border-b border-border pb-4">
              <div className="rounded-lg bg-primary/10 p-2 text-primary">
                <Clock3 className="h-5 w-5" />
              </div>
              <h2 className="text-lg font-semibold text-text">Liquidación al Cese</h2>
              <Button variant="ghost" size="icon" className="ml-auto" onClick={() => setHelpModal('liquidaciones')} title="Guía de liquidaciones">
                <HelpCircle className="h-4 w-4" />
              </Button>
            </div>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Seleccionar empleado…</Label>
                <select value={liqEmployeeId} onChange={e => { setLiqEmployeeId(e.target.value); setLiqResult(null); }} className="flex h-10 w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm text-text focus:outline-none focus:ring-2 focus:ring-primary/50">
                  <option value="">Seleccionar empleado...</option>
                  {employees.filter(e => e.person_type !== 'partner').map(emp => <option key={emp.id} value={emp.id}>{emp.name}</option>)}
                </select>
                <p className="text-xs text-text-secondary">Solo empleados asalariados generan liquidación.</p>
              </div>
              <div className="space-y-2">
                <Label>Fecha de Cese</Label>
                <Input type="date" value={liqEndDate} onChange={e => { setLiqEndDate(e.target.value); setLiqResult(null); }} />
              </div>
              <div className="space-y-2">
                <Label>Días de Vacaciones Tomados</Label>
                <Input type="number" min="0" step="0.5" value={liqVacationTaken || ''} onChange={e => { setLiqVacationTaken(Number(e.target.value)); setLiqResult(null); }} />
              </div>
              <Button className="w-full gap-2" onClick={() => {
                const emp = employees.find(e => e.id === liqEmployeeId);
                if (!emp) { toast.error('Selecciona un empleado'); return; }
                if (!emp.hire_date) { toast.error('El empleado no tiene fecha de contratación'); return; }
                if (!emp.salary || emp.salary <= 0) { toast.error('El empleado no tiene salario definido'); return; }
                try {
                  const result = calcularLiquidacion({
                    baseSalary: emp.salary,
                    hireDate: emp.hire_date,
                    endDate: liqEndDate,
                    vacationTaken: liqVacationTaken,
                    contractType: emp.contract_type || 'indefinite',
                  });
                  setLiqResult(result);
                } catch (err) {
                  toast.error((err as Error).message || 'Error al calcular la liquidación');
                }
              }}><Calculator className="h-4 w-4" /> Calcular Liquidación</Button>

              {liqResult && (() => {
                const emp = employees.find(e => e.id === liqEmployeeId);
                return (
                  <div className="mt-2 rounded-xl border border-border bg-bg p-4 space-y-2 text-sm">
                    <p className="font-semibold text-text">Resultado — {emp?.name}</p>
                    <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-text-secondary">
                      <span>Meses trabajados: <span className="text-text">{liqResult.monthsWorked.toFixed(1)}</span></span>
                      <span>Vac. acumuladas: <span className="text-text">{liqResult.vacationAccumulated.toFixed(1)} d</span></span>
                      <span>Vac. pendientes: <span className="text-text">{liqResult.vacationPending.toFixed(1)} d</span></span>
                      <span>Pago vacaciones: <span className="text-text">${liqResult.vacationPay.toFixed(2)}</span></span>
                      {liqResult.severanceMonths > 0 && <span>Auxilio de despido: <span className="text-text">{liqResult.severanceMonths.toFixed(1)} meses (${liqResult.severancePay.toFixed(2)})</span></span>}
                      {liqResult.noticeDays > 0 && <span>Preaviso: <span className="text-text">{liqResult.noticeDays} días (${liqResult.noticePay.toFixed(2)})</span></span>}
                    </div>
                    <hr className="border-border" />
                    <div className="flex justify-between text-xs"><span className="text-text-secondary">Total bruto</span><span>${liqResult.grossTotal.toFixed(2)}</span></div>
                    <div className="flex justify-between text-xs"><span className="text-text-secondary">CESS</span><span className="text-danger">-${liqResult.cess.toFixed(2)}</span></div>
                    <div className="flex justify-between text-xs"><span className="text-text-secondary">IIP</span><span className="text-danger">-${liqResult.iip.toFixed(2)}</span></div>
                    <div className="flex justify-between font-bold"><span>Neto a pagar</span><span className="text-success">${liqResult.netTotal.toFixed(2)}</span></div>
                    <Button size="sm" className="w-full gap-2" onClick={async () => {
                      if (!emp) return;
                      try {
                        await saveLiquidation({
                          employee_id: emp.id,
                          employee_name: emp.name,
                          base_salary: emp.salary,
                          hire_date: emp.hire_date,
                          end_date: liqEndDate,
                          months_worked: liqResult.monthsWorked,
                          vacation_accumulated: liqResult.vacationAccumulated,
                          vacation_taken: liqResult.vacationTaken,
                          vacation_pending: liqResult.vacationPending,
                          vacation_pay: liqResult.vacationPay,
                          severance_months: liqResult.severanceMonths,
                          severance_pay: liqResult.severancePay,
                          notice_days: liqResult.noticeDays,
                          notice_pay: liqResult.noticePay,
                          gross_total: liqResult.grossTotal,
                          cess: liqResult.cess,
                          iip: liqResult.iip,
                          net_total: liqResult.netTotal,
                        });
                        const store = useDatabaseStore.getState();
                        await store.getPayrollLiquidations();
                        toast.success('Liquidación guardada');
                      } catch (err) {
                        toast.error((err as Error).message);
                      }
                    }}><Save className="h-4 w-4" /> Guardar Liquidación</Button>
                  </div>
                );
              })()}
            </div>
          </div>

          <div className="rounded-xl border border-border bg-surface p-6 shadow-sm lg:col-span-2">
            <div className="mb-6 flex items-center gap-3 border-b border-border pb-4">
              <h2 className="text-lg font-semibold text-text">Historial de Liquidaciones</h2>
              <span className="ml-auto rounded-full bg-surface-hover px-2.5 py-0.5 text-xs font-medium text-text-secondary">{payrollLiquidations.length}</span>
            </div>
            {payrollLiquidations.length === 0 ? (
              <div className="py-10 text-center text-text-secondary">No hay liquidaciones guardadas.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-bg text-text-secondary">
                    <tr>
                      <th className="px-4 py-2 text-left">Empleado</th>
                      <th className="px-4 py-2 text-left hidden md:table-cell">Fecha Cese</th>
                      <th className="px-4 py-2 text-right hidden md:table-cell">Bruto</th>
                      <th className="px-4 py-2 text-right hidden md:table-cell">CESS</th>
                      <th className="px-4 py-2 text-right hidden md:table-cell">IIP</th>
                      <th className="px-4 py-2 text-right">Neto</th>
                      <th className="px-4 py-2 text-center">Acciones</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {payrollLiquidations.map(liq => (
                      <tr key={liq.id} className="hover:bg-bg/50">
                        <td className="px-4 py-2 font-medium">{liq.employee_name}</td>
                        <td className="px-4 py-2 text-text-secondary hidden md:table-cell">{liq.end_date ? new Date(liq.end_date).toLocaleDateString('es-ES') : '—'}</td>
                        <td className="px-4 py-2 text-right text-text-secondary hidden md:table-cell">${(liq.gross_total ?? 0).toFixed(2)}</td>
                        <td className="px-4 py-2 text-right text-danger hidden md:table-cell">${(liq.cess ?? 0).toFixed(2)}</td>
                        <td className="px-4 py-2 text-right text-danger hidden md:table-cell">${(liq.iip ?? 0).toFixed(2)}</td>
                        <td className="px-4 py-2 text-right font-bold text-success">${(liq.net_total ?? 0).toFixed(2)}</td>
                        <td className="px-4 py-2 text-center">
                          <button
                            onClick={() => setConfirmDeleteLiquidation(liq.id)}
                            className="flex h-8 w-8 items-center justify-center rounded-lg text-text-secondary hover:text-danger hover:bg-danger/10 transition-colors"
                            title="Eliminar liquidación"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

{activeTab === 'configuracion' && (
        <div className="max-w-2xl space-y-6">
          <div className="rounded-xl border border-border bg-surface p-6 shadow-sm">
            <div className="mb-6 flex items-center gap-3 border-b border-border pb-4">
              <div className="rounded-lg bg-primary/10 p-2 text-primary">
                <Settings className="h-5 w-5" />
              </div>
              <h2 className="text-lg font-semibold text-text">Parámetros de Nómina</h2>
              <Button variant="ghost" size="icon" className="ml-auto" onClick={() => setHelpModal('configuracion')} title="Guía de configuración">
                <HelpCircle className="h-4 w-4" />
              </Button>
            </div>
            {payrollConfig ? (
              <div className="space-y-5">
                <div className="space-y-2">
                  <Label>Base Exenta Mensual ($)</Label>
                  <Input
                    type="number"
                    value={configBaseExenta}
                    onChange={e => setConfigBaseExenta(Number(e.target.value))}
                    onBlur={() => {
                      const { updatePayrollConfig } = useDatabaseStore.getState();
                      updatePayrollConfig({ tax_exemption_base: configBaseExenta });
                      toast.success('Base exenta actualizada', { duration: 1500 });
                    }}
                  />
                  <p className="text-xs text-text-secondary">Primer tramo exento de IIP según Res. 41/2023 (defecto 3,260.00)</p>
                </div>

                <div className="space-y-2">
                  <Label>Fondo de Tiempo Estimado (horas/mes)</Label>
                  <Input
                    type="number"
                    step="0.1"
                    value={configMonthlyHours}
                    onChange={e => setConfigMonthlyHours(Number(e.target.value))}
                    onBlur={() => {
                      const { updatePayrollConfig } = useDatabaseStore.getState();
                      updatePayrollConfig({ monthly_hours: configMonthlyHours || 190.6 });
                      toast.success('Fondo de tiempo actualizado', { duration: 1500 });
                    }}
                  />
                  <p className="text-xs text-text-secondary">Se usa para calcular la tasa horaria (defecto 190.6). Ej: $26,000 ÷ 190.6 h = $136.41/h.</p>
                </div>

                <div className="space-y-2">
                  <Label>Acumulación de Vacaciones (días/mes)</Label>
                  <Input
                    type="number"
                    step="0.1"
                    value={configAccrualDays}
                    onChange={e => setConfigAccrualDays(Number(e.target.value))}
                    onBlur={() => {
                      const { updatePayrollConfig } = useDatabaseStore.getState();
                      updatePayrollConfig({ vacation_accrual_days: configAccrualDays || 2.5 });
                      toast.success('Acumulación de vacaciones actualizada', { duration: 1500 });
                    }}
                  />
                  <p className="text-xs text-text-secondary">Días que se acumulan por mes trabajado (defecto 2.5 — Ley 116, 30 días/año).</p>
                </div>
              </div>
            ) : (
              <div className="flex justify-center py-8"><RefreshCw className="h-6 w-6 animate-spin text-primary" /></div>
            )}
          </div>

          <div className="rounded-xl border border-border bg-surface p-6 shadow-sm">
            <div className="mb-4 flex items-center gap-3 border-b border-border pb-4">
              <div className="rounded-lg bg-primary/10 p-2 text-primary">
                <BookOpen className="h-5 w-5" />
              </div>
              <h3 className="text-lg font-semibold text-text">Bases legales aplicables</h3>
            </div>
            <ul className="space-y-2 text-xs text-text-secondary list-disc pl-5">
              <li>IIP: escala progresiva Res. 41/2023 (0% exento; 3%–20% por tramo) sobre el salario bruto.</li>
              <li>CESS: 5% hasta $15,000 y 10% sobre el exceso (Ley 164/2023).</li>
              <li>Seguridad Social patronal: 14% sobre la base de cotización con provisión de vacaciones del 9.09%.</li>
              <li>Vacaciones: 30 días/año (2.5 días por mes trabajado, Ley 116).</li>
              <li>Socios (DL 92/2024): aportan el 20% de su base de contribución; no generan IIP mensual ni provisión de vacaciones.</li>
              <li className="text-warning">Verifique posibles cambios normativos con la MFP/ONAT.</li>
            </ul>
          </div>
        </div>
      )}
        
        {activeTab === 'biblioteca' && (<>
          <div className="grid gap-6 lg:grid-cols-2">
            {/* PNO */}
            <div className="rounded-xl border border-border bg-surface p-6 shadow-sm">
              <div className="mb-6 flex items-center gap-3 border-b border-border pb-4">
                <div className="rounded-lg bg-amber-500/10 p-2 text-amber-600">
                  <FileText className="h-5 w-5" />
                </div>
                <h2 className="text-lg font-semibold text-text">PNO</h2>
                <span className="ml-auto text-xs text-text-secondary">Procedimientos Normalizados de Operación</span>
              </div>
              
              {orgDocsData.PNO ? (
                <div className="space-y-4">
                  <div className="rounded-lg bg-bg p-4 border border-border">
                    <p className="text-sm text-text-secondary mb-3">Documento actual:</p>
                    <a 
                      href={orgDocsData.PNO} 
                      target="_blank" 
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-2 text-primary hover:underline"
                    >
                      <Eye className="h-4 w-4" />
                      Ver documento
                    </a>
                  </div>
                  <Button 
                    variant="outline" 
                    className="w-full"
                    onClick={() => setOrgDocModal('PNO')}
                  >
                    <Upload className="h-4 w-4 mr-2" />
                    Reemplazar documento
                  </Button>
                </div>
              ) : (
                <div className="text-center py-8">
                  <FileText className="h-12 w-12 mx-auto mb-3 text-text-secondary opacity-50" />
                  <p className="text-sm text-text-secondary mb-4">No hay documento PNO cargado</p>
                  <Button onClick={() => setOrgDocModal('PNO')}>
                    <Upload className="h-4 w-4 mr-2" />
                    Subir documento PNO
                  </Button>
                </div>
              )}
            </div>
            
            {/* Reglamento del Negocio */}
            <div className="rounded-xl border border-border bg-surface p-6 shadow-sm">
              <div className="mb-6 flex items-center gap-3 border-b border-border pb-4">
                <div className="rounded-lg bg-purple-500/10 p-2 text-purple-600">
                  <BookOpen className="h-5 w-5" />
                </div>
                <h2 className="text-lg font-semibold text-text">Reglamento del Negocio</h2>
                <span className="ml-auto text-xs text-text-secondary">Normativas internas</span>
              </div>
              
              {orgDocsData.REGLAMENTO ? (
                <div className="space-y-4">
                  <div className="rounded-lg bg-bg p-4 border border-border">
                    <p className="text-sm text-text-secondary mb-3">Documento actual:</p>
                    <a 
                      href={orgDocsData.REGLAMENTO} 
                      target="_blank" 
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-2 text-primary hover:underline"
                    >
                      <Eye className="h-4 w-4" />
                      Ver documento
                    </a>
                  </div>
                  <Button 
                    variant="outline" 
                    className="w-full"
                    onClick={() => setOrgDocModal('REGLAMENTO')}
                  >
                    <Upload className="h-4 w-4 mr-2" />
                    Reemplazar documento
                  </Button>
                </div>
              ) : (
                <div className="text-center py-8">
                  <BookOpen className="h-12 w-12 mx-auto mb-3 text-text-secondary opacity-50" />
                  <p className="text-sm text-text-secondary mb-4">No hay documento de reglamento cargado</p>
                  <Button onClick={() => setOrgDocModal('REGLAMENTO')}>
                    <Upload className="h-4 w-4 mr-2" />
                    Subir reglamento
                  </Button>
                </div>
              )}
            </div>
          </div>

          {/* Biblioteca general */}
          <div className="rounded-xl border border-border bg-surface p-6 shadow-sm">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3 border-b border-border pb-4">
              <div className="flex items-center gap-3">
                <div className="rounded-lg bg-primary/10 p-2 text-primary">
                  <FolderOpen className="h-5 w-5" />
                </div>
                <h3 className="text-lg font-semibold text-text">Biblioteca general</h3>
              </div>
              <div className="flex items-center gap-2">
                <select
                  value={uploadDocType}
                  onChange={e => setUploadDocType(e.target.value as 'MANUAL' | 'REGLAMENTO' | 'PNO')}
                  className="h-9 rounded-lg border border-border bg-bg px-3 py-1.5 text-sm"
                >
                  <option value="MANUAL">Manual</option>
                  <option value="REGLAMENTO">Reglamento Interno</option>
                  <option value="PNO">PNO</option>
                </select>
                <input
                  ref={fileInputRef}
                  type="file"
                  className="hidden"
                  onChange={e => { if (e.target.files && e.target.files[0]) setSelectedFile(e.target.files[0]); }}
                />
                <Button size="sm" variant="outline" onClick={() => fileInputRef.current?.click()}>Seleccionar</Button>
                <Button size="sm" onClick={handleUploadDoc} disabled={!selectedFile || isUploading}>
                  {isUploading ? 'Subiendo...' : 'Subir'}
                </Button>
              </div>
            </div>
            {selectedFile && <p className="mb-3 text-xs text-text-secondary">Archivo: {selectedFile.name} ({formatFileSize(selectedFile.size)})</p>}
            {hrDocuments.length === 0 ? (
              <p className="py-6 text-center text-sm text-text-secondary">No hay documentos en la biblioteca general.</p>
            ) : (
              <div className="space-y-4">
                {(['MANUAL', 'REGLAMENTO', 'PNO'] as const).map(type => {
                  const docs = hrDocuments.filter(d => d.doc_type === type);
                  if (docs.length === 0) return null;
                  const Icon = DOC_TYPE_ICONS[type] || FileText;
                  return (
                    <div key={type}>
                      <p className="mb-2 text-sm font-semibold text-text">{DOC_TYPE_PLURALS[type]} ({docs.length})</p>
                      <div className="space-y-2">
                        {docs.map(doc => (
                          <div key={doc.id} className="flex items-center justify-between gap-3 rounded-lg border border-border bg-bg p-3 group">
                            <div className="flex items-center gap-3 min-w-0">
                              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                                <Icon className="h-4 w-4 text-primary" />
                              </div>
                              <div className="min-w-0">
                                <p className="truncate text-sm font-medium text-text">{doc.name}</p>
                                <p className="text-xs text-text-secondary">{formatFileSize(doc.file_size || 0)} · {new Date(doc.created_at).toLocaleDateString('es-ES')}</p>
                              </div>
                            </div>
                            <div className="flex items-center gap-1 shrink-0">
                              <a href={doc.file_url} target="_blank" rel="noopener noreferrer" title="Ver documento" className="flex h-8 w-8 items-center justify-center rounded-lg text-text-secondary hover:text-primary hover:bg-primary/10 transition-colors">
                                <Eye className="h-4 w-4" />
                              </a>
                              <a href={doc.file_url} download={doc.file_name} title="Descargar" className="flex h-8 w-8 items-center justify-center rounded-lg text-text-secondary hover:text-success hover:bg-success/10 transition-colors">
                                <Download className="h-4 w-4" />
                              </a>
                              <button onClick={() => handleDeleteDoc(doc)} title="Eliminar" className="flex h-8 w-8 items-center justify-center rounded-lg text-text-secondary hover:text-danger hover:bg-danger/10 transition-colors">
                                <Trash2 className="h-4 w-4" />
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </>)}
      
      {/* Biblioteca de Documentos - Modal para PNO y Reglamento */}
      {orgDocModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm modal-backdrop">
          <div className="w-full max-w-md rounded-2xl border border-border bg-surface p-6 shadow-2xl max-h-[90dvh] overflow-y-auto">
            <div className="mb-6 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="rounded-lg bg-primary/10 p-2 text-primary">
                  <FolderOpen className="h-5 w-5" />
                </div>
                <div>
                  <h2 className="text-lg font-bold text-text">
                    {orgDocModal === 'PNO' ? 'Procedimientos Normalizados de Operación (PNO)' : 'Reglamento del Negocio'}
                  </h2>
                </div>
              </div>
              <button onClick={() => { setOrgDocModal(null); setOrgDocFile(null); }} className="rounded-full p-2 text-text-secondary hover:bg-surface-hover hover:text-text transition-colors">
                <X className="h-5 w-5" />
              </button>
            </div>
            
            {orgDocsData[orgDocModal] ? (
              <div className="space-y-4">
                <div className="rounded-lg bg-bg p-4 border border-border">
                  <p className="text-sm text-text-secondary mb-2">Documento actual:</p>
                  <a 
                    href={orgDocsData[orgDocModal]!} 
                    target="_blank" 
                    rel="noopener noreferrer"
                    className="text-primary hover:underline flex items-center gap-2"
                  >
                    <Eye className="h-4 w-4" />
                    Ver documento
                  </a>
                </div>
                <p className="text-sm text-text-secondary">Para reemplazar, sube un nuevo archivo:</p>
              </div>
            ) : (
              <p className="text-sm text-text-secondary mb-4">No hay documento cargado. Sube uno nuevo:</p>
            )}
            
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Seleccionar archivo (PDF, imagen, etc.)</Label>
                <input
                  type="file"
                  accept="*"
                  className="block w-full text-sm text-text file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-primary/10 file:text-primary hover:file:bg-primary/20"
                  onChange={e => {
                    if (e.target.files && e.target.files[0]) {
                      setOrgDocFile(e.target.files[0]);
                    }
                  }}
                />
              </div>
              
              <div className="flex gap-3">
                <Button 
                  variant="outline" 
                  className="flex-1"
                  onClick={() => { setOrgDocModal(null); setOrgDocFile(null); }}
                  disabled={isUploadingOrgDoc}
                >
                  Cancelar
                </Button>
                <Button 
                  className="flex-1 gap-2"
                  onClick={async () => {
                    if (!orgDocFile) {
                      toast.error('Selecciona un archivo primero');
                      return;
                    }
                    
                    setIsUploadingOrgDoc(true);
                    try {
                      const docType = orgDocModal === 'PNO' ? 'pno' : 'reglamento';
                      const fileName = `${docType}-${Date.now()}-${orgDocFile.name.replace(/[^a-zA-Z0-9.]/g, '')}`;
                      
                      const { data: uploadData, error: uploadError } = await supabase.storage
                        .from('hr-documents')
                        .upload(fileName, orgDocFile);
                      
                      if (uploadError) {
                        throw new Error(uploadError.message);
                      }
                      
                      if (uploadData) {
                        const { data: urlData } = supabase.storage.from('hr-documents').getPublicUrl(fileName);
                        const docUrl = urlData.publicUrl;
                        
                        localStorage.setItem(`org_doc_${docType}`, docUrl);
                        toast.success('Documento subido exitosamente');
                        setOrgDocModal(null);
                        setOrgDocFile(null);
                      }
                    } catch (err: any) {
                      toast.error(err.message || 'Error al subir el documento');
                    } finally {
                      setIsUploadingOrgDoc(false);
                    }
                  }}
                  disabled={isUploadingOrgDoc || !orgDocFile}
                >
                  {isUploadingOrgDoc ? 'Subiendo...' : 'Subir Documento'}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modal Conceptos de Nómina */}
      {conceptsEntryId && (() => {
        const entry = payrollEntries.find(e => e.id === conceptsEntryId);
        if (!entry) return null;
        const employee = employees.find(e => e.id === entry.employee_id);
        const isPartner = employee?.person_type === 'partner';
        return (
          <Modal isOpen onClose={() => setConceptsEntryId(null)} title={`Conceptos de Nómina — ${entry.employee_name}`} description="El bruto = salario + horas extra + bonificación + pago de vacaciones… El neto = bruto − IIP − CESS − anticipo − cuota de préstamo − otras deducciones.">
            <div className="space-y-4">
              {!isPartner && (
                <>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-1">
                      <Label className="text-xs text-text-secondary">Horas Extra</Label>
                      <Input type="number" step="0.01" min="0" value={conceptsForm.overtime_hours || ''} onChange={e => setConceptsForm({ ...conceptsForm, overtime_hours: Number(e.target.value) })} />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs text-text-secondary">Tipo de Hora Extra</Label>
                      <select value={conceptsForm.overtime_type} onChange={e => setConceptsForm({ ...conceptsForm, overtime_type: Number(e.target.value) })} className="flex h-10 w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm text-text focus:outline-none focus:ring-2 focus:ring-primary/50">
                        <option value={0}>Sin horas extra</option>
                        <option value={1}>Diurna ×2</option>
                        <option value={2}>Nocturna ×2.5</option>
                        <option value={3}>Día de descanso ×2</option>
                        <option value={4}>Día feriado ×3</option>
                      </select>
                    </div>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs text-text-secondary">Bonificación/Estímulo $</Label>
                    <Input type="number" step="0.01" value={conceptsForm.bonus || ''} onChange={e => setConceptsForm({ ...conceptsForm, bonus: Number(e.target.value) })} />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs text-text-secondary">Días de Vacaciones Pagadas (0–30)</Label>
                    <Input type="number" min="0" max="30" step="0.5" value={conceptsForm.vacation_days || ''} onChange={e => setConceptsForm({ ...conceptsForm, vacation_days: Number(e.target.value) })} />
                  </div>
                </>
              )}
              <div className="space-y-1">
                <Label className="text-xs text-text-secondary">Anticipo $</Label>
                <Input type="number" step="0.01" value={conceptsForm.advances || ''} onChange={e => setConceptsForm({ ...conceptsForm, advances: Number(e.target.value) })} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-text-secondary">Cuota de Préstamo $</Label>
                <Input type="number" step="0.01" value={conceptsForm.loan_deduction || ''} onChange={e => setConceptsForm({ ...conceptsForm, loan_deduction: Number(e.target.value) })} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-text-secondary">Otras Deducciones $</Label>
                <Input type="number" step="0.01" value={conceptsForm.other_deductions || ''} onChange={e => setConceptsForm({ ...conceptsForm, other_deductions: Number(e.target.value) })} />
              </div>
              <div className="flex gap-3 pt-2">
                <Button variant="outline" className="flex-1" onClick={() => setConceptsEntryId(null)}>Cancelar</Button>
                <Button className="flex-1" onClick={saveConcepts}>Guardar</Button>
              </div>
            </div>
          </Modal>
        );
      })()}

      {/* Modal Recibo de Pago */}
      {payslipEntry && (() => {
        const entry = payslipEntry;
        const employee = employees.find(e => e.id === entry.employee_id);
        const dept = departments.find(d => d.id === employee?.category);
        const monthName = new Date(0, entry.month - 1).toLocaleString('es', { month: 'long' });
        const gross = entry.gross_salary ?? entry.earned_salary;
        const ret = (entry.advances ?? 0) + (entry.loan_deduction ?? 0) + (entry.other_deductions ?? 0);
        return (
          <Modal isOpen onClose={() => setPayslipEntry(null)} title={`Recibo de Pago — ${entry.employee_name}`} description={`${monthName} ${entry.year}`} size="lg">
            <div className="space-y-5">
              <div className="rounded-xl border border-border bg-bg p-5 space-y-3">
                <div className="text-center pb-2 border-b border-border">
                  <p className="text-xl font-bold text-primary">InventarioY</p>
                  <p className="text-xs text-text-secondary">{user?.businessName}</p>
                </div>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                  <p className="text-text-secondary">Expediente: <span className="text-text font-medium">{employee?.expediente ? `#${employee.expediente}` : '—'}</span></p>
                  <p className="text-text-secondary">Empleado: <span className="text-text font-medium">{entry.employee_name}</span></p>
                  <p className="text-text-secondary">Cargo: <span className="text-text font-medium">{employee?.role || '—'}</span></p>
                  <p className="text-text-secondary">NIT/Carnet: <span className="text-text font-medium">{employee?.nit_id || '—'}</span></p>
                  <p className="text-text-secondary">Departamento: <span className="text-text font-medium">{dept?.name || '—'}</span></p>
                  <p className="text-text-secondary">Horas/Días: <span className="text-text font-medium">{(entry.worked_hours ?? 0).toFixed(1)} h ({(entry.days_paid ?? 0).toFixed(0)} d)</span></p>
                  <p className="text-text-secondary">Período: <span className="text-text font-medium">{monthName} {entry.year}</span></p>
                </div>
              </div>

              <div>
                <h4 className="text-sm font-semibold text-text mb-2">Ingresos</h4>
                <div className="space-y-1.5 text-sm">
                  <div className="flex justify-between"><span className="text-text-secondary">Salario del período</span><span>${(entry.earned_salary ?? 0).toFixed(2)}</span></div>
                  <div className="flex justify-between"><span className="text-text-secondary">Horas extra</span><span>${(entry.overtime_pay ?? 0).toFixed(2)}</span></div>
                  <div className="flex justify-between"><span className="text-text-secondary">Bonificación</span><span>${(entry.bonus ?? 0).toFixed(2)}</span></div>
                  <div className="flex justify-between"><span className="text-text-secondary">Pago de vacaciones</span><span>${(entry.vacation_pay ?? 0).toFixed(2)}</span></div>
                  <div className="flex justify-between font-semibold border-t border-border pt-1.5"><span>Total bruto</span><span>${gross.toFixed(2)}</span></div>
                </div>
              </div>

              <div>
                <h4 className="text-sm font-semibold text-text mb-2">Deducciones</h4>
                <div className="space-y-1.5 text-sm">
                  <div className="flex justify-between"><span className="text-text-secondary">IIP</span><span className="text-danger">-${(entry.tax_amount ?? 0).toFixed(2)}</span></div>
                  <div className="flex justify-between"><span className="text-text-secondary">CESS</span><span className="text-danger">-${(entry.special_contribution ?? 0).toFixed(2)}</span></div>
                  <div className="flex justify-between"><span className="text-text-secondary">Anticipo</span><span className="text-danger">-${(entry.advances ?? 0).toFixed(2)}</span></div>
                  <div className="flex justify-between"><span className="text-text-secondary">Cuota de préstamo</span><span className="text-danger">-${(entry.loan_deduction ?? 0).toFixed(2)}</span></div>
                  <div className="flex justify-between"><span className="text-text-secondary">Otras deducciones</span><span className="text-danger">-${(entry.other_deductions ?? 0).toFixed(2)}</span></div>
                </div>
              </div>

              <div className="rounded-xl border border-success/40 bg-success/10 p-4">
                <div className="flex justify-between">
                  <span className="font-semibold text-text">Salario Devengado (a cobrar)</span>
                  <span className="text-xl font-bold text-success">${(entry.earned_salary ?? 0).toFixed(2)}</span>
                </div>
                <p className="text-[10px] text-text-secondary mt-1">Total deducciones: ${ret.toFixed(2)}</p>
              </div>

              <Button className="w-full gap-2" onClick={() => window.print()}>
                <Printer className="h-4 w-4" /> Imprimir
              </Button>
            </div>
          </Modal>
        );
      })()}

      {/* Modal SC4-06 */}
      {sc406Open && (() => {
        const monthName = new Date(0, payrollMonth.month - 1).toLocaleString('es', { month: 'long' });
        const lastDay = new Date(payrollMonth.year, payrollMonth.month, 0).getDate();
        const mm = String(payrollMonth.month).padStart(2, '0');
        const byCat = payrollEntries.reduce((acc, e) => {
          if (!acc[e.employee_category]) acc[e.employee_category] = [];
          acc[e.employee_category].push(e);
          return acc;
        }, {} as Record<string, typeof payrollEntries>);
        const grandTotal = payrollEntries.reduce((s, e) => s + (e.earned_salary ?? 0), 0);
        return (
          <Modal isOpen onClose={() => setSc406Open(false)} title="MODELO SC4-06 NOMINA" description={`${monthName} ${payrollMonth.year}`} size="xl">
            <div className="space-y-4">
              <div className="rounded-xl border border-border bg-bg p-4 text-sm printable">
                <div className="flex justify-between items-start">
                  <div>
                    <p className="font-bold text-text">MIPYMES — {user?.businessName}</p>
                    <p className="text-xs text-text-secondary">Fecha: {new Date().toLocaleDateString('es-ES')} &nbsp;|&nbsp; Código: {user?.businessCode || '—'}</p>
                  </div>
                  <div className="text-right text-xs text-text-secondary">
                    <p className="font-semibold text-text">INTRAM DE PAGO Nº ____</p>
                    <p>Período: 01/{mm}/{payrollMonth.year} al {lastDay}/{mm}/{payrollMonth.year}</p>
                  </div>
                </div>
                {Object.entries(byCat).map(([category, entries]) => {
                  const subtotal = entries.reduce((s, e) => s + (e.earned_salary ?? 0), 0);
                  return (
                    <div key={category} className="mt-4">
                      <p className="font-semibold text-text">{category}</p>
                      <table className="w-full text-xs mt-1">
                        <thead className="text-text-secondary">
                          <tr>
                            <th className="text-left px-1 py-1">Código</th>
                            <th className="text-left px-1 py-1">Nombre y Apellidos</th>
                            <th className="text-left px-1 py-1">CI</th>
                            <th className="text-center px-1 py-1">Cat</th>
                            <th className="text-right px-1 py-1">Tarf. Sal</th>
                            <th className="text-right px-1 py-1">Días A cobrar</th>
                            <th className="text-right px-1 py-1">Bon.</th>
                            <th className="text-right px-1 py-1">P.A.T</th>
                            <th className="text-right px-1 py-1">Deveng.</th>
                            <th className="text-right px-1 py-1">Imp. S.</th>
                            <th className="text-right px-1 py-1">Ret.</th>
                            <th className="text-right px-1 py-1">Pagado</th>
                            <th className="text-right px-1 py-1">Vac. Acum.</th>
                          </tr>
                        </thead>
                        <tbody>
                          {entries.map(e => {
                            const emp = employees.find(x => x.id === e.employee_id);
                            const pat = (e.overtime_pay ?? 0) + (e.vacation_pay ?? 0);
                            const ret = (e.advances ?? 0) + (e.loan_deduction ?? 0) + (e.other_deductions ?? 0);
                            return (
                              <tr key={e.id}>
                                <td className="px-1 py-1">{emp?.expediente ? `#${emp.expediente}` : ''}</td>
                                <td className="px-1 py-1">{e.employee_name}</td>
                                <td className="px-1 py-1">{emp?.nit_id || ''}</td>
                                <td className="text-center px-1 py-1">{emp?.person_type === 'partner' ? 'S' : 'T'}</td>
                                <td className="text-right px-1 py-1">{(e.hourly_rate ?? 0).toFixed(2)}</td>
                                <td className="text-right px-1 py-1">{(e.days_paid ?? 0).toFixed(0)}</td>
                                <td className="text-right px-1 py-1">{(e.bonus ?? 0).toFixed(2)}</td>
                                <td className="text-right px-1 py-1">{pat.toFixed(2)}</td>
                                <td className="text-right px-1 py-1">{(e.earned_salary ?? 0).toFixed(2)}</td>
                                <td className="text-right px-1 py-1">{((e.tax_amount ?? 0) + (e.special_contribution ?? 0)).toFixed(2)}</td>
                                <td className="text-right px-1 py-1">{ret.toFixed(2)}</td>
                                <td className="text-right px-1 py-1">{(e.net_salary ?? 0).toFixed(2)}</td>
                                <td className="text-right px-1 py-1">{(emp?.vacation_balance ?? 0).toFixed(1)}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                        <tfoot>
                          <tr className="border-t border-border font-semibold">
                            <td colSpan={8} className="px-1 py-1 text-right">TOTAL POR ÁREA</td>
                            <td className="text-right px-1 py-1">{subtotal.toFixed(2)}</td>
                            <td colSpan={4} />
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                  );
                })}
                <div className="mt-3 border-t border-border pt-2 flex justify-between font-bold">
                  <span>TOTAL NÓMINA</span>
                  <span>${grandTotal.toFixed(2)}</span>
                </div>
                <div className="mt-8 grid grid-cols-4 gap-3 text-center text-xs text-text-secondary">
                  <div className="border-t border-border pt-2">Elaborada por</div>
                  <div className="border-t border-border pt-2">Revisada por</div>
                  <div className="border-t border-border pt-2">Aprobada por</div>
                  <div className="border-t border-border pt-2">Contabilizada por</div>
                </div>
              </div>
              <Button className="w-full gap-2" onClick={() => window.print()}><Printer className="h-4 w-4" /> Imprimir</Button>
            </div>
          </Modal>
        );
      })()}

      {/* Modal Ayuda */}
      {helpModal && (() => {
        const content: Record<string, { title: string; steps: string[] }> = {
          nomina: {
            title: 'Guía de Nómina',
            steps: [
              'Selecciona el período (mes/año).',
              'Captación: marca quiénes se incluyen y ajusta horas, tasa, bonos, anticipos, retenciones y vacaciones. Guarda la captación.',
              'Generar Nómina: auto-guarda la captación y calcula IIP, CESS y salarios.',
              'Revisa los conceptos por trabajador (botón calculadora) si necesitas corregir horas extra, bonificaciones u otras deducciones.',
              'Aplica la nómina (solo Dueño/a) para certificarla y bloquearla.',
              'Los préstamos activos descuentan su cuota automáticamente; el balance se reduce en la primera generación del mes.',
              'Las vacaciones se acumulan 2.5 días/mes y se recalculan en cada generación.',
              'Exporta: Excel, Modelo TA-6, Planilla TSS o imprime el modelo SC4-06.',
              'Socios (DL 92/2024): no generan IIP ni provisión de vacaciones; aportan 20% de su base de contribución.',
            ],
          },
          deducciones: {
            title: 'Guía de Deducciones',
            steps: [
              'Registra préstamos, créditos bancarios, sanciones, inasistencias u otros descuentos.',
              'El monto total debe ser mayor que 0 y la cuota mensual entre 0 y el total.',
              'Al generar la nómina, la cuota del préstamo activo se descuenta del neto (columna RET).',
              'El saldo se reduce solo en la primera generación del mes; si llega a 0 pasa a "Pagado".',
              'Puedes registrar el pago de una cuota manualmente y eliminar la deducción desde la tabla.',
            ],
          },
          liquidaciones: {
            title: 'Guía de Liquidaciones',
            steps: [
              'Selecciona un empleado asalariado (los socios no generan liquidación).',
              'Indica la fecha de cese y los días de vacaciones tomados.',
              'Calcula la liquidación: se consideran vacaciones acumuladas (2.5 días/mes), auxilio de despido y preaviso (solo contrato indeterminado).',
              'Revisa el resultado y guárdalo para el historial.',
            ],
          },
          configuracion: {
            title: 'Guía de Configuración',
            steps: [
              'Base Exenta Mensual: primer tramo exento de IIP (Res. 41/2023), por defecto $3,260.',
              'Fondo de Tiempo Estimado: horas del mes para calcular la tasa horaria (defecto 190.6).',
              'Acumulación de Vacaciones: días que se acumulan por mes trabajado (defecto 2.5).',
              'Los cambios se guardan automáticamente al salir del campo (onBlur).',
              'Verifica posibles cambios normativos con la MFP/ONAT.',
            ],
          },
        };
        const c = content[helpModal];
        return (
          <Modal isOpen onClose={() => setHelpModal(null)} title={c.title} description="Guía de ayuda paso a paso">
            <ol className="space-y-2">
              {c.steps.map((s, i) => (
                <li key={i} className="flex items-start gap-3 text-sm">
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/15 text-[11px] font-bold text-primary">{i + 1}</span>
                  <span className="text-text-secondary">{s}</span>
                </li>
              ))}
            </ol>
          </Modal>
        );
      })()}

      <ConfirmDialog
        isOpen={confirmApply}
        title="Certificar y aplicar la nómina"
        message={`¿Certificar y aplicar la nómina de ${new Date(0, payrollMonth.month - 1).toLocaleString('es', { month: 'long' })} ${payrollMonth.year}? Una vez aplicada quedará bloqueada y solo el Dueño/a podrá reabrirla.`}
        confirmLabel="Aplicar"
        cancelLabel="Cancelar"
        onCancel={() => setConfirmApply(false)}
        onConfirm={async () => {
          try {
            const store = useDatabaseStore.getState();
            await store.applyPayroll(payrollMonth.month, payrollMonth.year);
            setConfirmApply(false);
            toast.success('Nómina aplicada y bloqueada');
          } catch (err) {
            setConfirmApply(false);
            toast.error((err as Error).message || 'Error al aplicar la nómina');
          }
        }}
      />

      <ConfirmDialog
        isOpen={confirmReopen}
        title="Reabrir nómina"
        message="La nómina volverá a estado Borrador y podrá modificarse. La acción quedará registrada."
        confirmLabel="Reabrir"
        cancelLabel="Cancelar"
        onCancel={() => setConfirmReopen(false)}
        onConfirm={async () => {
          try {
            const store = useDatabaseStore.getState();
            await store.reopenPayroll(payrollMonth.month, payrollMonth.year);
            setConfirmReopen(false);
            toast.success('Nómina reabierta (Borrador)');
          } catch (err) {
            setConfirmReopen(false);
            toast.error((err as Error).message || 'Error al reabrir la nómina');
          }
        }}
      />

      <ConfirmDialog
        isOpen={confirmDeleteEmployee !== null}
        title="Eliminar empleado"
        message={`¿Seguro que deseas eliminar a ${confirmDeleteEmployee?.name}? Se perderán sus documentos y registros asociados.`}
        confirmLabel="Eliminar"
        cancelLabel="Cancelar"
        tone="danger"
        onCancel={() => setConfirmDeleteEmployee(null)}
        onConfirm={async () => {
          if (!confirmDeleteEmployee) return;
          try {
            await deleteEmployee(confirmDeleteEmployee.id);
            setConfirmDeleteEmployee(null);
            toast.success('Empleado eliminado');
          } catch (err) {
            setConfirmDeleteEmployee(null);
            toast.error((err as Error).message || 'Error al eliminar');
          }
        }}
      />

      <ConfirmDialog
        isOpen={confirmDeleteDepartment !== null}
        title="Eliminar departamento"
        message={`¿Eliminar el departamento "${confirmDeleteDepartment?.name}"?`}
        confirmLabel="Eliminar"
        cancelLabel="Cancelar"
        tone="danger"
        onCancel={() => setConfirmDeleteDepartment(null)}
        onConfirm={async () => {
          if (!confirmDeleteDepartment) return;
          try {
            const { deleteDepartment } = useDatabaseStore.getState();
            await deleteDepartment(confirmDeleteDepartment.id);
            setConfirmDeleteDepartment(null);
            toast.success('Departamento eliminado');
          } catch (err) {
            setConfirmDeleteDepartment(null);
            toast.error((err as Error).message || 'Error al eliminar');
          }
        }}
      />

      <ConfirmDialog
        isOpen={confirmDeleteLoan !== null}
        title="Eliminar deducción"
        message={`¿Eliminar la deducción de ${confirmDeleteLoan ? (employees.find(e => e.id === confirmDeleteLoan.employee_id)?.name || '') : ''} por $${confirmDeleteLoan ? confirmDeleteLoan.total_amount.toFixed(2) : ''}?`}
        confirmLabel="Eliminar"
        cancelLabel="Cancelar"
        tone="danger"
        onCancel={() => setConfirmDeleteLoan(null)}
        onConfirm={async () => {
          if (!confirmDeleteLoan) return;
          try {
            await deleteLoan(confirmDeleteLoan.id);
            setConfirmDeleteLoan(null);
            toast.success('Deducción eliminada');
          } catch (err) {
            setConfirmDeleteLoan(null);
            toast.error((err as Error).message || 'Error al eliminar');
          }
        }}
      />

      <ConfirmDialog
        isOpen={confirmDeleteLiquidation !== null}
        title="Eliminar liquidación"
        message="¿Eliminar esta liquidación del historial?"
        confirmLabel="Eliminar"
        cancelLabel="Cancelar"
        tone="danger"
        onCancel={() => setConfirmDeleteLiquidation(null)}
        onConfirm={async () => {
          if (!confirmDeleteLiquidation) return;
          try {
            await deleteLiquidation(confirmDeleteLiquidation);
            setConfirmDeleteLiquidation(null);
            toast.success('Liquidación eliminada');
          } catch (err) {
            setConfirmDeleteLiquidation(null);
            toast.error((err as Error).message || 'Error al eliminar');
          }
        }}
      />
    </div>
  );
}
