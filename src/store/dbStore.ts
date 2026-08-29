import { create } from 'zustand';
import { supabase } from '../lib/supabase';
import { useAuthStore } from './authStore';
import { toast } from 'sonner';
import { db, cacheAllData, getCachedProducts, getCachedMovements, getCachedWarehouses, getCachedTransitItems, getCachedSales, getCachedRecipes, getCachedEmployees, getCachedCategories, getCachedPendingAccounts, getCachedDailyClosings, getCachedAccessPins, getCachedProductWarehouse, getSyncQueueCount, addToSyncQueue, cacheAccessPins } from '../lib/dexieDb';
import { syncEngine } from '../lib/syncEngine';
import { isDateClosed } from '../lib/dateUtils';
import { calcularNominaEmpleado, calcularNominaSocio, ROUND, DEFAULT_MONTHLY_HOURS, DEFAULT_VACATION_ACCRUAL_DAYS } from '../utils/payrollCalculations';
import { logger } from '../lib/logger';
import { normalizeStr } from '../lib/utils';
import { trackLocalCreation, untrackLocalCreation } from '../lib/realtimeGuard';

let _isFetchingAll = false;
let _isConsumingTransit = false;

let _movementLock: Promise<void> = Promise.resolve();

async function withMovementLock<T>(fn: () => Promise<T>): Promise<T> {
  const prev = _movementLock;
  let release: () => void = () => {};
  _movementLock = new Promise<void>((resolve) => { release = resolve; });
  try {
    await prev;
    return await fn();
  } finally {
    release();
  }
}

export interface Product {
  id: string;
  user_id: string;
  name: string;
  category: string;
  quantity: number;
  unit: string;
  price: number;
  cost: number;
  rop: number;
  eoq: number;
  lead_time?: number;
  order_cost?: number;
  holding_cost?: number;
  expiration_date?: string;
  description?: string;
  is_individual: boolean;
  is_active: boolean;
  in_transit?: number;
  is_gasto_variable?: boolean;
  is_consumo_directo?: boolean;
  is_recipe?: boolean;
  recipe_ingredients?: any[];
  created_at: string;
}

export interface Movement {
  id: string;
  user_id: string;
  product_id: string;
  type: 'ENTRADA' | 'SALIDA' | 'MERMA' | 'AJUSTE';
  quantity: number;
  unit: string;
  date: string;
  cost: number;
  reason?: string;
  status?: string;
  justification?: string;
  justification_date?: string;
  is_gasto_variable?: boolean;
  is_consumo_directo?: boolean;
  note?: string;
  warehouse_id?: string;
  created_at: string;
}

export interface Warehouse {
  id: string;
  user_id: string;
  name: string;
  is_main: boolean;
  created_at: string;
}

export interface ProductWarehouse {
  id: string;
  product_id: string;
  warehouse_id: string;
  quantity: number;
  in_transit: number;
  updated_at: string;
}

export interface TransitItem {
  id: string;
  user_id: string;
  product_id: string;
  quantity: number;
  consumed: number;
  remaining: number;
  reason?: string;
  sent_date: string;
  created_at: string;
  warehouse_id?: string;
}

export interface Sale {
  id: string;
  user_id: string;
  employee_id?: string;
  items: {
    product_id: string;
    quantity: number;
    unit_cost: number;
    selling_price: number;
    subtotal: number;
    is_recipe?: boolean;
    recipe_snapshot?: {
      name: string;
      ingredients: {
        product_id: string;
        quantity: number;
        cost: number;
      }[];
    } | null;
  }[];
  total_amount: number;
  date: string;
  sale_type: 'SALON' | 'DOMICILIO' | 'BAR' | 'VENTA_RAPIDA';
  is_account_house: boolean;
  notes?: string;
  discount: number;
  payment_method?: string | null;
  efectivo?: number;
  transferencia?: number;
  usd?: number;
  eur?: number;
  subtotal?: number;
  created_at: string;
}

export interface Recipe {
  id: string;
  user_id: string;
  name: string;
  selling_price: number;
  ingredients: {
    product_id: string;
    quantity: number;
    unit: string;
  }[];
  created_at: string;
}

export interface PendingAccount {
  id: string;
  user_id: string;
  client_name: string;
  items: PendingItem[];
  total_amount: number;
  is_account_house: boolean;
  sale_type: 'SALON' | 'DOMICILIO' | 'BAR' | 'VENTA_RAPIDA';
  status: 'pending' | 'paid' | 'cancelled';
  created_at: string;
  created_at_local?: string;
  updated_at: string;
}

export interface PendingItem {
  product_id: string;
  product_name: string;
  quantity: number;
  unit_price: number;
  subtotal: number;
  added_at: string;
  is_recipe?: boolean;
  recipe_snapshot?: {
    name: string;
    ingredients: {
      product_id: string;
      quantity: number;
      cost: number;
    }[];
  } | null;
}

export interface AccessPin {
  id: string;
  user_id: string;
  pin_hash: string;
  role: 'owner' | 'economist' | 'admin' | 'supervisor' | 'clerk';
  pin_name: string;
  is_active: boolean;
  failed_attempts: number;
  blocked_until: string | null;
  created_at: string;
}

export const ROLE_LABELS: Record<string, string> = {
  owner: 'Dueño/a',
  economist: 'Económico/a',
  admin: 'Administrador/a',
  supervisor: 'Supervisor/a',
  clerk: 'Dependiente/a',
};

export const ROLE_MODULES: Record<string, string[]> = {
  owner: ['sales', 'inventory', 'movements', 'transit', 'recipes', 'consumption', 'closings', 'charts', 'analysis', 'filtered', 'hr', 'settings'],
  economist: ['sales', 'inventory', 'movements', 'transit', 'recipes', 'consumption', 'closings', 'charts', 'analysis', 'filtered', 'hr', 'settings'],
  admin: ['inventory', 'movements', 'transit'],
  supervisor: ['sales', 'closings'],
  clerk: ['sales'],
};

export const MODULE_ROLES: Record<string, string[]> = {
  '/dashboard': ['owner', 'economist', 'admin'],
  '/inventory': ['owner', 'economist', 'admin'],
  '/movements': ['owner', 'economist', 'admin'],
  '/transit': ['owner', 'economist', 'admin'],
  '/sales': ['owner', 'economist', 'supervisor', 'clerk'],
  '/closings': ['owner', 'economist', 'supervisor'],
  '/hr': ['owner', 'economist'],
  '/recipes': ['owner', 'economist'],
  '/consumption': ['owner', 'economist'],
  '/analysis': ['owner', 'economist'],
  '/charts': ['owner', 'economist'],
  '/filtered': ['owner', 'economist'],
  '/settings': ['owner'],
  '/action-logs': ['owner', 'economist'],
};

export interface Employee {
  id: string;
  user_id: string;
  name: string;
  role: string;
  salary: number;
  phone?: string;
  email?: string;
  nit_id?: string;
  category?: string;
  photo_url?: string;
  hire_date?: string;
  person_type?: 'employee' | 'partner';
  base_contribution?: number;
  contract_type?: 'indefinite' | 'fixed' | 'probation';
  contract_end_date?: string;
  expediente?: number;
  vacation_balance?: number;
  created_at: string;
}

export interface Category {
  id: string;
  user_id: string;
  name: string;
  created_at: string;
}

export interface DailyClosing {
  id: string;
  user_id: string;
  closing_date: string;
  total_sales: number;
  total_discounts: number;
  total_refunds: number;
  closing_amount: number;
  notes?: string;
  created_by?: string;
  created_by_name?: string;
  created_at?: string;
  cup_efectivo?: number;
  cup_transfer?: number;
  usd?: number;
  eur?: number;
  salon?: number;
  domicilio?: number;
  bar?: number;
  venta_rapida?: number;
  sales_count?: number;
}

export interface HRDocument {
  id: string;
  user_id: string;
  name: string;
  doc_type: 'MANUAL' | 'REGLAMENTO' | 'PNO';
  file_url: string;
  file_name: string;
  file_size?: number;
  created_at: string;
}

export interface EmployeeDocument {
  id: string;
  user_id: string;
  employee_id: string;
  name: string;
  doc_type: 'CONTRATO' | 'IDENTIFICACION' | 'OTRO';
  file_url: string;
  file_name: string;
  file_size?: number;
  created_at: string;
}

export interface Department {
  id: string;
  user_id: string;
  name: string;
  created_at: string;
}

export interface PayrollConfig {
  id: string;
  user_id: string;
  tax_exemption_base: number;
  tax_rate: number;
  special_contribution_rate: number;
  last_calculated_month?: string;
  monthly_hours?: number;
  vacation_accrual_days?: number;
  created_at: string;
  updated_at: string;
}

export interface PayrollEntry {
  id: string;
  user_id: string;
  employee_id: string;
  employee_name: string;
  employee_category: string;
  month: number;
  year: number;
  base_salary: number;
  earned_salary: number;
  exemption_base: number;
  taxable_base: number;
  tax_amount: number;
  special_contribution: number;
  net_salary: number;
  vacation_days: number;
  vacation_base: number;
  employer_contribution: number;
  is_custom: boolean;
  overtime_hours?: number;
  overtime_type?: 'diurna' | 'nocturna' | 'descanso' | 'feriado' | null;
  overtime_pay?: number;
  bonus?: number;
  vacation_pay?: number;
  advances?: number;
  loan_deduction?: number;
  other_deductions?: number;
  gross_salary?: number;
  worked_hours?: number;
  hourly_rate?: number;
  days_paid?: number;
  created_at: string;
  updated_at: string;
}

export interface EmployeeLoan {
  id: string;
  user_id: string;
  employee_id: string;
  total_amount: number;
  monthly_payment: number;
  balance: number;
  start_date?: string;
  status: 'active' | 'paid';
  deduction_type: 'prestamo' | 'credito_bancario' | 'inasistencia' | 'sancion' | 'rotura_equipo' | 'otro';
  reason?: string;
  created_at: string;
  updated_at: string;
}

export interface PayrollPeriod {
  id: string;
  user_id: string;
  month: number;
  year: number;
  status: 'draft' | 'applied';
  applied_at?: string;
  applied_by?: string;
  created_at: string;
  updated_at: string;
}

export interface PayrollDraft {
  id: string;
  user_id: string;
  month: number;
  year: number;
  employee_id: string;
  include: boolean;
  worked_hours: number;
  hourly_rate: number;
  bonus: number;
  advances: number;
  retention: number;
  vacation_days: number;
  note?: string;
  created_at: string;
  updated_at: string;
}

export interface PayrollLiquidation {
  id: string;
  user_id: string;
  employee_id: string;
  employee_name: string;
  base_salary: number;
  hire_date?: string;
  end_date?: string;
  months_worked: number;
  vacation_accumulated: number;
  vacation_taken: number;
  vacation_pending: number;
  vacation_pay: number;
  severance_months: number;
  severance_pay: number;
  notice_days: number;
  notice_pay: number;
  gross_total: number;
  cess: number;
  iip: number;
  net_total: number;
  created_at: string;
}

export interface EmployeeVacationMovement {
  id: string;
  user_id: string;
  employee_id: string;
  month: number;
  year: number;
  type: 'accrual' | 'paid';
  days: number;
  note?: string;
  created_at: string;
}

const capitalize = (str: string) =>
  str.trim().toLowerCase().replace(/\b\w/g, c => c.toUpperCase());

const DEFAULT_TIMEOUT = 15000; // 15 segundos

const isRateLimitError = (err: any): boolean => {
  return err?.status === 429 || err?.code === '429' || 
         err?.message?.includes('rate limit') || 
         err?.message?.includes('too many requests');
};

const withTimeout = async <T>(
  promise: Promise<T>,
  timeoutMs: number = DEFAULT_TIMEOUT
): Promise<T> => {
  try {
    const result = await Promise.race([
      promise,
      new Promise<T>((_, reject) =>
        setTimeout(() => reject(new Error(`TIMEOUT`)), timeoutMs)
      )
    ]);
    return result;
  } catch (err: any) {
    if (err.message === 'TIMEOUT') {
      throw new Error('TIMEOUT');
    }
    throw err;
  }
};

const NETWORK_ERROR_MESSAGES = [
  'Failed to fetch',
  'NetworkError',
  'Network request failed',
  'REFUSED_STREAM',
  'TIMEOUT',
  'network',
  'ERR_HTTP2',
];

function isNetworkError(err: any): boolean {
  const msg = err?.message || '';
  if (NETWORK_ERROR_MESSAGES.some((m) => msg.includes(m))) return true;
  if (err?.status === 503) return true;
  if (typeof navigator !== 'undefined' && !navigator.onLine) return true;
  return false;
}

const RETRYABLE_ERRORS = [
  'Failed to fetch',
  'NetworkError',
  'Network request failed',
  'REFUSED_STREAM',
  'TIMEOUT',
  'La conexión está lenta',
  'network',
  'ERR_HTTP2',
];

const queryWithRetry = async <T>(
  queryFn: () => PromiseLike<{ data: T; error: any }>,
  maxRetries: number = 3
): Promise<{ data: T; error: any }> => {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await withTimeout(Promise.resolve(queryFn()), DEFAULT_TIMEOUT);
    } catch (err: any) {
      const errMsg = err?.message || '';
      const isRetryable = RETRYABLE_ERRORS.some(msg => errMsg.includes(msg));
      
      if (attempt < maxRetries && isRetryable) {
        const backoff = Math.min(1000 * Math.pow(2, attempt), 8000);
        if (import.meta.env.DEV) {
          logger.warn(`⚠️ Reintentando consulta (${attempt + 1}/${maxRetries}) en ${backoff}ms...`);
        }
        await new Promise(r => setTimeout(r, backoff));
        continue;
      }
      throw err;
    }
  }
  throw new Error('Error inesperado en queryWithRetry');
};

let lastOperationTime: Record<string, number> = {};
const operationCooldown = 1000; // 1 segundo entre operaciones del mismo tipo

const withCooldown = async <T>(
  operationKey: string,
  operation: () => Promise<T>
): Promise<T> => {
  const now = Date.now();
  const lastTime = lastOperationTime[operationKey] || 0;
  const timeSinceLastOp = now - lastTime;
  
  if (timeSinceLastOp < operationCooldown) {
    await new Promise(resolve => setTimeout(resolve, operationCooldown - timeSinceLastOp));
  }
  
  lastOperationTime[operationKey] = Date.now();
  return operation();
};

export const resetConnectionCooldown = () => {
  lastOperationTime = {};
};

export const forceRefreshData = async () => {
  logger.info('🔄 Forzando recarga de datos...');
  const { fetchAll } = useDatabaseStore.getState();
  await fetchAll();
  logger.info('✅ Datos recargados exitosamente');
};

interface DatabaseState {
  products: Product[];
  movements: Movement[];
  sales: Sale[];
  recipes: Recipe[];
  employees: Employee[];
  categories: Category[];
  transitItems: TransitItem[];
  dailyClosings: DailyClosing[];
  hrDocuments: HRDocument[];
  employeeDocuments: EmployeeDocument[];
  departments: Department[];
  payrollConfig: PayrollConfig | null;
  payrollEntries: PayrollEntry[];
  employeeLoans: EmployeeLoan[];
  payrollPeriods: PayrollPeriod[];
  payrollDrafts: PayrollDraft[];
  payrollLiquidations: PayrollLiquidation[];
  vacationMovements: EmployeeVacationMovement[];
  pendingAccounts: PendingAccount[];
  accessPins: AccessPin[];
  actionLogs: any[];
  warehouses: Warehouse[];
  productWarehouse: ProductWarehouse[];
  currentWarehouseId: string | null;
  isLoading: boolean;
  isFetchingWarehouses: boolean;
  syncQueueCount: number;
  syncStatus: 'idle' | 'syncing' | 'complete' | 'error';
  syncProgress: { processed: number; total: number } | null;
  employeesPage: number;
  employeesTotal: number;
  departmentsPage: number;
  departmentsTotal: number;
  payrollPage: number;
  payrollMonthFilter: number;
  payrollYearFilter: number;
  payrollTotal: number;
  employeeSearchTerm: string;
  departmentSearchTerm: string;

  setSyncStatus: (status: 'idle' | 'syncing' | 'complete' | 'error') => void;
  setSyncProgress: (progress: { processed: number; total: number } | null) => void;
  refreshSyncQueueCount: () => Promise<void>;
  compensateFailedSync: () => Promise<{ total: number; recovered: number; failed: number; details: { id: number; operation: string; recovered: boolean; error?: string }[] }>;

  fetchAll: (limit?: number) => Promise<void>;
  fetchMore: (limit?: number) => Promise<{ hasMore: boolean }>;
  addProduct: (product: Omit<Product, 'id' | 'user_id' | 'created_at' | 'updated_at'>) => Promise<void>;
  updateProduct: (id: string, updates: Partial<Product>) => Promise<void>;
  deleteProduct: (id: string) => Promise<void>;
  
  addMovement: (movement: Omit<Movement, 'id' | 'user_id' | 'created_at'>) => Promise<void>;
  justifyMovement: (id: string, justification: string) => Promise<void>;
  
  consumeFromTransit: (productId: string, quantity: number, reason?: string) => Promise<{ success: boolean; error?: string }>;
  cancelTransit: (transitItemId: string, quantity: number, reason: string) => Promise<{ success: boolean; error?: string }>;
  registerWasteFromTransit: (transitItemId: string, quantity: number, reason: string) => Promise<{ success: boolean; error?: string }>;
  registerManualConsumption: (transitItemId: string, quantity: number, note?: string) => Promise<{ success: boolean; error?: string }>;
  
  addSale: (sale: Omit<Sale, 'id' | 'user_id' | 'created_at'>) => Promise<{ success: boolean; error?: string }>;
  
  addRecipe: (recipe: Omit<Recipe, 'id' | 'user_id' | 'created_at'>) => Promise<void>;
  updateRecipe: (id: string, updates: Partial<Recipe>) => Promise<void>;
  deleteRecipe: (id: string) => Promise<void>;
  
  addEmployee: (employee: Omit<Employee, 'id' | 'user_id' | 'created_at'>) => Promise<void>;
  updateEmployee: (id: string, updates: Partial<Employee>) => Promise<void>;
  deleteEmployee: (id: string) => Promise<void>;

  addCategory: (name: string) => Promise<void>;
  deleteCategory: (id: string) => Promise<void>;

  recalculateStock: () => Promise<void>;
  createDailyClosing: (closing: Omit<DailyClosing, 'id' | 'created_at'>) => Promise<{ success: boolean; error?: string }>;
  getDailyClosings: () => Promise<void>;

  uploadHRDocument: (file: File, docType: 'MANUAL' | 'REGLAMENTO' | 'PNO') => Promise<{ success: boolean; error?: string }>;
  fetchHRDocuments: () => Promise<void>;
  deleteHRDocument: (id: string, fileUrl: string) => Promise<void>;

  uploadEmployeeDocument: (file: File, employeeId: string, docType: 'CONTRATO' | 'IDENTIFICACION' | 'OTRO', name?: string) => Promise<{ success: boolean; error?: string }>;

  createPendingAccount: (clientName: string) => Promise<{ success: boolean; error?: string; accountId?: string }>;
addItemsToPendingAccount: (accountId: string, items: { product_id: string; product_name: string; quantity: number; unit_price: number; subtotal: number; is_recipe?: boolean; recipe_snapshot?: { name: string; ingredients: { product_id: string; quantity: number; cost: number }[] } }[], isAccountHouse?: boolean, saleType?: 'SALON' | 'DOMICILIO' | 'BAR' | 'VENTA_RAPIDA')
    => Promise<{ success: boolean; error?: string }>;
  updatePendingAccount: (accountId: string, updates: Partial<PendingAccount>) => Promise<{ success: boolean; error?: string }>;
  updatePendingAccountItems: (accountId: string, items: PendingItem[]) => Promise<{ success: boolean; error?: string }>;
  togglePendingAccountType: (accountId: string) => Promise<{ success: boolean; error?: string }>;
  deletePendingAccount: (accountId: string) => Promise<{ success: boolean; error?: string }>;
  getPendingAccounts: () => Promise<void>;
  chargePendingAccount: (accountId: string, employeeId: string, employeeName: string, saleDate?: string, paymentMethod?: string, efectivo?: number, transferencia?: number, usd?: number, eur?: number) => Promise<{ success: boolean; error?: string }>;

  saveAccessPin: (role: string, pin: string, name: string) => Promise<{ success: boolean; error?: string }>;
  toggleAccessPin: (pinId: string, isActive: boolean) => Promise<{ success: boolean; error?: string }>;
  deleteAccessPin: (pinId: string) => Promise<{ success: boolean; error?: string }>;
  verifyPinForModule: (modulePath: string, pin: string) => Promise<{ success: boolean; error?: string; blocked?: boolean; remainingTime?: number }>;
  verifyPinSimple: (pin: string) => Promise<{ success: boolean; error?: string; blocked?: boolean; remainingTime?: number; role?: string }>;
  verifiedRole: string | null;
  verifiedRoleName: string | null;
  clearVerifiedRole: () => void;
  fetchEmployeeDocuments: (employeeId: string) => Promise<void>;
  deleteEmployeeDocument: (id: string, fileUrl: string) => Promise<void>;

  addDepartment: (name: string) => Promise<void>;
  updateDepartment: (id: string, name: string) => Promise<void>;
  deleteDepartment: (id: string) => Promise<void>;

  getPayrollConfig: () => Promise<void>;
  updatePayrollConfig: (updates: Partial<PayrollConfig>) => Promise<void>;

  calculatePayroll: (month: number, year: number) => Promise<void>;
  getPayrollEntries: (month: number, year: number) => Promise<void>;
  updatePayrollEntry: (id: string, updates: Partial<PayrollEntry>) => Promise<void>;
  regeneratePayrollEntry: (id: string) => Promise<void>;

  // Períodos de nómina
  getPayrollPeriod: (month: number, year: number) => Promise<void>;
  applyPayroll: (month: number, year: number) => Promise<void>;
  reopenPayroll: (month: number, year: number) => Promise<void>;

  // Captación pre-nómina
  getPayrollDrafts: (month: number, year: number) => Promise<PayrollDraft[]>;
  savePayrollDrafts: (month: number, year: number, drafts: Omit<PayrollDraft, 'id' | 'user_id' | 'created_at' | 'updated_at'>[]) => Promise<void>;

  // Deducciones / préstamos
  getEmployeeLoans: () => Promise<void>;
  addLoan: (loan: { employee_id: string; total_amount: number; monthly_payment: number; start_date?: string; deduction_type: EmployeeLoan['deduction_type']; reason?: string }) => Promise<void>;
  deleteLoan: (id: string) => Promise<void>;
  payLoanInstallment: (id: string) => Promise<void>;

  // Liquidaciones
  getPayrollLiquidations: () => Promise<void>;
  saveLiquidation: (liquidation: Omit<PayrollLiquidation, 'id' | 'user_id' | 'created_at'>) => Promise<void>;
  deleteLiquidation: (id: string) => Promise<void>;

  // Vacaciones
  getVacationMovements: (month: number, year: number) => Promise<EmployeeVacationMovement[]>;
  getVacationBalance: (employeeId: string, month: number, year: number) => Promise<number>;

  // Paginación optimizada
  getEmployeesPaginated: (page: number, search?: string, departmentId?: string, sortBy?: 'name' | 'salary', sortOrder?: 'asc' | 'desc') => Promise<void>;
  getDepartmentsPaginated: (page: number, search?: string) => Promise<void>;
  getPayrollEntriesPaginated: (page: number, month: number, year: number) => Promise<void>;
  getPayrollEntriesCount: (month: number, year: number) => Promise<number>;
  getEmployeesCount: (search?: string, departmentId?: string) => Promise<number>;
  getDepartmentsCount: (search?: string) => Promise<number>;

  forceRefreshData: () => Promise<void>;
  
  // Warehouse management
  fetchWarehouses: () => Promise<void>;
  setCurrentWarehouse: (warehouseId: string) => void;
  fetchProductWarehouse: (skipAutoHeal?: boolean) => Promise<void>;
  updateProductWarehouseQuantity: (productId: string, warehouseId: string, quantity: number, skipAutoHeal?: boolean) => Promise<void>;
  
  // Logging de acciones
  logAction: (module: string, action: string, details?: Record<string, any>) => Promise<void>;
  getActionLogs: () => Promise<void>;
  hashPin: (pin: string) => Promise<string>;
}

export const useDatabaseStore = create<DatabaseState>()((set, get) => ({
  products: [],
  movements: [],
  sales: [],
  recipes: [],
  employees: [],
  categories: [],
  transitItems: [],
  dailyClosings: [],
  hrDocuments: [],
  employeeDocuments: [],
  departments: [],
  payrollConfig: null,
  payrollEntries: [],
  employeeLoans: [],
  payrollPeriods: [],
  payrollDrafts: [],
  payrollLiquidations: [],
  vacationMovements: [],
  accessPins: [],
  // Paginación
  employeesPage: 1,
  employeesTotal: 0,
  departmentsPage: 1,
  departmentsTotal: 0,
  payrollPage: 1,
  payrollTotal: 0,
  employeeSearchTerm: '',
  departmentSearchTerm: '',
  payrollMonthFilter: 0,
  payrollYearFilter: 0,
  verifiedRole: typeof window !== 'undefined' ? localStorage.getItem('verifiedRole') : null,
  verifiedRoleName: typeof window !== 'undefined' ? localStorage.getItem('verifiedRoleName') : null,
  actionLogs: [],
  warehouses: [],
  productWarehouse: [],
  currentWarehouseId: null,
  pendingAccounts: [],
  isLoading: true,
  isFetchingWarehouses: false,
  syncQueueCount: 0,
  syncStatus: 'idle',
  syncProgress: null,

  setSyncStatus: (status) => set({ syncStatus: status }),
  setSyncProgress: (progress) => set({ syncProgress: progress }),
  refreshSyncQueueCount: async () => {
    const count = await getSyncQueueCount();
    set({ syncQueueCount: count });
  },
  compensateFailedSync: async () => {
    const result = await syncEngine.compensateFailedSync();
    get().refreshSyncQueueCount();
    return result;
  },

  clearVerifiedRole: () => {
    localStorage.removeItem('verifiedRole');
    localStorage.removeItem('verifiedRoleName');
    set({ verifiedRole: null, verifiedRoleName: null });
  },

  fetchAll: async (limit = 50) => {
    if (_isFetchingAll) {
      logger.info('fetchAll ya en progreso, ignorando...');
      return;
    }
    _isFetchingAll = true;

    const user = useAuthStore.getState().user;
    if (!user) {
      set({ products: [], movements: [], sales: [], recipes: [], employees: [], categories: [], transitItems: [], dailyClosings: [], hrDocuments: [], employeeDocuments: [], departments: [], payrollConfig: null, payrollEntries: [], employeeLoans: [], payrollPeriods: [], payrollDrafts: [], payrollLiquidations: [], vacationMovements: [], pendingAccounts: [], accessPins: [], actionLogs: [], warehouses: [], productWarehouse: [], currentWarehouseId: null, isLoading: false });
      _isFetchingAll = false;
      return;
    }

    set({ isLoading: true });

    // Offline sin internet: restaurar desde caché Dexie sin tocar Supabase
    if (!navigator.onLine) {
      logger.info('📥 Offline — restaurando desde caché local...');
      await restoreFromCache(user.id);
      set({ isLoading: false });
      _isFetchingAll = false;
      return;
    }

    // Verificar que realmente haya conectividad (navigator.onLine a veces miente)
    const hasRealNet = await (async () => {
      try {
        const result = await Promise.race([
          supabase.from('products').select('id').limit(1).maybeSingle(),
          new Promise<any>((_, reject) => setTimeout(() => reject(new Error('timeout')), 3000)),
        ]);
        return !result?.error;
      } catch {
        return false;
      }
    })();

    if (!hasRealNet) {
      logger.info('📥 navigator.onLine=true pero sin internet real — restaurando caché...');
      await restoreFromCache(user.id);
      set({ isLoading: false });
      _isFetchingAll = false;
      return;
    }

    const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

    // ── Grupo 1: Productos y Movimientos ──
    let productsData: any[] | null = null;
    let movementsData: any[] | null = null;

    try {
      logger.info('📥 Cargando datos principales...');
      const [productsRes, movementsRes] = await Promise.all([
        queryWithRetry(() => supabase.from('products').select('*').eq('user_id', user.id).order('created_at', { ascending: false }).limit(limit)),
        queryWithRetry(() => supabase.from('movements').select('*').eq('user_id', user.id).order('created_at', { ascending: false })),
      ]);
      productsData = productsRes.data || [];
      movementsData = movementsRes.data || [];
      set({ products: productsData, movements: movementsData });
      await delay(100);
    } catch (e) {
      logger.error('❌ Grupo 1 (productos/movimientos) falló:', e);
    }

    // ── Grupo 2: Ventas y Recetas ──
    let salesData: any[] | null = null;
    let recipesData: any[] | null = null;

    try {
      logger.info('📥 Cargando ventas y recetas...');
      const [salesRes, recipesRes] = await Promise.all([
        queryWithRetry(() => supabase.from('sales').select('*, sale_items(*)').eq('user_id', user.id).order('created_at', { ascending: false }).limit(limit)),
        queryWithRetry(() => supabase.from('recipes').select('*, recipe_ingredients(*)').eq('user_id', user.id).order('created_at', { ascending: false }).limit(limit)),
      ]);
      salesData = salesRes.data?.map((s: any) => ({ ...s, items: s.sale_items || [] })) || [];
      recipesData = recipesRes.data?.map((r: any) => ({ ...r, ingredients: r.recipe_ingredients || [] })) || [];
      set({ sales: salesData, recipes: recipesData });
      await delay(100);
    } catch (e) {
      logger.error('❌ Grupo 2 (ventas/recetas) falló:', e);
    }

    // ── Grupo 3: Empleados y RRHH ──
    let employeesData: any[] | null = null;
    let categoriesData: any[] | null = null;
    let hrDocsData: any[] | null = null;
    let departmentsData: any[] | null = null;
    let employeeLoansData: any[] | null = null;

    try {
      logger.info('📥 Cargando empleados y RRHH...');
      const [employeesRes, categoriesRes, hrDocsRes, departmentsRes, employeeLoansRes] = await Promise.all([
        queryWithRetry(() => supabase.from('employees').select('*').eq('user_id', user.id).order('created_at', { ascending: false }).limit(limit)),
        queryWithRetry(() => supabase.from('categories').select('*').eq('user_id', user.id).order('created_at', { ascending: false }).limit(limit)),
        queryWithRetry(() => supabase.from('hr_documents').select('*').eq('user_id', user.id).order('created_at', { ascending: false }).limit(limit)),
        queryWithRetry(() => supabase.from('departments').select('*').eq('user_id', user.id).order('name', { ascending: true })),
        queryWithRetry(() => supabase.from('employee_loans').select('*').eq('user_id', user.id).order('created_at', { ascending: false }).limit(limit)),
      ]);
      employeesData = employeesRes.data || [];
      categoriesData = categoriesRes.data || [];
      hrDocsData = hrDocsRes.data || [];
      departmentsData = departmentsRes.data || [];
      employeeLoansData = employeeLoansRes.data || [];
      set({ employees: employeesData, categories: categoriesData, hrDocuments: hrDocsData, departments: departmentsData, employeeLoans: employeeLoansData });
      await delay(100);
    } catch (e) {
      logger.error('❌ Grupo 3 (empleados/RRHH) falló:', e);
    }

    // ── Grupo 4: Tránsito, Cierres, Configuración ──
    let transitItemsData: any[] | null = null;
    let dailyClosingsData: any[] | null = null;
    let pendingData: any[] | null = null;
    let accessPinsData: any[] | null = null;
    let actionLogsData: any[] | null = null;
    let payrollConfigData: any = null;
    let warehousesData: any[] | null = null;
    let productWarehouseData: any[] | null = null;

    try {
      logger.info(' Cargando cierres y configuración (parte 1/2)...');
      const [transitRes, dailyClosingsRes, pendingRes, accessPinsRes] = await Promise.all([
        queryWithRetry(() => supabase.from('transit_items').select('*').eq('user_id', user.id).order('created_at', { ascending: false }).limit(limit)),
        queryWithRetry(() => supabase.from('daily_closings').select('*').eq('user_id', user.id).order('closing_date', { ascending: false }).limit(limit)),
        queryWithRetry(() => supabase.from('pending_accounts').select('*').eq('user_id', user.id).order('created_at', { ascending: false }).limit(limit)),
        queryWithRetry(() => supabase.from('access_pins').select('*').eq('user_id', user.id).limit(limit)),
      ]);
      transitItemsData = (transitRes.data || []).filter((t: any) => t.remaining > 0);
      dailyClosingsData = dailyClosingsRes.data || [];
      pendingData = (pendingRes.data || []).filter((p: any) => p.status === 'pending');
      accessPinsData = accessPinsRes.data || [];
      await delay(100);

      logger.info('📥 Cargando cierres y configuración (parte 2/2)...');
      const [actionLogsRes, payrollConfigRes, warehousesRes, productWarehouseRes] = await Promise.all([
        queryWithRetry(() => supabase.from('action_logs').select('*').eq('user_id', user.id).order('created_at', { ascending: false }).limit(limit)),
        queryWithRetry(() => supabase.from('payroll_config').select('*').eq('user_id', user.id).maybeSingle()),
        queryWithRetry(() => supabase.from('warehouses').select('*').eq('user_id', user.id).order('name')),
        queryWithRetry(() => supabase.from('product_warehouse').select('*')),
      ]);
      actionLogsData = actionLogsRes.data || [];
      payrollConfigData = payrollConfigRes.data || null;
      warehousesData = warehousesRes.data || [];
      productWarehouseData = productWarehouseRes.data || [];
    } catch (e) {
      logger.error('❌ Grupo 4 (cierres/configuración) falló:', e);
    }

    // ── Computar in_transit y commit final ──
    // Usar los datos actuales del store como fallback para cada grupo que no se haya cargado
    const currentState = get();
    const effectiveTransitItems = transitItemsData ?? currentState.transitItems;
    const effectiveMovements = movementsData ?? currentState.movements;

    // Recalcular quantity desde movements (más fiable que el valor Supabase/DB)
    const qtyFromMovements = new Map<string, number>();
    for (const m of effectiveMovements) {
      const current = qtyFromMovements.get(m.product_id) || 0;
      if (m.type === 'ENTRADA') qtyFromMovements.set(m.product_id, current + Number(m.quantity));
      else if (m.type === 'SALIDA' || m.type === 'MERMA') qtyFromMovements.set(m.product_id, current - Number(m.quantity));
      else if (m.type === 'AJUSTE') qtyFromMovements.set(m.product_id, current + Number(m.quantity));
    }

    const productsWithTransit = (productsData ?? currentState.products).map(p => {
      const totalInTransit = effectiveTransitItems
        .filter((t: any) => t.product_id === p.id)
        .reduce((sum: number, t: any) => sum + Number(t.remaining), 0);
      const computedQty = qtyFromMovements.has(p.id)
        ? Math.max(0, qtyFromMovements.get(p.id)!)
        : p.quantity;
      return { ...p, quantity: computedQty, in_transit: totalInTransit };
    });

    // Recalcular productWarehouse.quantity desde movements con warehouse_id
    const qtyPerWarehouse = new Map<string, number>();
    for (const m of effectiveMovements) {
      if (!(m as any).warehouse_id) continue;
      const key = `${m.product_id}::${(m as any).warehouse_id}`;
      const current = qtyPerWarehouse.get(key) || 0;
      if (m.type === 'ENTRADA') qtyPerWarehouse.set(key, current + Number(m.quantity));
      else if (m.type === 'SALIDA' || m.type === 'MERMA') qtyPerWarehouse.set(key, current - Number(m.quantity));
      else if (m.type === 'AJUSTE') qtyPerWarehouse.set(key, current + Number(m.quantity));
    }

    const effectiveProductWarehouse = productWarehouseData ?? currentState.productWarehouse;
    const productWarehouseWithTransit = effectiveProductWarehouse.map((pw: any) => {
      const transitForWarehouse = effectiveTransitItems
        .filter((t: any) => t.product_id === pw.product_id && t.warehouse_id === pw.warehouse_id)
        .reduce((sum: number, t: any) => sum + Number(t.remaining), 0);
      const key = `${pw.product_id}::${pw.warehouse_id}`;
      const computedQty = qtyPerWarehouse.has(key)
        ? Math.max(0, qtyPerWarehouse.get(key)!)
        : pw.quantity;
      return { ...pw, quantity: computedQty, in_transit: transitForWarehouse };
    });

    set({
      products: productsWithTransit,
      movements: effectiveMovements,
      sales: salesData ?? currentState.sales,
      recipes: recipesData ?? currentState.recipes,
      employees: employeesData ?? currentState.employees,
      categories: categoriesData ?? currentState.categories,
      transitItems: effectiveTransitItems,
      dailyClosings: dailyClosingsData ?? currentState.dailyClosings,
      hrDocuments: hrDocsData ?? currentState.hrDocuments,
      departments: departmentsData ?? currentState.departments,
      payrollConfig: payrollConfigData !== null ? payrollConfigData : currentState.payrollConfig,
      employeeLoans: employeeLoansData ?? currentState.employeeLoans,
      pendingAccounts: pendingData ?? currentState.pendingAccounts,
      accessPins: accessPinsData ?? currentState.accessPins,
      actionLogs: actionLogsData ?? currentState.actionLogs,
      warehouses: warehousesData ?? currentState.warehouses,
      productWarehouse: productWarehouseWithTransit,
      isLoading: false,
    });

    logger.info('✅ Datos cargados completamente');
    localStorage.setItem('lastSyncedAt', new Date().toISOString());

    // Cache solo los grupos que se cargaron exitosamente (no pisar Dexie con nulls)
    cacheAllData({
      ...(productsData !== null && { products: productsWithTransit }),
      ...(movementsData !== null && { movements: effectiveMovements }),
      ...(warehousesData !== null && { warehouses: warehousesData }),
      ...(productWarehouseData !== null && { productWarehouse: productWarehouseWithTransit }),
      ...(transitItemsData !== null && { transitItems: transitItemsData }),
      ...(salesData !== null && { sales: salesData }),
      ...(recipesData !== null && { recipes: recipesData }),
      ...(pendingData !== null && { pendingAccounts: pendingData }),
      ...(dailyClosingsData !== null && { dailyClosings: dailyClosingsData }),
      ...(employeesData !== null && { employees: employeesData }),
      ...(categoriesData !== null && { categories: categoriesData }),
      ...(accessPinsData !== null && { accessPins: accessPinsData }),
    }, user.id);

    // Si no hay productos ni movimientos, restaurar desde caché
    if ((productsData === null || productsData.length === 0) && (movementsData === null || movementsData.length === 0)) {
      logger.warn('⚠️ fetchAll no obtuvo productos ni movimientos — restaurando caché');
      await restoreFromCache(user.id);
    }

    // Auto-crear almacén "Almacén" para usuarios nuevos
    if (warehousesData === null || warehousesData.length === 0) {
      logger.info('⚠️ No hay warehouses — disparando fetchWarehouses para auto-crear el principal');
      await get().fetchWarehouses();
    } else if (!get().currentWarehouseId) {
      const mainWarehouse = warehousesData.find((w: any) => w.is_main) || warehousesData[0];
      if (mainWarehouse) {
        set({ currentWarehouseId: mainWarehouse.id });
      }
    }
    _isFetchingAll = false;
  },

  fetchMore: async (limit = 50) => {
    const user = useAuthStore.getState().user;
    if (!user || get().isLoading) {
      return { hasMore: false };
    }

    try {
      const currentProducts = get().products;
      const currentMovements = get().movements;
      const currentSales = get().sales;
      const currentActionLogs = get().actionLogs;

      const lastProduct = currentProducts[currentProducts.length - 1];
      const lastMovement = currentMovements[currentMovements.length - 1];
      const lastSale = currentSales[currentSales.length - 1];
      const lastLog = currentActionLogs[currentActionLogs.length - 1];

      const [productsRes, movementsRes, salesRes, actionLogsRes] = await Promise.all([
        lastProduct 
          ? supabase.from('products').select('*').eq('user_id', user.id).order('created_at', { ascending: false }).lt('created_at', lastProduct.created_at).limit(limit)
          : Promise.resolve({ data: [], count: 0, error: null }),
        lastMovement
          ? supabase.from('movements').select('*').eq('user_id', user.id).order('created_at', { ascending: false }).lt('created_at', lastMovement.created_at).limit(limit)
          : Promise.resolve({ data: [], count: 0, error: null }),
        lastSale
          ? supabase.from('sales').select('*, sale_items(*)').eq('user_id', user.id).order('created_at', { ascending: false }).lt('created_at', lastSale.created_at).limit(limit)
          : Promise.resolve({ data: [], count: 0, error: null }),
        lastLog
          ? supabase.from('action_logs').select('*').eq('user_id', user.id).order('created_at', { ascending: false }).lt('created_at', lastLog.created_at).limit(limit)
          : Promise.resolve({ data: [], count: 0, error: null }),
      ]);

      const newSales = salesRes.data?.map((s: any) => ({
        ...s,
        items: s.sale_items || [],
      })) || [];

      const hasMoreProducts = productsRes.data?.length === limit;
      const hasMoreMovements = movementsRes.data?.length === limit;
      const hasMoreSales = newSales.length === limit;
      const hasMoreLogs = actionLogsRes.data?.length === limit;

      set({
        products: [...currentProducts, ...(productsRes.data || [])],
        movements: [...currentMovements, ...(movementsRes.data || [])],
        sales: [...currentSales, ...newSales],
        actionLogs: [...currentActionLogs, ...(actionLogsRes.data || [])],
      });

      return { 
        hasMore: hasMoreProducts || hasMoreMovements || hasMoreSales || hasMoreLogs 
      };
    } catch (error) {
      logger.error('Error en fetchMore:', error);
      return { hasMore: false };
    }
  },

addProduct: async (product) => {
    const { user } = useAuthStore.getState();
    if (!user) throw new Error('No hay usuario autenticado');

    const isDuplicate = get().products.some(
      p => p.user_id === user.id && p.is_active === true && normalizeStr(p.name) === normalizeStr(product.name)
    );

    if (isDuplicate) {
      throw new Error(`El producto "${product.name}" ya existe.`);
    }

    const productId = crypto.randomUUID();
    const now = new Date().toISOString();

    const productData: Product = {
      ...product,
      id: productId,
      name: capitalize(product.name),
      category: capitalize(product.category),
      user_id: user.id,
      expiration_date: product.expiration_date || null,
      created_at: now,
      updated_at: now,
    } as Product;

    const saveProductOffline = async (silent?: boolean) => {
      set((state) => ({ products: [productData, ...state.products] }));
      const mainWarehouse = get().warehouses.find(w => w.is_main) || get().warehouses[0];
      let pwEntry: any = null;
      if (mainWarehouse && Number(product.quantity) > 0) {
        pwEntry = {
          id: crypto.randomUUID(), product_id: productId, warehouse_id: mainWarehouse.id,
          quantity: Number(product.quantity), in_transit: 0, updated_at: now,
        };
        set((state) => ({ productWarehouse: [...state.productWarehouse, pwEntry] }));
      }

      const payload: any = { product: productData };
      let offlineMovement: Movement | null = null;
      if (Number(product.quantity) > 0) {
        const movementId = crypto.randomUUID();
        offlineMovement = {
          id: movementId, user_id: user.id, product_id: productId, type: 'ENTRADA',
          quantity: Number(product.quantity), unit: product.unit, date: now,
          cost: Number(product.cost), reason: 'Stock inicial (Registro de producto)',
          status: 'NORMAL', warehouse_id: mainWarehouse?.id || undefined, created_at: now,
        };
        payload.movement = offlineMovement;
        set((state) => ({ movements: [offlineMovement!, ...state.movements] }));
        if (mainWarehouse) {
          payload.productWarehouse = [{
            product_id: productId, warehouse_id: mainWarehouse.id,
            quantity: Number(product.quantity), in_transit: 0,
          }];
        }
      }

      await addToSyncQueue({ operation: 'addProduct', table: 'products', payload });
      get().refreshSyncQueueCount();
      try { await db.products.put(productData).catch(() => {}); } catch {}
      if (pwEntry) try { await db.productWarehouse.put(pwEntry).catch(() => {}); } catch {}
      if (offlineMovement) try { await db.movements.put(offlineMovement).catch(() => {}); } catch {}
      if (!silent) {
        toast.success('Producto guardado localmente — se sincronizará al reconectar');
      }
    };

    if (!navigator.onLine) {
      await saveProductOffline();
      return;
    }

    trackLocalCreation(productId);
    try {
      const { data, error } = await queryWithRetry(() =>
        supabase
          .from('products')
          .insert(productData)
          .select()
          .single()
      );

      if (error) {
        logger.error('Error adding product:', error);
        if (isNetworkError(error)) {
          await saveProductOffline();
          return;
        }
        throw new Error(error.message || 'Error al crear el producto');
      }

      if (Number(product.quantity) > 0) {
        const mainWarehouse = get().warehouses.find(w => w.is_main) || get().warehouses[0];
        
        const { error: movementError } = await queryWithRetry(() =>
          supabase
            .from('movements')
            .insert({
              user_id: user.id,
              product_id: data.id,
              type: 'ENTRADA',
              quantity: Number(product.quantity),
              unit: product.unit,
              date: now,
              cost: Number(product.cost),
              reason: 'Stock inicial (Registro de producto)',
              status: 'NORMAL',
              warehouse_id: mainWarehouse?.id || null,
            })
        );

        if (movementError && import.meta.env.DEV) {
          logger.error('Error creating initial movement:', movementError);
        }
      }

      const warehouses = get().warehouses;
      const mainWarehouse = warehouses.find(w => w.is_main) || warehouses[0];
      for (const warehouse of warehouses) {
        const initialQty = (warehouse.id === mainWarehouse?.id) ? Number(product.quantity) || 0 : 0;
        await queryWithRetry(() =>
          supabase.from('product_warehouse').upsert({
            product_id: data.id,
            warehouse_id: warehouse.id,
            quantity: initialQty,
            in_transit: 0
          }, { onConflict: 'product_id,warehouse_id' })
        );
      }

      await get().fetchProductWarehouse();
      await get().fetchAll();

      toast.success('Producto guardado exitosamente');
    } catch (error: any) {
      logger.error('Error en addProduct:', error);
      throw new Error(error.message || 'Error al crear el producto');
    } finally {
      untrackLocalCreation(productId);
    }
  },

  updateProduct: async (id, updates) => {
    const { user } = useAuthStore.getState();
    if (!user) throw new Error('No hay usuario autenticado');

    if (updates.name !== undefined) {
      const isDuplicate = get().products.some(
        p => p.id !== id && p.user_id === user.id && p.is_active === true && normalizeStr(p.name) === normalizeStr(updates.name!)
      );

      if (isDuplicate) {
        throw new Error(`El producto "${updates.name}" ya existe.`);
      }
    }

    const capitalizedUpdates = {
      ...updates,
      ...(updates.name !== undefined && { name: capitalize(updates.name) }),
      ...(updates.category !== undefined && { category: capitalize(updates.category) }),
      updated_at: new Date().toISOString(),
    };

    if (!navigator.onLine) {
      set((state) => ({
        products: state.products.map(p => p.id === id ? { ...p, ...updates, updated_at: new Date().toISOString() } : p),
      }));
      await addToSyncQueue({ operation: 'updateProduct', table: 'products', payload: { id, updates: capitalizedUpdates } });
      get().refreshSyncQueueCount();
      try { await db.products.put({ ...get().products.find(p => p.id === id), ...updates, updated_at: new Date().toISOString() } as any).catch(() => {}); } catch {}
      toast.success('Producto actualizado localmente (sin conexión)');
      return;
    }

    const { error } = await queryWithRetry(() =>
      supabase
        .from('products')
        .update(capitalizedUpdates)
        .eq('id', id)
    );

    if (error) {
      if (isNetworkError(error)) {
        await addToSyncQueue({ operation: 'updateProduct', table: 'products', payload: { id, updates: capitalizedUpdates } });
        get().refreshSyncQueueCount();
        toast.success('Producto actualizado localmente — se sincronizará al reconectar');
        return;
      }
      throw new Error('No se pudo actualizar el producto');
    }

    set((state) => ({
      products: state.products.map(p => p.id === id ? { ...p, ...updates, updated_at: new Date().toISOString() } : p),
    }));
  },

  deleteProduct: async (id) => {
    if (!navigator.onLine) {
      set((state) => ({
        products: state.products.map(p => p.id === id ? { ...p, is_active: false } : p),
      }));
      await addToSyncQueue({ operation: 'deleteProduct', table: 'products', payload: { id } });
      get().refreshSyncQueueCount();
      const productToDeactivate = get().products.find(p => p.id === id);
      try { if (productToDeactivate) await db.products.put({ ...productToDeactivate, is_active: false }).catch(() => {}); } catch {}
      toast.success('Producto eliminado (sin conexión)');
      return;
    }

    const { error } = await queryWithRetry(() =>
      supabase
        .from('products')
        .update({ is_active: false, updated_at: new Date().toISOString() })
        .eq('id', id)
    );

    if (error) {
      if (isNetworkError(error)) {
        await addToSyncQueue({ operation: 'deleteProduct', table: 'products', payload: { id } });
        get().refreshSyncQueueCount();
        toast.success('Producto eliminado — se sincronizará al reconectar');
        return;
      }
      throw new Error('No se pudo eliminar el producto');
    }

    set((state) => ({
      products: state.products.map(p => p.id === id ? { ...p, is_active: false } : p),
    }));
    toast.success('Producto eliminado');
  },

  addMovement: async (movement) => withMovementLock(async () => {
    const user = useAuthStore.getState().user;
    if (!user) throw new Error('No hay usuario autenticado');

    const movementDate = movement.date || new Date().toISOString();
    if (isDateClosed(get().dailyClosings, new Date(movementDate).toISOString().split('T')[0])) {
      throw new Error('El día está cerrado, no se pueden registrar movimientos');
    }
    const product = get().products.find(p => p.id === movement.product_id);
    if (!product) throw new Error('Producto no encontrado');

    const saveOffline = async () => {
      const movementId = crypto.randomUUID();
      const offlineMovement = { ...movement, id: movementId, user_id: user.id, date: movementDate, created_at: new Date().toISOString() } as Movement;

      if (movement.warehouse_id) {
        const pw = get().productWarehouse.find(p => p.product_id === movement.product_id && p.warehouse_id === movement.warehouse_id);
        const currentQty = pw ? Number(pw.quantity) : 0;
        let newQty = currentQty;
        if (movement.type === 'ENTRADA') newQty = currentQty + Number(movement.quantity);
        else if (movement.type === 'SALIDA') {
          if (currentQty < Number(movement.quantity)) {
            throw new Error(`Stock insuficiente en almacén para ${product.name}: disponible ${currentQty}, solicitado ${movement.quantity}`);
          }
          newQty = currentQty - Number(movement.quantity);
        }
        else if (movement.type === 'MERMA') {
          if (currentQty < Number(movement.quantity)) {
            throw new Error(`Stock insuficiente en almacén para ${product.name}: disponible ${currentQty}, solicitado ${movement.quantity}`);
          }
          newQty = Math.max(0, currentQty - Number(movement.quantity));
        }
        else if (movement.type === 'AJUSTE') newQty = Math.max(0, currentQty + Number(movement.quantity));

        set((state) => ({
          productWarehouse: state.productWarehouse.map(pw =>
            pw.product_id === movement.product_id && pw.warehouse_id === movement.warehouse_id
              ? { ...pw, quantity: newQty } : pw
          ),
          products: movement.type !== 'SALIDA' ? state.products.map(p =>
            p.id === movement.product_id
              ? { ...p, quantity: Math.max(0, newQty) }
              : p
          ) : state.products,
        }));

        if (movement.type === 'ENTRADA') {
          const unitCost = Number(movement.cost) || Number(product.cost);
          const currentTotalValue = currentQty * Number(product.cost);
          const newTotalValue = Number(movement.quantity) * unitCost;
          const totalQty = currentQty + Number(movement.quantity);

          if (totalQty > 0) {
            const newCost = (currentTotalValue + newTotalValue) / totalQty;
            set((state) => ({
              products: state.products.map(p =>
                p.id === movement.product_id ? { ...p, cost: newCost } : p
              ),
            }));
          }
        }

        if (movement.type === 'SALIDA') {
          const transitId = crypto.randomUUID();
          const transitItem = {
            id: transitId, user_id: user.id, product_id: movement.product_id,
            quantity: Number(movement.quantity), consumed: 0, remaining: Number(movement.quantity),
            reason: movement.reason || 'Enviado a cocina/preparacion', sent_date: movementDate,
            created_at: new Date().toISOString(),
            warehouse_id: movement.warehouse_id,
          } as TransitItem;
          set((state) => ({
            transitItems: [transitItem, ...state.transitItems],
            products: state.products.map(p =>
              p.id === movement.product_id
                ? { ...p, quantity: Math.max(0, Number(p.quantity || 0) - Number(movement.quantity)), in_transit: Number(p.in_transit || 0) + Number(movement.quantity) }
                : p
            ),
          }));
        }
      } else {
        let newQuantity = Number(product.quantity);
        let newInTransit = Number(product.in_transit) || 0;
        if (movement.type === 'ENTRADA') newQuantity += Number(movement.quantity);
        else if (movement.type === 'SALIDA') {
          if (newQuantity < Number(movement.quantity)) {
            throw new Error(`Stock insuficiente para ${product.name}: disponible ${newQuantity}, solicitado ${movement.quantity}`);
          }
          newQuantity = newQuantity - Number(movement.quantity);
          newInTransit += Number(movement.quantity);
        }
        else if (movement.type === 'MERMA') {
          if (newQuantity < Number(movement.quantity)) {
            throw new Error(`Stock insuficiente para ${product.name}: disponible ${newQuantity}, solicitado ${movement.quantity}`);
          }
          newQuantity -= Number(movement.quantity);
        }
        else if (movement.type === 'AJUSTE') newQuantity += Number(movement.quantity);

        set((state) => ({
          products: state.products.map(p => p.id === movement.product_id
            ? { ...p, quantity: Math.max(0, newQuantity), in_transit: movement.type === 'SALIDA' ? newInTransit : p.in_transit } : p
          ),
        }));

        if (movement.type === 'SALIDA') {
          const transitId = crypto.randomUUID();
          const transitItem = {
            id: transitId, user_id: user.id, product_id: movement.product_id,
            quantity: Number(movement.quantity), consumed: 0, remaining: Number(movement.quantity),
            reason: movement.reason || 'Enviado a cocina/preparacion', sent_date: movementDate,
            created_at: new Date().toISOString(),
            warehouse_id: movement.warehouse_id,
          } as TransitItem;
          set((state) => ({ transitItems: [transitItem, ...state.transitItems] }));
        }
      }

      set((state) => ({ movements: [offlineMovement, ...state.movements] }));

      await addToSyncQueue({ operation: 'addMovement', table: 'movements', payload: { ...movement, id: movementId, user_id: user.id, date: movementDate, created_at: offlineMovement.created_at, product_name: product.name } });
      get().refreshSyncQueueCount();
      toast.success('Movimiento guardado localmente (sin conexión)');
      try {
        await db.movements.put(offlineMovement).catch(() => {});
        await db.products.bulkPut(get().products).catch(() => {});
        await db.transitItems.bulkPut(get().transitItems).catch(() => {});
        await db.productWarehouse.bulkPut(get().productWarehouse).catch(() => {});
      } catch {}
    };

    if (!navigator.onLine) {
      await saveOffline();
      return;
    }

    const movementId = crypto.randomUUID();
    trackLocalCreation(movementId);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Sesión expirada. Por favor, inicia sesión nuevamente.');

      const { data: newMovement, error: movementError } = await queryWithRetry(() =>
        supabase
          .from('movements')
          .insert({ ...movement, id: movementId, user_id: user.id, date: movementDate })
          .select()
          .single()
      );

      if (movementError) {
        logger.error('Error addMovement:', movementError);
        // Error de red (503 de customFetch) → guardar offline en vez de fallar
        if (movementError.status === 503) {
          logger.warn('⚠️ Error de red en addMovement — guardando offline');
          await saveOffline();
          return;
        }
        throw new Error(movementError.message || 'No se pudo registrar el movimiento');
      }

      if (movement.warehouse_id) {
        const pw = get().productWarehouse.find(
          p => p.product_id === movement.product_id && p.warehouse_id === movement.warehouse_id
        );
        const currentQty = pw ? Number(pw.quantity) : 0;

        if (movement.type === 'ENTRADA') {
          logger.info('🔄 ENTRADA: Actualizando quantity para ENTRADA...');
          const newQty = currentQty + Number(movement.quantity);
          await get().updateProductWarehouseQuantity(movement.product_id, movement.warehouse_id, newQty, true);
          logger.info('✅ ENTRADA: Quantity actualizado');

          // Costo promedio ponderado sobre product.cost
          const unitCost = Number(movement.cost) || Number(product.cost);
          const currentTotalValue = currentQty * Number(product.cost);
          const newTotalValue = Number(movement.quantity) * unitCost;
          const totalQty = currentQty + Number(movement.quantity);

          if (totalQty > 0) {
            const newCost = (currentTotalValue + newTotalValue) / totalQty;
            await get().updateProduct(movement.product_id, { cost: newCost });
          }

          set((state) => ({
            products: state.products.map(p =>
              p.id === movement.product_id
                ? { ...p, quantity: Math.max(0, Number(p.quantity || 0) + Number(movement.quantity)) }
                : p
            ),
          }));
        } else if (movement.type === 'SALIDA') {
          if (currentQty < Number(movement.quantity)) {
            throw new Error(`Stock insuficiente en almacén para ${product.name}: disponible ${currentQty}, solicitado ${movement.quantity}`);
          }
          const newQty = currentQty - Number(movement.quantity);
          await get().updateProductWarehouseQuantity(movement.product_id, movement.warehouse_id, newQty, true);
          try {
            const { data: newTransitItem, error: transitError } = await queryWithRetry(() =>
              supabase
                .from('transit_items')
                .insert({
                  user_id: user.id,
                  product_id: movement.product_id,
                  quantity: Number(movement.quantity),
                  consumed: 0,
                  remaining: Number(movement.quantity),
                  reason: movement.reason || 'Enviado a cocina/preparacion',
                  sent_date: movementDate,
                  warehouse_id: movement.warehouse_id,
                })
                .select()
                .single()
            );

            if (transitError) {
              logger.error('❌ SALIDA: Error creando transit_item:', transitError);
            } else if (newTransitItem) {
              logger.info('✅ SALIDA: transit_item creado');
              set((state) => ({
                transitItems: [newTransitItem, ...state.transitItems],
                products: state.products.map(p =>
                  p.id === movement.product_id
                    ? {
                        ...p,
                        quantity: Math.max(0, Number(p.quantity || 0) - Number(movement.quantity)),
                        in_transit: Number(p.in_transit || 0) + Number(movement.quantity),
                      }
                    : p
                ),
              }));
            }
          } catch (err) {
            logger.error('❌ SALIDA: Error en transit_item:', err);
          }
        } else if (movement.type === 'MERMA') {
          if (currentQty < Number(movement.quantity)) {
            throw new Error(`Stock insuficiente en almacén para ${product.name}: disponible ${currentQty}, solicitado ${movement.quantity}`);
          }
          await get().updateProductWarehouseQuantity(movement.product_id, movement.warehouse_id, Math.max(0, currentQty - Number(movement.quantity)), true);
          set((state) => ({
            products: state.products.map(p =>
              p.id === movement.product_id
                ? { ...p, quantity: Math.max(0, Number(p.quantity || 0) - Number(movement.quantity)) }
                : p
            ),
          }));
        } else if (movement.type === 'AJUSTE') {
          await get().updateProductWarehouseQuantity(movement.product_id, movement.warehouse_id, Math.max(0, currentQty + Number(movement.quantity)), true);
          set((state) => ({
            products: state.products.map(p =>
              p.id === movement.product_id
                ? { ...p, quantity: Math.max(0, Number(p.quantity || 0) + Number(movement.quantity)) }
                : p
            ),
          }));
        }

        set((state) => ({ movements: [newMovement, ...state.movements] }));
        try {
          const s = get();
          await db.movements.put(newMovement).catch(() => {});
          await db.products.bulkPut(s.products).catch(() => {});
          await db.transitItems.bulkPut(s.transitItems).catch(() => {});
          await db.productWarehouse.bulkPut(s.productWarehouse).catch(() => {});
        } catch {}
        return;
      }

      let newQuantity = Number(product.quantity);
      let newInTransit = Number(product.in_transit) || 0;
      let newCost = Number(product.cost);

      if (movement.type === 'ENTRADA') {
        const unitCost = Number(movement.cost) || Number(product.cost);
        const currentTotalValue = Number(product.quantity) * Number(product.cost);
        const newTotalValue = Number(movement.quantity) * unitCost;
        newQuantity = Number(product.quantity) + Number(movement.quantity);
        
        if (newQuantity > 0) {
          newCost = (currentTotalValue + newTotalValue) / newQuantity;
        }
        
        await get().updateProduct(movement.product_id, { quantity: newQuantity, cost: newCost });
      } else if (movement.type === 'SALIDA') {
        logger.info('🔄 SALIDA (sin warehouse): Actualizando quantity e in_transit...');
        if (Number(product.quantity) < Number(movement.quantity)) {
          throw new Error(`Stock insuficiente para ${product.name}: disponible ${product.quantity}, solicitado ${movement.quantity}`);
        }
        newQuantity = Number(product.quantity) - Number(movement.quantity);
        newInTransit = newInTransit + Number(movement.quantity);
        await get().updateProduct(movement.product_id, { quantity: newQuantity, in_transit: newInTransit });
        logger.info('✅ SALIDA (sin warehouse): quantity e in_transit actualizados');
        
        logger.info('🔄 SALIDA (sin warehouse): Creando transit_item...');
        const { data: newTransitItem, error: transitError } = await queryWithRetry(() =>
          supabase
            .from('transit_items')
            .insert({
              user_id: user.id,
              product_id: movement.product_id,
              quantity: Number(movement.quantity),
              consumed: 0,
              remaining: Number(movement.quantity),
              reason: movement.reason || 'Enviado a cocina/preparacion',
              sent_date: movementDate,
            })
            .select()
            .single()
        );

        if (transitError) {
          logger.error('❌ SALIDA (sin warehouse): Error creando transit_item:', transitError);
        } else {
          logger.info('✅ SALIDA (sin warehouse): transit_item creado');
          set((state) => ({ 
            transitItems: [newTransitItem, ...state.transitItems],
            products: state.products.map(p => 
              p.id === movement.product_id ? { ...p, in_transit: newInTransit } : p
            ),
          }));
        }
      } else if (movement.type === 'MERMA') {
        if (Number(product.quantity) < Number(movement.quantity)) {
          throw new Error(`Stock insuficiente para ${product.name}: disponible ${product.quantity}, solicitado ${movement.quantity}`);
        }
        newQuantity = Number(product.quantity) - Number(movement.quantity);
        
        await get().updateProduct(movement.product_id, { quantity: newQuantity });
      } else if (movement.type === 'AJUSTE') {
        newQuantity = Number(product.quantity) + Number(movement.quantity);

        await get().updateProduct(movement.product_id, { quantity: Math.max(0, newQuantity) });
      }

      set((state) => ({ movements: [newMovement, ...state.movements] }));
      try {
        const s = get();
        await db.movements.put(newMovement).catch(() => {});
        await db.products.bulkPut(s.products).catch(() => {});
        await db.transitItems.bulkPut(s.transitItems).catch(() => {});
      } catch {}
    } catch (error: any) {
      const errMsg = error?.message || '';
      const isNetworkErr = errMsg.includes('Failed to fetch') || errMsg.includes('NetworkError') || errMsg.includes('net::ERR_') || errMsg.includes('TypeError');
      if (isNetworkErr) {
        logger.warn('⚠️ Error de red en addMovement — guardando offline:', error);
        await saveOffline();
        return;
      }
      logger.error('Error en addMovement:', error);
      throw new Error(error.message || 'Error al registrar el movimiento');
    } finally {
      untrackLocalCreation(movementId);
    }
  }),

  justifyMovement: async (id, justification) => {
    if (!navigator.onLine) {
      set((state) => ({
        movements: state.movements.map(m =>
          m.id === id ? { ...m, status: 'JUSTIFICADO', justification, justification_date: new Date().toISOString() } : m
        ),
      }));
      await addToSyncQueue({
        operation: 'justifyMovement', table: 'movements',
        payload: { id, justification },
      });
      get().refreshSyncQueueCount();
      try { await db.movements.put(get().movements.find((m: any) => m.id === id) as any).catch(() => {}); } catch {}
      return;
    }

    try {
      const { error } = await queryWithRetry(() =>
        supabase
          .from('movements')
          .update({ 
            status: 'JUSTIFICADO', 
            justification, 
            justification_date: new Date().toISOString() 
          })
          .eq('id', id)
      );

      if (error) {
        throw new Error('No se pudo justificar el movimiento');
      }

      set((state) => ({
        movements: state.movements.map(m =>
          m.id === id ? { ...m, status: 'JUSTIFICADO', justification, justification_date: new Date().toISOString() } : m
        ),
      }));
    } catch (error: any) {
      logger.error('Error en justifyMovement:', error);
      throw new Error(error.message || 'Error al justificar movimiento');
    }
  },

  fetchWarehouses: async () => {
    if (get().isFetchingWarehouses) return;
    set({ isFetchingWarehouses: true });
    try {
      const user = useAuthStore.getState().user;
      if (!user) return;

      const { data, error } = await supabase
        .from('warehouses')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: true });

      if (error) {
        logger.error('Error fetching warehouses:', error);
        return;
      }

      let warehouses = data as Warehouse[];

      // Auto-crear Almacén Principal si no existe ninguno
      if (warehouses.length === 0) {
        const { data: newWarehouse, error: createError } = await supabase
          .from('warehouses')
          .insert({ user_id: user.id, name: 'Almacén', is_main: true })
          .select()
          .single();

        if (createError) {
          if (createError.code !== '23505') {
            logger.error('Error auto-creating warehouse:', createError);
          }
          // Duplicado por race condition: re-fetch
          const { data: existing } = await supabase
            .from('warehouses')
            .select('*')
            .eq('user_id', user.id)
            .order('created_at', { ascending: true });
          if (existing && existing.length > 0) {
            warehouses = existing as Warehouse[];
          }
        } else if (newWarehouse) {
          warehouses = [newWarehouse as Warehouse];
        }
      }

      set({ warehouses });

      const mainWarehouse = warehouses.find(w => w.is_main) || warehouses[0];
      if (mainWarehouse && !get().currentWarehouseId) {
        set({ currentWarehouseId: mainWarehouse.id });
      }
    } finally {
      set({ isFetchingWarehouses: false });
    }
  },

  setCurrentWarehouse: (warehouseId: string) => {
    set({ currentWarehouseId: warehouseId });
  },

  fetchProductWarehouse: async (skipAutoHeal: boolean = false) => {
    const user = useAuthStore.getState().user;
    if (!user) return;
    
    const { data, error } = await supabase
      .from('product_warehouse')
      .select('*');
    
    if (error) {
      logger.error('Error fetching product_warehouse:', error);
      return;
    }
    
    if (skipAutoHeal) {
      set({ productWarehouse: data as ProductWarehouse[] });
      return;
    }
    
    // Auto-heal: detectar y corregir entradas faltantes o con valores incorrectos
    const warehouses = get().warehouses;
    const products = get().products.filter(p => p.is_active !== false);
    const mainWarehouse = warehouses.find(w => w.is_main) || warehouses[0];
    
    let created = 0;
    for (const warehouse of warehouses) {
      for (const product of products) {
        const existingPw = data.find(
          pw => pw.product_id === product.id && pw.warehouse_id === warehouse.id
        );
        const expectedQty = (warehouse.id === mainWarehouse?.id) ? Number(product.quantity) || 0 : 0;
        
        // Crear o actualizar: siempre hace UPSERT para corregir valores incorrectos
        if (!existingPw || Number(existingPw.quantity) !== expectedQty) {
          await supabase.from('product_warehouse').upsert({
            product_id: product.id,
            warehouse_id: warehouse.id,
            quantity: expectedQty,
            in_transit: Number(product.in_transit) || 0
          }, { onConflict: 'product_id,warehouse_id' });
          created++;
        }
      }
    }
    
    if (created > 0) {
      logger.info(`🔧 Auto-heal product_warehouse: ${created} entradas creadas`);
      // Volver a fetch si se crearon nuevas
      const { data: newData } = await supabase.from('product_warehouse').select('*');
      set({ productWarehouse: newData as ProductWarehouse[] });
    } else {
      set({ productWarehouse: data as ProductWarehouse[] });
    }
  },

  updateProductWarehouseQuantity: async (productId: string, warehouseId: string, quantity: number, skipAutoHeal: boolean = false) => {
    const existing = get().productWarehouse.find(pw => pw.product_id === productId && pw.warehouse_id === warehouseId);
    
    if (existing) {
      await supabase
        .from('product_warehouse')
        .update({ quantity, updated_at: new Date().toISOString() })
        .eq('id', existing.id);
    } else {
      await supabase
        .from('product_warehouse')
        .insert({ product_id: productId, warehouse_id: warehouseId, quantity, in_transit: 0 });
    }
    
    await get().fetchProductWarehouse(skipAutoHeal);
  },

  addSale: async (sale) => {
    const user = useAuthStore.getState().user;
    if (!user) return { success: false, error: 'No hay usuario autenticado' };

    const saleDate = new Date(sale.date).toISOString().split('T')[0];
    if (isDateClosed(get().dailyClosings, saleDate)) {
      return { success: false, error: 'El día está cerrado, no se pueden registrar ventas' };
    }

    const itemsToConsume: { productId: string; name: string; qtyNeeded: number; qtyAvailable: number }[] = [];
    const productsMap = new Map(get().products.map(p => [p.id, p]));
    const transitMap = new Map<string, number>();
    for (const t of get().transitItems) {
      const current = transitMap.get(t.product_id) || 0;
      transitMap.set(t.product_id, current + t.remaining);
    }

    for (const item of sale.items) {
      if (!item.is_recipe) {
        const transitAvailable = transitMap.get(item.product_id) || 0;
        const product = productsMap.get(item.product_id);
        const productName = product?.name || 'producto';
        
        if (transitAvailable < item.quantity) {
          return { 
            success: false, 
            error: `No hay suficiente "${productName}" en transito. Necesitas: ${item.quantity}, Disponible: ${transitAvailable}` 
          };
        }
        itemsToConsume.push({ productId: item.product_id, name: productName, qtyNeeded: item.quantity, qtyAvailable: transitAvailable });
      } else if (item.is_recipe && item.recipe_snapshot) {
        for (const ing of item.recipe_snapshot.ingredients) {
          const transitAvailable = transitMap.get(ing.product_id) || 0;
          const needed = ing.quantity * item.quantity;
          
          const ingProduct = productsMap.get(ing.product_id);
          const ingProductName = ingProduct?.name || 'ingrediente';
          
          if (transitAvailable < needed) {
            return { 
              success: false, 
              error: `No hay suficiente "${ingProductName}" en transito para la receta "${item.recipe_snapshot?.name}". Necesitas: ${needed}, Disponible: ${transitAvailable}` 
            };
          }
          const existingIdx = itemsToConsume.findIndex(i => i.productId === ing.product_id);
          if (existingIdx >= 0) {
            itemsToConsume[existingIdx].qtyNeeded += needed;
          } else {
            itemsToConsume.push({ productId: ing.product_id, name: ingProductName, qtyNeeded: needed, qtyAvailable: transitAvailable });
          }
        }
      }
    }

    if (!navigator.onLine) {
      const tempId = crypto.randomUUID();
      const tempSale = {
        id: tempId,
        user_id: user.id,
        employee_id: sale.employee_id,
        total_amount: sale.total_amount,
        date: sale.date,
        sale_type: sale.sale_type,
        is_account_house: sale.is_account_house || false,
        notes: sale.notes,
        discount: sale.discount,
        payment_method: sale.payment_method || null,
        efectivo: sale.efectivo || 0,
        transferencia: sale.transferencia || 0,
        usd: sale.usd || 0,
        eur: sale.eur || 0,
        created_at: new Date().toISOString(),
      };
      const saleItems = sale.items.map(item => ({
        sale_id: tempId,
        product_id: item.product_id,
        product_name: item.is_recipe ? (item.recipe_snapshot?.name || 'Receta') : (productsMap.get(item.product_id)?.name || 'Producto'),
        quantity: item.quantity,
        unit_cost: item.unit_cost,
        selling_price: item.selling_price,
        subtotal: item.subtotal,
        is_recipe: item.is_recipe || false,
        recipe_snapshot: item.recipe_snapshot,
      }));
      const saleWithItems = { ...tempSale, items: saleItems };
      set((state) => ({ sales: [saleWithItems, ...state.sales] }));
      try { await db.sales.put(saleWithItems).catch(() => {}); } catch {}
      for (const ci of itemsToConsume) {
        set((state) => {
          let remainingLocal = ci.qtyNeeded;
          let consumedLocal = 0;
          const updatedTransitItems = [...state.transitItems]
            .sort((a, b) => new Date(a.sent_date).getTime() - new Date(b.sent_date).getTime())
            .map(t => {
              if (t.product_id !== ci.productId || t.remaining <= 0) return t;
              if (remainingLocal <= 0) return t;
              const toConsume = Math.min(t.remaining, remainingLocal);
              remainingLocal -= toConsume;
              consumedLocal += toConsume;
              return { ...t, remaining: t.remaining - toConsume, consumed: (t.consumed || 0) + toConsume };
            });
          const newInTransit = Math.max(0, Number(state.products.find(p => p.id === ci.productId)?.in_transit || 0) - consumedLocal);
          return {
            transitItems: updatedTransitItems,
            products: state.products.map(p =>
              p.id === ci.productId ? { ...p, in_transit: newInTransit } : p
            ),
          };
        });
      }
      const unfilteredTransitItems = get().transitItems;
      set((state) => ({
        transitItems: state.transitItems.filter(t => t.remaining > 0)
      }));
      try {
        await db.transitItems.bulkPut(unfilteredTransitItems).catch(() => {});
        await db.products.bulkPut(get().products).catch(() => {});
      } catch {}
      await addToSyncQueue({ operation: 'addSale', table: 'sales', payload: { sale: tempSale, sale_items: saleItems, tempId, itemsToConsume } });
      get().refreshSyncQueueCount();
      toast.success('Venta guardada localmente (sin conexión)');
      return { success: true };
    }

    const saleId = crypto.randomUUID();
    trackLocalCreation(saleId);
    try {
      const { data: newSale, error: saleError } = await queryWithRetry(() =>
        supabase
          .from('sales')
          .insert({ 
            id: saleId,
            user_id: user.id, 
            employee_id: sale.employee_id,
            total_amount: sale.total_amount,
            date: sale.date,
            sale_type: sale.sale_type,
            is_account_house: sale.is_account_house || false,
            notes: sale.notes,
            discount: sale.discount,
            payment_method: sale.payment_method || null,
            efectivo: sale.efectivo || 0,
            transferencia: sale.transferencia || 0,
            usd: sale.usd || 0,
            eur: sale.eur || 0,
          })
          .select()
          .single()
      );

      if (saleError) {
        logger.error('Error adding sale:', saleError);
        return { success: false, error: 'Error al registrar la venta' };
      }

      const saleItems = sale.items.map(item => ({
        sale_id: newSale.id,
        product_id: item.product_id,
        quantity: item.quantity,
        unit_cost: item.unit_cost,
        selling_price: item.selling_price,
        subtotal: item.subtotal,
        is_recipe: item.is_recipe || false,
        recipe_snapshot: item.recipe_snapshot,
      }));

      const { error: itemsError } = await queryWithRetry(() =>
        supabase.from('sale_items').insert(saleItems)
      );

      if (itemsError) {
        logger.error('Error adding sale items:', itemsError);
        try { await supabase.from('sales').delete().eq('id', newSale.id); } catch {}
        return { success: false, error: 'Error al registrar los ítems de la venta' };
      }

      for (const item of sale.items) {
        if (!item.is_recipe) {
          await get().consumeFromTransit(item.product_id, item.quantity, `Venta #${newSale.id.slice(0, 8)}`);
        } else if (item.is_recipe && item.recipe_snapshot) {
          for (const ing of item.recipe_snapshot.ingredients) {
            await get().consumeFromTransit(ing.product_id, ing.quantity * item.quantity, `Venta #${newSale.id.slice(0, 8)} (Receta: ${item.recipe_snapshot.name})`);
          }
        }
      }

      const saleWithItems = { ...newSale, items: saleItems };
      set((state) => ({ sales: [saleWithItems, ...state.sales] }));
      try {
        const s = get();
        await db.sales.put(saleWithItems).catch(() => {});
        await db.transitItems.bulkPut(s.transitItems).catch(() => {});
        await db.movements.bulkPut(s.movements).catch(() => {});
        await db.products.bulkPut(s.products).catch(() => {});
      } catch {}
      return { success: true };
    } catch (error: any) {
      logger.error('Error en addSale:', error);
      return { success: false, error: error.message || 'Error al registrar la venta' };
    } finally {
      untrackLocalCreation(saleId);
    }
  },

  consumeFromTransit: async (productId: string, qtyNeeded: number, reason?: string) => {
    const user = useAuthStore.getState().user;
    if (!user) return { success: false, error: 'No hay usuario autenticado' };

    const product = get().products.find(p => p.id === productId);
    if (!product) return { success: false, error: 'Producto no encontrado' };

    if (_isConsumingTransit) return { success: false, error: 'Ya hay un consumo en progreso, espere un momento' };
    _isConsumingTransit = true;
    try {

    let remaining = qtyNeeded;
    const transitItemsForProduct = get().transitItems
      .filter(t => t.product_id === productId && t.remaining > 0)
      .sort((a, b) => new Date(a.sent_date).getTime() - new Date(b.sent_date).getTime());

    const updatedItems: { id: string; newRemaining: number; newConsumed: number; toConsume: number }[] = [];

    if (!navigator.onLine) {
      let remainingLocal = qtyNeeded;
      const consumptionItems: { transitItemId: string; quantity: number }[] = [];
      for (const item of transitItemsForProduct) {
        if (remainingLocal <= 0) break;
        const toConsume = Math.min(item.remaining, remainingLocal);
        consumptionItems.push({ transitItemId: item.id, quantity: toConsume });
        remainingLocal -= toConsume;
      }
      if (remainingLocal > 0) {
        return { success: false, error: 'No habia suficiente cantidad en transito' };
      }
      const consumedQty = consumptionItems.reduce((s, c) => s + c.quantity, 0);
      const updatedTransitItems = get().transitItems
        .map(t => {
          const ci = consumptionItems.find(c => c.transitItemId === t.id);
          if (ci) return { ...t, remaining: Math.max(0, t.remaining - ci.quantity), consumed: (t.consumed || 0) + ci.quantity };
          return t;
        });
      set((state) => ({
        transitItems: updatedTransitItems.filter(t => t.remaining > 0),
        products: state.products.map(p =>
          p.id === productId ? { ...p, in_transit: Math.max(0, Number(p.in_transit || 0) - consumedQty) } : p
        ),
      }));
      for (const ci of consumptionItems) {
        await addToSyncQueue({
          operation: 'registerManualConsumption', table: 'transit_items',
          payload: { transitItemId: ci.transitItemId, quantity: ci.quantity, note: reason || 'Consumo desde tránsito', userId: user.id, productId, productName: product.name },
        });
      }
      get().refreshSyncQueueCount();
      try {
        await db.transitItems.bulkPut(updatedTransitItems).catch(() => {});
        await db.products.bulkPut(get().products).catch(() => {});
      } catch {}
      return { success: true };
    }

    try {
      const totalAvailable = transitItemsForProduct.reduce((sum, item) => sum + item.remaining, 0);
      if (totalAvailable < qtyNeeded) {
        return { success: false, error: 'No habia suficiente cantidad en transito' };
      }

      for (const item of transitItemsForProduct) {
        if (remaining <= 0) break;

        const toConsume = Math.min(item.remaining, remaining);
        const newRemaining = item.remaining - toConsume;
        const newConsumed = item.consumed + toConsume;
        remaining -= toConsume;
        updatedItems.push({ id: item.id, newRemaining, newConsumed, toConsume });

        const { error: te } = await withTimeout(
          Promise.resolve(
            supabase
              .from('transit_items')
              .update({ remaining: newRemaining, consumed: newConsumed, updated_at: new Date().toISOString() })
              .eq('id', item.id)
          ),
          10000
        );
        if (te) throw new Error('No se pudo actualizar el item en tránsito');
      }

      if (remaining > 0) {
        return { success: false, error: 'No habia suficiente cantidad en transito' };
      }

      const newTotalInTransit = updatedItems.reduce((sum, u) => sum + u.newRemaining, 0);
      let newMovement = null;

      const { data: movementData, error: movementError } = await queryWithRetry(() =>
        supabase
          .from('movements')
          .insert({
            user_id: user.id,
            product_id: productId,
            type: 'SALIDA',
            quantity: qtyNeeded,
            unit: product.unit,
            date: new Date().toISOString(),
            cost: Number(product.cost),
            reason: reason || 'Venta de producto/ingrediente',
            status: 'NORMAL'
          })
          .select()
          .single()
      );

      newMovement = movementData;

      if (movementError) {
        logger.error('Error recording sale movement:', movementError);
        throw new Error('No se pudo registrar el movimiento de venta');
      }

      const { error: productError } = await queryWithRetry(() =>
        supabase
          .from('products')
          .update({ 
            in_transit: newTotalInTransit,
            updated_at: new Date().toISOString()
          })
          .eq('id', productId)
      );

      if (productError) {
        throw new Error('No se pudo actualizar el tránsito del producto');
      }

      set((state) => {
        const updatedTransitItems = state.transitItems
          .map(t => {
            const updated = updatedItems.find(u => u.id === t.id);
            if (updated) {
              return { ...t, remaining: updated.newRemaining, consumed: updated.newConsumed };
            }
            return t;
          })
          .filter(t => t.remaining > 0);

        const movements = newMovement ? [newMovement, ...state.movements] : state.movements;

        return {
          transitItems: updatedTransitItems,
          movements,
          products: state.products.map(p => 
            p.id === productId ? { ...p, in_transit: newTotalInTransit } : p
          ),
        };
      });

      try {
        const s = get();
        await db.transitItems.bulkPut(s.transitItems).catch(() => {});
        await db.movements.bulkPut(s.movements).catch(() => {});
        await db.products.bulkPut(s.products).catch(() => {});
      } catch {}

      return { success: true };
    } catch (error: any) {
      logger.error('Error en consumeFromTransit:', error);
      return { success: false, error: error.message || 'Error al consumir de tránsito' };
    }
    } finally {
      _isConsumingTransit = false;
    }
  },

  cancelTransit: async (transitItemId: string, quantity: number, reason: string) => {
    const user = useAuthStore.getState().user;
    if (!user) return { success: false, error: 'No autenticado' };

    const transitItem = get().transitItems.find(t => t.id === transitItemId);
    if (!transitItem) return { success: false, error: 'Item no encontrado' };

    if (quantity <= 0) return { success: false, error: 'La cantidad debe ser mayor a 0' };
    if (quantity > transitItem.remaining) {
      return { success: false, error: `La cantidad no puede exceder ${transitItem.remaining}` };
    }

    const product = get().products.find(p => p.id === transitItem.product_id);
    if (!product) return { success: false, error: 'Producto no encontrado' };

    const newRemaining = transitItem.remaining - quantity;
    const newInTransit = Math.max(0, Number(product.in_transit || 0) - quantity);
    const newQuantity = Number(product.quantity) + quantity;

    if (!navigator.onLine) {
      const localMovement: Movement = {
        id: crypto.randomUUID(),
        user_id: user.id,
        product_id: product.id,
        type: 'ENTRADA',
        quantity,
        unit: product.unit,
        cost: Number(product.cost),
        reason: `Devolución de tránsito: ${reason}`,
        status: 'NORMAL',
        date: new Date().toISOString(),
        created_at: new Date().toISOString(),
      };
      set((state) => {
        const updated = state.transitItems
          .map(t => t.id === transitItemId ? { ...t, remaining: newRemaining } : t)
          .filter(t => t.remaining > 0);
        const productWarehouseUpdated = state.productWarehouse.map(pw =>
          pw.product_id === product.id && pw.warehouse_id === transitItem.warehouse_id
            ? { ...pw, quantity: Number(pw.quantity) + quantity } : pw
        );
        return {
          transitItems: updated,
          products: state.products.map(p => p.id === product.id ? { ...p, in_transit: newInTransit, quantity: newQuantity } : p),
          productWarehouse: productWarehouseUpdated,
          movements: [localMovement, ...state.movements],
        };
      });
      await addToSyncQueue({ operation: 'cancelTransit', table: 'transit_items', payload: { transitItemId, quantity, reason, userId: user.id, productId: product.id, productName: product.name } });
      get().refreshSyncQueueCount();
      toast.success('Cancelación guardada localmente (sin conexión)');
      try {
        await db.transitItems.bulkPut(get().transitItems).catch(() => {});
        await db.products.bulkPut(get().products).catch(() => {});
        await db.productWarehouse.bulkPut(get().productWarehouse).catch(() => {});
        await db.movements.put(localMovement as any).catch(() => {});
      } catch {}
      return { success: true };
    }

    const { error: updateError } = await supabase
      .from('transit_items')
      .update({ remaining: newRemaining })
      .eq('id', transitItemId);

    if (updateError) {
      return { success: false, error: 'No se pudo actualizar el item en tránsito' };
    }

    const { error: productUpdateError } = await supabase
      .from('products')
      .update({ in_transit: newInTransit, quantity: newQuantity })
      .eq('id', product.id);

    if (productUpdateError) {
      await supabase.from('transit_items').update({ remaining: transitItem.remaining, consumed: transitItem.consumed }).eq('id', transitItemId);
      return { success: false, error: 'No se pudo devolver al stock' };
    }

    if (transitItem.warehouse_id) {
      const { data: existingPW } = await supabase
        .from('product_warehouse')
        .select('*')
        .eq('product_id', product.id)
        .eq('warehouse_id', transitItem.warehouse_id)
        .maybeSingle();

      if (existingPW) {
        await get().updateProductWarehouseQuantity(product.id, transitItem.warehouse_id, Number(existingPW.quantity) + quantity, true);
      }
    }

    const { data: newMovement, error: movementError } = await supabase
      .from('movements')
      .insert({
        user_id: user.id,
        product_id: product.id,
        type: 'ENTRADA',
        quantity,
        unit: product.unit,
        date: new Date().toISOString(),
        cost: Number(product.cost),
        reason: `Devolución de tránsito: ${reason}`,
        status: 'NORMAL',
      })
      .select()
      .single();

    if (movementError) {
      if (import.meta.env.DEV) logger.error('Error registering return movement:', movementError);
    }

    set((state) => {
      if (newRemaining <= 0) {
        return {
          transitItems: state.transitItems.filter(t => t.id !== transitItemId),
          products: state.products.map(p =>
            p.id === product.id ? { ...p, in_transit: newInTransit, quantity: newQuantity } : p
          ),
          movements: newMovement ? [newMovement, ...state.movements] : state.movements,
        };
      }
      return {
        transitItems: state.transitItems.map(t =>
          t.id === transitItemId ? { ...t, remaining: newRemaining } : t
        ),
        products: state.products.map(p =>
          p.id === product.id ? { ...p, in_transit: newInTransit, quantity: newQuantity } : p
        ),
        movements: newMovement ? [newMovement, ...state.movements] : state.movements,
      };
    });

    try {
      const s = get();
      await db.transitItems.bulkPut(s.transitItems).catch(() => {});
      await db.products.bulkPut(s.products).catch(() => {});
      await db.movements.bulkPut(s.movements).catch(() => {});
      await db.productWarehouse.bulkPut(s.productWarehouse).catch(() => {});
    } catch {}

    return { success: true };
  },

  registerWasteFromTransit: async (transitItemId: string, quantity: number, reason: string) => {
    const user = useAuthStore.getState().user;
    if (!user) return { success: false, error: 'No autenticado' };

    const transitItem = get().transitItems.find(t => t.id === transitItemId);
    if (!transitItem) return { success: false, error: 'Item no encontrado' };

    if (quantity <= 0) return { success: false, error: 'La cantidad debe ser mayor a 0' };
    if (quantity > transitItem.remaining) {
      return { success: false, error: `La cantidad no puede exceder ${transitItem.remaining}` };
    }

    const product = get().products.find(p => p.id === transitItem.product_id);
    if (!product) return { success: false, error: 'Producto no encontrado' };

    const newRemaining = transitItem.remaining - quantity;
    const newInTransitVal = Math.max(0, Number(product.in_transit || 0) - quantity);

    if (!navigator.onLine) {
      set((state) => ({
        transitItems: state.transitItems.map(t => t.id === transitItemId ? { ...t, remaining: newRemaining } : t).filter(t => t.remaining > 0),
        products: state.products.map(p => p.id === product.id ? { ...p, in_transit: newInTransitVal } : p),
      }));
      await addToSyncQueue({ operation: 'registerWasteFromTransit', table: 'transit_items', payload: { transitItemId, quantity, reason, userId: user.id, productId: product.id, productName: product.name } });
      get().refreshSyncQueueCount();
      toast.success('Merma guardada localmente (sin conexión)');
      try {
        await db.transitItems.bulkPut(get().transitItems).catch(() => {});
        await db.products.bulkPut(get().products).catch(() => {});
      } catch {}
      return { success: true };
    }

    const { error: updateError } = await supabase
      .from('transit_items')
      .update({ remaining: newRemaining })
      .eq('id', transitItemId);

    if (updateError) {
      return { success: false, error: 'No se pudo actualizar el item en tránsito' };
    }

    const { error: productUpdateError } = await supabase
      .from('products')
      .update({ in_transit: newInTransitVal })
      .eq('id', product.id);

    if (productUpdateError) {
      await supabase.from('transit_items').update({ remaining: transitItem.remaining }).eq('id', transitItemId);
      return { success: false, error: 'No se pudo actualizar el tránsito del producto' };
    }

    const { data: movementData, error: movementError } = await supabase
      .from('movements')
      .insert({
        user_id: user.id,
        product_id: product.id,
        type: 'MERMA',
        quantity,
        unit: product.unit,
        date: new Date().toISOString(),
        cost: Number(product.cost),
        reason: `Merma en tránsito: ${reason}`,
        status: 'NORMAL',
      })
      .select()
      .single();

    if (movementError) {
      if (import.meta.env.DEV) logger.error('Error registering waste movement:', movementError);
    } else if (movementData) {
      set((state) => ({ movements: [movementData, ...state.movements] }));
    }

    set((state) => {
      const updatedTransitItems = state.transitItems
        .map(t => t.id === transitItemId ? { ...t, remaining: newRemaining } : t)
        .filter(t => t.remaining > 0);

      return {
        transitItems: updatedTransitItems,
        products: state.products.map(p =>
          p.id === product.id ? { ...p, in_transit: newInTransitVal } : p
        ),
      };
    });

    try {
      const s = get();
      await db.transitItems.bulkPut(s.transitItems).catch(() => {});
      await db.movements.bulkPut(s.movements).catch(() => {});
      await db.products.bulkPut(s.products).catch(() => {});
    } catch {}

    return { success: true };
  },

  registerManualConsumption: async (transitItemId: string, quantity: number, note?: string) => {
    const user = useAuthStore.getState().user;
    if (!user) return { success: false, error: 'No autenticado' };

    const transitItem = get().transitItems.find(t => t.id === transitItemId);
    if (!transitItem) return { success: false, error: 'Item no encontrado' };

    if (quantity <= 0) return { success: false, error: 'La cantidad debe ser mayor a 0' };
    if (quantity > transitItem.remaining) {
      return { success: false, error: `La cantidad no puede exceder ${transitItem.remaining}` };
    }

    const product = get().products.find(p => p.id === transitItem.product_id);
    if (!product) return { success: false, error: 'Producto no encontrado' };

    const newRemaining = transitItem.remaining - quantity;
    const newConsumed = (transitItem.consumed || 0) + quantity;
    const newInTransit = Math.max(0, Number(product.in_transit || 0) - quantity);

    if (!navigator.onLine) {
      set((state) => ({
        transitItems: state.transitItems.map(t => t.id === transitItemId ? { ...t, remaining: newRemaining, consumed: newConsumed } : t).filter(t => t.remaining > 0),
        products: state.products.map(p => p.id === product.id ? { ...p, in_transit: newInTransit } : p),
      }));
      await addToSyncQueue({ operation: 'registerManualConsumption', table: 'transit_items', payload: { transitItemId, quantity, note, userId: user.id, productId: product.id, productName: product.name } });
      get().refreshSyncQueueCount();
      toast.success('Consumo guardado localmente (sin conexión)');
      try {
        await db.transitItems.bulkPut(get().transitItems).catch(() => {});
        await db.products.bulkPut(get().products).catch(() => {});
      } catch {}
      return { success: true };
    }

    const { error: updateError } = await supabase
      .from('transit_items')
      .update({ remaining: newRemaining, consumed: newConsumed })
      .eq('id', transitItemId);

    if (updateError) {
      return { success: false, error: 'No se pudo actualizar el item en tránsito' };
    }

    const { error: productUpdateError } = await supabase
      .from('products')
      .update({ in_transit: newInTransit })
      .eq('id', product.id);

    if (productUpdateError) {
      await supabase.from('transit_items').update({ remaining: transitItem.remaining, consumed: transitItem.consumed }).eq('id', transitItemId);
      return { success: false, error: 'No se pudo actualizar el producto' };
    }

    const isGastoVariable = product.is_gasto_variable === true;

    const { data: movementData, error: movementError } = await supabase
      .from('movements')
      .insert({
        user_id: user.id,
        product_id: product.id,
        type: 'SALIDA',
        quantity,
        unit: product.unit,
        date: new Date().toISOString(),
        cost: Number(product.cost),
        reason: isGastoVariable ? 'Gasto variable registrado desde tránsito' : 'Consumo manual desde tránsito',
        note: note || null,
        is_consumo_directo: !isGastoVariable,
        is_gasto_variable: isGastoVariable,
        status: 'NORMAL',
      })
      .select()
      .single();

    if (movementError) {
      if (import.meta.env.DEV) logger.error('Error registering consumption movement:', movementError);
    } else if (movementData) {
      set((state) => ({ movements: [movementData, ...state.movements] }));
    }

    set((state) => {
      const updatedTransitItems = state.transitItems
        .map(t => {
          if (t.id === transitItemId) {
            return { ...t, remaining: newRemaining, consumed: newConsumed };
          }
          return t;
        })
        .filter(t => t.remaining > 0);

      return {
        transitItems: updatedTransitItems,
        products: state.products.map(p =>
          p.id === product.id
            ? { ...p, in_transit: newInTransit }
            : p
        ),
      };
    });

    try {
      const s = get();
      await db.transitItems.bulkPut(s.transitItems).catch(() => {});
      await db.movements.bulkPut(s.movements).catch(() => {});
      await db.products.bulkPut(s.products).catch(() => {});
    } catch {}

    return { success: true };
  },

  getPendingAccounts: async () => {
    const user = useAuthStore.getState().user;
    if (!user) return;
    if (!navigator.onLine) return;

    const { data, error } = await supabase
      .from('pending_accounts')
      .select('*')
      .eq('user_id', user.id)
      .eq('status', 'pending')
      .order('created_at', { ascending: false });

    if (!error) {
      set({ pendingAccounts: data || [] });
    }
  },

  createPendingAccount: async (clientName: string) => {
    const user = useAuthStore.getState().user;
    if (!user) return { success: false, error: 'No hay usuario autenticado' };

    if (!navigator.onLine) {
      const id = crypto.randomUUID();
      const offlineAccount: PendingAccount = {
        id, user_id: user.id, client_name: clientName,
        items: [], total_amount: 0, is_account_house: false,
        sale_type: 'SALON', status: 'pending',
        created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      };
      set((state) => ({ pendingAccounts: [offlineAccount, ...state.pendingAccounts] }));
      await Promise.all([
        addToSyncQueue({
          operation: 'createPendingAccount', table: 'pending_accounts',
          payload: { id, user_id: user.id, client_name: clientName, items: [], total_amount: 0, is_account_house: false, sale_type: 'SALON', status: 'pending', created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
        }),
        db.pendingAccounts.put(offlineAccount).catch(() => {}),
      ]);
      get().refreshSyncQueueCount();
      return { success: true, accountId: id };
    }

    const accountId = crypto.randomUUID();
    trackLocalCreation(accountId);
    try {
      const { data, error } = await queryWithRetry(() =>
        supabase
          .from('pending_accounts')
          .insert({
            id: accountId,
            user_id: user.id,
            client_name: clientName,
            items: [],
            total_amount: 0,
            status: 'pending',
            created_at_local: new Date().toISOString(),
          })
          .select()
          .single()
      );

      if (error) {
        logger.error('Error createPendingAccount:', error);
        throw new Error(error.message || 'Error al crear la cuenta');
      }

      await get().getPendingAccounts();
      return { success: true, accountId: data.id };
    } catch (err: any) {
      logger.error('Error en createPendingAccount:', err);
      return { success: false, error: err.message || 'Error al crear la cuenta' };
    } finally {
      untrackLocalCreation(accountId);
    }
  },

  addItemsToPendingAccount: async (accountId: string, items: { product_id: string; product_name: string; quantity: number; unit_price: number; subtotal: number; is_recipe?: boolean; recipe_snapshot?: { name: string; ingredients: { product_id: string; quantity: number; cost: number }[] } }[], isAccountHouse: boolean = false, saleType: 'SALON' | 'DOMICILIO' | 'BAR' | 'VENTA_RAPIDA' = 'SALON') => {
    const account = get().pendingAccounts.find(a => a.id === accountId);
    if (!account) return { success: false, error: 'Cuenta no encontrada' };

    // Guardar el estado de Cuenta Casa para toda la cuenta
    const accountIsAccountHouse = account.is_account_house || isAccountHouse;
    // Usar el tipo de venta proporcionado o el que ya tenga la cuenta
    const accountSaleType = saleType || account.sale_type || 'SALON';

    // Verificar tránsito disponible antes de agregar
    for (const item of items) {
      const product = get().products.find(p => p.id === item.product_id);
      
      const itemIsRecipe = item.is_recipe;
      const itemRecipeSnapshot = item.recipe_snapshot;
      
      if (itemIsRecipe && itemRecipeSnapshot?.ingredients) {
        // Si es receta, verificar cada ingrediente usando recipe_snapshot del item
        for (const ing of itemRecipeSnapshot.ingredients) {
          const transitAvailable = get().transitItems
            .filter(t => t.product_id === ing.product_id)
            .reduce((sum, t) => sum + t.remaining, 0);
          const needed = ing.quantity * item.quantity;
          
          if (transitAvailable < needed) {
            const ingProduct = get().products.find(p => p.id === ing.product_id);
            return { 
              success: false, 
              error: `No hay suficiente "${ingProduct?.name || 'ingrediente'}" en tránsito. Necesitas: ${needed}, Disponible: ${transitAvailable}` 
            };
          }
        }
      } else {
        // Si no es receta, verificar el producto directo
        const transitAvailable = get().transitItems
          .filter(t => t.product_id === item.product_id)
          .reduce((sum, t) => sum + t.remaining, 0);
        
        if (transitAvailable < item.quantity) {
          return { 
            success: false, 
            error: `No hay suficiente "${item.product_name}" en tránsito. Necesitas: ${item.quantity}, Disponible: ${transitAvailable}` 
          };
        }
      }
    }

    const newItems = items.map(item => ({
      ...item,
      added_at: new Date().toISOString(),
    }));

    const allItems = [...account.items, ...newItems];
    const newTotal = allItems.reduce((sum, item) => sum + item.subtotal, 0);

    if (!navigator.onLine) {
      set((state) => ({
        pendingAccounts: state.pendingAccounts.map(a =>
          a.id === accountId
            ? { ...a, items: allItems, total_amount: accountIsAccountHouse ? 0 : newTotal, is_account_house: accountIsAccountHouse, sale_type: accountSaleType, updated_at: new Date().toISOString() }
            : a
        ),
      }));
      await addToSyncQueue({
        operation: 'addItemsToPendingAccount', table: 'pending_accounts',
        payload: { accountId, items, isAccountHouse: accountIsAccountHouse, saleType: accountSaleType },
      });
      get().refreshSyncQueueCount();
      try { await db.pendingAccounts.put(get().pendingAccounts.find(a => a.id === accountId)!); } catch {}
      toast.success('Items agregados a la cuenta (sin conexión)');
      return { success: true };
    }

    const { error } = await supabase
      .from('pending_accounts')
      .update({
        items: allItems,
        total_amount: accountIsAccountHouse ? 0 : newTotal,
        is_account_house: accountIsAccountHouse,
        sale_type: accountSaleType,
        updated_at: new Date().toISOString(),
      })
      .eq('id', accountId);

    if (error) {
      return { success: false, error: error.message };
    }

    await get().getPendingAccounts();
    return { success: true };
  },

  updatePendingAccount: async (accountId: string, updates: Partial<PendingAccount>) => {
    if (!navigator.onLine) {
      set((state) => ({
        pendingAccounts: state.pendingAccounts.map(a =>
          a.id === accountId ? { ...a, ...updates, updated_at: new Date().toISOString() } : a
        ),
      }));
      await addToSyncQueue({
        operation: 'updatePendingAccount', table: 'pending_accounts',
        payload: { accountId, updates },
      });
      get().refreshSyncQueueCount();
      try { await db.pendingAccounts.put(get().pendingAccounts.find((a: any) => a.id === accountId) as any).catch(() => {}); } catch {}
      return { success: true };
    }

    const { error } = await supabase
      .from('pending_accounts')
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq('id', accountId);

    if (error) {
      return { success: false, error: error.message };
    }

    await get().getPendingAccounts();
    return { success: true };
  },

  updatePendingAccountItems: async (accountId: string, items: PendingItem[]) => {
    const account = get().pendingAccounts.find(a => a.id === accountId);
    if (!account) return { success: false, error: 'Cuenta no encontrada' };

    const isAccountHouse = account.is_account_house || false;
    const newTotal = isAccountHouse ? 0 : items.reduce((sum, item) => sum + item.subtotal, 0);

    if (!navigator.onLine) {
      set((state) => ({
        pendingAccounts: state.pendingAccounts.map(a =>
          a.id === accountId
            ? { ...a, items: items, total_amount: newTotal, updated_at: new Date().toISOString() }
            : a
        ),
      }));
      await addToSyncQueue({
        operation: 'updatePendingAccountItems', table: 'pending_accounts',
        payload: { accountId, items },
      });
      get().refreshSyncQueueCount();
      try { await db.pendingAccounts.put(get().pendingAccounts.find(a => a.id === accountId)!); } catch {}
      toast.success('Items actualizados (sin conexión)');
      return { success: true };
    }

    const { error } = await supabase
      .from('pending_accounts')
      .update({
        items: items,
        total_amount: newTotal,
        updated_at: new Date().toISOString()
      })
      .eq('id', accountId);

    if (error) {
      return { success: false, error: error.message };
    }

    await get().getPendingAccounts();
    return { success: true };
  },

  togglePendingAccountType: async (accountId: string) => {
    const account = get().pendingAccounts.find(a => a.id === accountId);
    if (!account) return { success: false, error: 'Cuenta no encontrada' };
    
    const currentIsAccountHouse = account.is_account_house || false;
    const newIsAccountHouse = !currentIsAccountHouse;
    
    const accountItems = account.items || [];
    const newTotal = newIsAccountHouse ? 0 : accountItems.reduce((sum, item) => sum + item.subtotal, 0);

    if (!navigator.onLine) {
      set((state) => ({
        pendingAccounts: state.pendingAccounts.map(a =>
          a.id === accountId
            ? { ...a, is_account_house: newIsAccountHouse, total_amount: newTotal, updated_at: new Date().toISOString() }
            : a
        ),
      }));
      await addToSyncQueue({
        operation: 'togglePendingAccountType', table: 'pending_accounts',
        payload: { accountId, is_account_house: newIsAccountHouse },
      });
      get().refreshSyncQueueCount();
      try { await db.pendingAccounts.put(get().pendingAccounts.find(a => a.id === accountId)!); } catch {}
      toast.success('Tipo de cuenta cambiado (sin conexión)');
      return { success: true };
    }

    const { error } = await supabase
      .from('pending_accounts')
      .update({ 
        is_account_house: newIsAccountHouse,
        total_amount: newTotal,
        updated_at: new Date().toISOString()
      })
      .eq('id', accountId);

    if (error) return { success: false, error: error.message };
    
    await get().getPendingAccounts();
    return { success: true };
  },

deletePendingAccount: async (accountId: string) => {
    const account = get().pendingAccounts.find(a => a.id === accountId);
    if (!account) return { success: false, error: 'Cuenta no encontrada' };

    if (!navigator.onLine) {
      const transitRestores: { transitItemId: string; quantity: number }[] = [];
      const accountItems = account.items || [];

      for (const item of accountItems) {
        const product = get().products.find(p => p.id === item.product_id);
        if (product?.is_recipe && product.recipe_ingredients) {
          for (const ing of product.recipe_ingredients) {
            const qtyToReturn = ing.quantity * item.quantity;
            const transitItem = get().transitItems.find(t => t.product_id === ing.product_id);
            if (transitItem) {
              transitRestores.push({ transitItemId: transitItem.id, quantity: qtyToReturn });
            }
          }
        } else {
          const qtyToReturn = item.quantity;
          const transitItem = get().transitItems.find(t => t.product_id === item.product_id);
          if (transitItem) {
            transitRestores.push({ transitItemId: transitItem.id, quantity: qtyToReturn });
          }
        }
      }

      set((state) => ({
        pendingAccounts: state.pendingAccounts.filter(a => a.id !== accountId),
        transitItems: state.transitItems.map(t => {
          const restore = transitRestores.find(r => r.transitItemId === t.id);
          return restore ? { ...t, remaining: t.remaining + restore.quantity } : t;
        }),
      }));

      await addToSyncQueue({
        operation: 'deletePendingAccount', table: 'pending_accounts',
        payload: { accountId, transitRestores: transitRestores.map(r => ({ transitItemId: r.transitItemId, quantity: r.quantity })) },
      });
      get().refreshSyncQueueCount();
      try { await db.pendingAccounts.delete(accountId); } catch {}
      return { success: true };
    }

    const accountItems = account.items || [];

    for (const item of accountItems) {
      const product = get().products.find(p => p.id === item.product_id);
      
      if (product?.is_recipe && product.recipe_ingredients) {
        for (const ing of product.recipe_ingredients) {
          const qtyToReturn = ing.quantity * item.quantity;
          const transitItem = get().transitItems.find(t => t.product_id === ing.product_id);
          if (transitItem) {
            await supabase
              .from('transit_items')
              .update({ remaining: transitItem.remaining + qtyToReturn })
              .eq('id', transitItem.id);
          }
        }
      } else {
        const qtyToReturn = item.quantity;
        const transitItem = get().transitItems.find(t => t.product_id === item.product_id);
        if (transitItem) {
          await supabase
            .from('transit_items')
            .update({ remaining: transitItem.remaining + qtyToReturn })
            .eq('id', transitItem.id);
        }
      }
    }

    const { error } = await supabase
      .from('pending_accounts')
      .update({ status: 'cancelled', updated_at: new Date().toISOString() })
      .eq('id', accountId);

    if (error) {
      return { success: false, error: error.message };
    }

    await get().getPendingAccounts();
    const { data: transitData } = await supabase.from('transit_items').select('*').eq('user_id', useAuthStore.getState().user?.id);
    if (transitData) {
      set({ transitItems: transitData.filter(t => t.remaining > 0) });
    }
    return { success: true };
  },

  chargePendingAccount: async (accountId: string, employeeId: string, employeeName: string, saleDate?: string, paymentMethod?: string, efectivo?: number, transferencia?: number, usd?: number, eur?: number) => {
    const user = useAuthStore.getState().user;
    if (!user) return { success: false, error: 'No hay usuario autenticado' };

    const account = get().pendingAccounts.find(a => a.id === accountId);
    if (!account) return { success: false, error: 'Cuenta no encontrada' };
    if (!account.items || account.items.length === 0) {
      return { success: false, error: 'La cuenta no tiene productos' };
    }

    const date = saleDate || new Date().toISOString().split('T')[0];
    
    if (isDateClosed(get().dailyClosings, date)) {
      return { success: false, error: 'El día está cerrado, no se puede cobrar' };
    }
    
    if (!navigator.onLine) {
      const saleItems = account.items.map(item => ({
        product_id: item.product_id,
        quantity: item.quantity,
        unit_cost: 0,
        selling_price: item.unit_price,
        subtotal: item.subtotal,
        is_recipe: item.is_recipe || false,
        recipe_snapshot: item.recipe_snapshot || null,
      }));

    const isAccountHouse = account.is_account_house || false;
      const saleType = account.sale_type || 'SALON';
      const totalPaidCup = (efectivo || 0) + (transferencia || 0) + ((usd || 0) * (user.usdRate || 0)) + ((eur || 0) * (user.eurRate || 0));

      const result = await get().addSale({
        employee_id: employeeId,
        items: saleItems,
        total_amount: isAccountHouse ? 0 : account.total_amount,
        date,
        sale_type: saleType,
        is_account_house: isAccountHouse,
        notes: `Cobro de cuenta pendiente: ${account.client_name}`,
        discount: 0,
        payment_method: paymentMethod || 'Cobro de cuenta pendiente',
        efectivo: efectivo || 0,
        transferencia: transferencia || 0,
        usd: usd || 0,
        eur: eur || 0,
      });

      if (!result.success) return result;

      set((state) => ({
        pendingAccounts: state.pendingAccounts.filter(a => a.id !== accountId),
      }));

      await addToSyncQueue({
        operation: 'markPendingAccountPaid', table: 'pending_accounts',
        payload: { accountId },
      });
      get().refreshSyncQueueCount();
      try { await db.pendingAccounts.delete(accountId); } catch {}
      return { success: true };
    }

    const saleItems = account.items.map(item => {
      const itemIsRecipe = item.is_recipe || false;
      const itemRecipeSnapshot = item.recipe_snapshot || null;
      
      return {
        product_id: item.product_id,
        quantity: item.quantity,
        unit_cost: 0,
        selling_price: item.unit_price,
        subtotal: item.subtotal,
        is_recipe: itemIsRecipe,
        recipe_snapshot: itemRecipeSnapshot,
      };
    });

    const isAccountHouse = account.is_account_house || false;
    const saleType = account.sale_type || 'SALON';
    const totalPaidCup = (efectivo || 0) + (transferencia || 0) + ((usd || 0) * (user.usdRate || 0)) + ((eur || 0) * (user.eurRate || 0));
    
    const result = await get().addSale({
      employee_id: employeeId,
      items: saleItems,
      total_amount: isAccountHouse ? 0 : account.total_amount,
      date: date,
      sale_type: saleType,
      is_account_house: isAccountHouse,
      notes: `Cobro de cuenta pendiente: ${account.client_name}`,
      discount: 0,
      payment_method: paymentMethod || 'Cobro de cuenta pendiente',
      efectivo: efectivo || 0,
      transferencia: transferencia || 0,
      usd: usd || 0,
      eur: eur || 0,
    });

    if (!result.success) {
      return { success: false, error: result.error };
    }

    const { error } = await supabase
      .from('pending_accounts')
      .update({ status: 'paid', updated_at: new Date().toISOString() })
      .eq('id', accountId);

    if (error) {
      return { success: false, error: error.message };
    }

    try {
      await get().getPendingAccounts();
    } catch (err) {
      logger.warn('[chargePendingAccount] Error recargando cuentas pendientes:', err);
    }
    return { success: true };
  },

  hashPin: async (pin: string): Promise<string> => {
    const encoder = new TextEncoder();
    const data = encoder.encode(pin + 'inventarioy_pin_salt');
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  },

  saveAccessPin: async (role: string, pin: string, name: string) => {
    const user = useAuthStore.getState().user;
    if (!user) return { success: false, error: 'No hay usuario autenticado' };
    if (!name || name.trim() === '') return { success: false, error: 'El nombre es obligatorio' };

    const pinHash = await get().hashPin(pin);

    if (role === 'owner') {
      const existingPin = get().accessPins.find(p => p.role === 'owner');
      
      if (existingPin) {
        const { error } = await supabase
          .from('access_pins')
          .update({ pin_hash: pinHash, pin_name: name.trim(), is_active: true, failed_attempts: 0, blocked_until: null })
          .eq('id', existingPin.id);

        if (error) return { success: false, error: error.message };
      } else {
        const { error } = await supabase
          .from('access_pins')
          .insert({ user_id: user.id, role, pin_hash: pinHash, pin_name: name.trim() });

        if (error) return { success: false, error: error.message };
      }
    } else {
      const { error } = await supabase
        .from('access_pins')
        .insert({ user_id: user.id, role, pin_hash: pinHash, pin_name: name.trim() });

      if (error) return { success: false, error: error.message };
    }

    const { data } = await supabase.from('access_pins').select('*').eq('user_id', user.id);
    set({ accessPins: data || [] });
    return { success: true };
  },

  toggleAccessPin: async (pinId: string, isActive: boolean) => {
    const { error } = await supabase
      .from('access_pins')
      .update({ is_active: isActive })
      .eq('id', pinId);

    if (error) return { success: false, error: error.message };

    const user = useAuthStore.getState().user;
    if (user) {
      const { data } = await supabase.from('access_pins').select('*').eq('user_id', user.id);
      set({ accessPins: data || [] });
    }
    return { success: true };
  },

  deleteAccessPin: async (pinId: string) => {
    const { error } = await supabase
      .from('access_pins')
      .delete()
      .eq('id', pinId);

    if (error) return { success: false, error: error.message };

    const user = useAuthStore.getState().user;
    if (user) {
      const { data } = await supabase.from('access_pins').select('*').eq('user_id', user.id);
      set({ accessPins: data || [] });
    }
    return { success: true };
  },

  verifyPinForModule: async (modulePath: string, pin: string): Promise<{ success: boolean; error?: string; blocked?: boolean; remainingTime?: number; verifiedRole?: string }> => {
    const user = useAuthStore.getState().user;
    if (!user) return { success: false, error: 'No hay usuario autenticado' };

    const requiredRoles = MODULE_ROLES[modulePath] || [];
    if (requiredRoles.length === 0) return { success: true };

    const anyPin = get().accessPins.find(p => p.is_active);
    if (!anyPin) return { success: false, error: 'No hay pines activos configurados' };

    // Online: verify server-side via RPC (secure)
    if (navigator.onLine) {
      try {
        const { data, error: rpcError } = await supabase.rpc('verify_access_pin', {
          p_pin: pin,
          p_module_path: modulePath,
        });
        if (rpcError) throw rpcError;
        if (data) {
          if (data.success) {
            set({ verifiedRole: data.role, verifiedRoleName: data.pin_name });
            localStorage.setItem('verifiedRole', data.role);
            localStorage.setItem('verifiedRoleName', data.pin_name || '');
            await get().fetchAll();
            return { success: true, verifiedRole: data.role };
          }
          return {
            success: false,
            error: data.error || 'PIN incorrecto',
            blocked: data.blocked || false,
            remainingTime: data.remaining_seconds || 0,
          };
        }
      } catch (err: any) {
        logger.warn('RPC verify_access_pin falló, usando fallback offline:', err?.message);
      }
    }

    // Offline fallback: client-side hash comparison
    const pinHash = await get().hashPin(pin);
    const matchingPins = get().accessPins.filter(p => p.is_active && requiredRoles.includes(p.role));
    const userPin = matchingPins.find(p => p.pin_hash === pinHash);
    
    if (!userPin) {
      const existingPin = matchingPins[0];
      if (!existingPin) return { success: false, error: 'Tu PIN no tiene acceso a este módulo' };
      
      if (navigator.onLine) {
        await supabase.from('access_pins').update({ failed_attempts: existingPin.failed_attempts + 1 }).eq('id', existingPin.id);
      } else {
        const newAttempts = existingPin.failed_attempts + 1;
        const blockedUntil = newAttempts >= 3 ? new Date(Date.now() + 5 * 60 * 1000).toISOString() : null;
        await addToSyncQueue({ operation: 'updateAccessPinAttempts', table: 'access_pins', payload: { pinId: existingPin.id, failed_attempts: newAttempts, blocked_until: blockedUntil } });
        if (blockedUntil) {
          return { success: false, error: 'PIN bloqueado por 3 intentos fallidos', blocked: true, remainingTime: 300 };
        }
      }
      return { success: false, error: 'PIN incorrecto' };
    }

    if (userPin.blocked_until) {
      const blockedUntil = new Date(userPin.blocked_until);
      const now = new Date();
      if (blockedUntil > now) {
        return { success: false, error: 'PIN bloqueado', blocked: true, remainingTime: Math.ceil((blockedUntil.getTime() - now.getTime()) / 1000) };
      }
    }

    set({ verifiedRole: userPin.role, verifiedRoleName: userPin.pin_name });
    localStorage.setItem('verifiedRole', userPin.role);
    localStorage.setItem('verifiedRoleName', userPin.pin_name || '');
    return { success: true, verifiedRole: userPin.role };
  },

  verifyPinSimple: async (pin: string): Promise<{ success: boolean; error?: string; blocked?: boolean; remainingTime?: number; role?: string }> => {
    const user = useAuthStore.getState().user;
    if (!user) return { success: false, error: 'No hay usuario autenticado' };

    // Online: verify server-side via RPC (secure)
    if (navigator.onLine) {
      try {
        const { data, error: rpcError } = await supabase.rpc('verify_access_pin', {
          p_pin: pin,
          p_module_path: null,
        });
        if (rpcError) throw rpcError;
        if (data) {
          if (data.success) {
            set({ verifiedRole: data.role, verifiedRoleName: data.pin_name });
            localStorage.setItem('verifiedRole', data.role);
            localStorage.setItem('verifiedRoleName', data.pin_name || '');
            await get().fetchAll();
            return { success: true, role: data.role };
          }
          return {
            success: false,
            error: data.error || 'PIN incorrecto',
            blocked: data.blocked || false,
            remainingTime: data.remaining_seconds || 0,
          };
        }
      } catch (err: any) {
        logger.warn('RPC verify_access_pin falló, usando fallback offline:', err?.message);
      }
    }

    // Offline fallback
    const pinHash = await get().hashPin(pin);
    const userPin = get().accessPins.find(p => p.is_active && p.pin_hash === pinHash);
    
    if (!userPin) {
      const anyPin = get().accessPins.find(p => p.is_active);
      if (!anyPin) return { success: false, error: 'No hay pines activos configurados' };
      if (!navigator.onLine) {
        const newAttempts = anyPin.failed_attempts + 1;
        const blockedUntil = newAttempts >= 3 ? new Date(Date.now() + 5 * 60 * 1000).toISOString() : null;
        await addToSyncQueue({ operation: 'updateAccessPinAttempts', table: 'access_pins', payload: { pinId: anyPin.id, failed_attempts: newAttempts, blocked_until: blockedUntil } });
        if (blockedUntil) {
          return { success: false, error: 'PIN bloqueado por 3 intentos fallidos', blocked: true, remainingTime: 300 };
        }
      }
      return { success: false, error: 'PIN incorrecto' };
    }

    if (userPin.blocked_until) {
      const blockedUntil = new Date(userPin.blocked_until);
      if (blockedUntil > new Date()) {
        return { success: false, error: 'PIN bloqueado', blocked: true, remainingTime: Math.ceil((blockedUntil.getTime() - Date.now()) / 1000) };
      }
    }

    set({ verifiedRole: userPin.role, verifiedRoleName: userPin.pin_name });
    localStorage.setItem('verifiedRole', userPin.role);
    localStorage.setItem('verifiedRoleName', userPin.pin_name || '');
    return { success: true, role: userPin.role };
  },

  logAction: async (module: string, action: string, details: Record<string, any> = {}) => {
    const user = useAuthStore.getState().user;
    if (!user) return;

    const verifiedRole = get().verifiedRole;
    const verifiedRoleName = get().verifiedRoleName;
    const activePin = get().accessPins.find(p => p.is_active);
    const role = verifiedRole || activePin?.role || user.role || 'owner';
    const roleLabel = verifiedRole ? `${ROLE_LABELS[verifiedRole]}${verifiedRoleName ? `: ${verifiedRoleName}` : ''}` : (activePin ? `${ROLE_LABELS[activePin.role]}${activePin.pin_name ? `: ${activePin.pin_name}` : ''}` : (user.name || 'Dueño/a'));
    
    if (!navigator.onLine) {
      await addToSyncQueue({ operation: 'logAction', table: 'action_logs', payload: { module, action, details, role, roleLabel } });
      get().refreshSyncQueueCount();
      return;
    }

    await supabase.from('action_logs').insert({
      user_id: user.id,
      role: role,
      pin_role_label: roleLabel,
      module,
      action,
      details,
      created_at: new Date().toISOString(),
    });
  },

  getActionLogs: async () => {
    const user = useAuthStore.getState().user;
    if (!user) return;

    // Si está offline, no intentar cargar desde Supabase para evitar crash
    // Mantener los datos existentes en memoria
    if (!navigator.onLine) {
      logger.info('[getActionLogs] Offline: manteniendo datos existentes');
      return;
    }

    try {
      const { data, error } = await supabase
        .from('action_logs')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false });

      if (!error && data) {
        set({ actionLogs: data });
      }
    } catch (err) {
      logger.warn('[getActionLogs] Error cargando logs:', err);
    }
  },

  addRecipe: async (recipe) => {
    const user = useAuthStore.getState().user;
    if (!user) throw new Error('No hay usuario autenticado');

    if (!navigator.onLine) {
      const recipeId = crypto.randomUUID();
      const now = new Date().toISOString();
      const offlineRecipe = {
        id: recipeId,
        user_id: user.id,
        name: capitalize(recipe.name),
        selling_price: recipe.selling_price,
        ingredients: (recipe.ingredients || []).map(ing => ({
          ...ing,
          recipe_id: recipeId,
        })),
        created_at: now,
      };

      set((state) => ({
        recipes: [offlineRecipe, ...state.recipes],
      }));

      await addToSyncQueue({
        operation: 'addRecipe',
        table: 'recipes',
        payload: {
          recipe: { id: recipeId, user_id: user.id, name: capitalize(recipe.name), selling_price: recipe.selling_price, created_at: now },
          ingredients: (recipe.ingredients || []).map(ing => ({ ...ing, recipe_id: recipeId })),
          tempId: recipeId,
        },
      });

      try { await db.recipes.put(offlineRecipe).catch(() => {}); } catch {}
      toast.success('Receta guardada localmente (sin conexión)');
      return;
    }

    const recipeId = crypto.randomUUID();
    trackLocalCreation(recipeId);
    try {
      const { data: newRecipe, error } = await queryWithRetry(() =>
        supabase
          .from('recipes')
          .insert({ 
            id: recipeId,
            user_id: user.id, 
            name: capitalize(recipe.name), 
            selling_price: recipe.selling_price 
          })
          .select()
          .single()
      );

      if (error) {
        throw new Error('No se pudo crear la receta');
      }

      if (recipe.ingredients.length > 0) {
        const ingredients = recipe.ingredients.map(ing => ({
          recipe_id: newRecipe.id,
          product_id: ing.product_id,
          quantity: ing.quantity,
          unit: ing.unit,
        }));

        await queryWithRetry(() =>
          supabase.from('recipe_ingredients').insert(ingredients)
        );
      }

      set((state) => ({ 
        recipes: [{ ...newRecipe, ingredients: recipe.ingredients }, ...state.recipes] 
      }));
    } catch (error: any) {
      logger.error('Error en addRecipe:', error);
      throw new Error(error.message || 'Error al crear la receta');
    } finally {
      untrackLocalCreation(recipeId);
    }
  },

  updateRecipe: async (id, updates) => {
    if (!navigator.onLine) {
      set((state) => ({
        recipes: state.recipes.map(r => r.id === id ? { ...r, ...updates } : r),
      }));
      await addToSyncQueue({
        operation: 'updateRecipe', table: 'recipes',
        payload: { id, recipeName: get().recipes.find(r => r.id === id)?.name || updates.name || 'Receta', updates: { name: updates.name ? capitalize(updates.name) : undefined, selling_price: updates.selling_price, ingredients: updates.ingredients } },
      });
      get().refreshSyncQueueCount();
      try { await db.recipes.put(get().recipes.find((r: any) => r.id === id) as any).catch(() => {}); } catch {}
      toast.success('Receta actualizada (sin conexión)');
      return;
    }

    const { error } = await queryWithRetry(() =>
      supabase
        .from('recipes')
        .update({ 
          name: updates.name ? capitalize(updates.name) : undefined, 
          selling_price: updates.selling_price 
        })
        .eq('id', id)
    );

    if (error) {
      throw new Error('No se pudo actualizar la receta');
    }

    if (updates.ingredients) {
      await queryWithRetry(() =>
        supabase.from('recipe_ingredients').delete().eq('recipe_id', id)
      );
      
      if (updates.ingredients.length > 0) {
        const ingredients = updates.ingredients.map(ing => ({
          recipe_id: id,
          product_id: ing.product_id,
          quantity: ing.quantity,
          unit: ing.unit,
        }));
        await queryWithRetry(() =>
          supabase.from('recipe_ingredients').insert(ingredients)
        );
      }
    }

    set((state) => ({
      recipes: state.recipes.map(r => r.id === id ? { ...r, ...updates } : r),
    }));
  },

  deleteRecipe: async (id) => {
    if (!navigator.onLine) {
      const recipeToDelete = get().recipes.find(r => r.id === id);
      set((state) => ({ recipes: state.recipes.filter(r => r.id !== id) }));
      await addToSyncQueue({ operation: 'deleteRecipe', table: 'recipes', payload: { id, name: recipeToDelete?.name || 'Receta' } });
      get().refreshSyncQueueCount();
      try { await db.recipes.delete(id).catch(() => {}); } catch {}
      toast.success('Receta eliminada (sin conexión)');
      return;
    }

    await queryWithRetry(() =>
      supabase.from('recipe_ingredients').delete().eq('recipe_id', id)
    );
    const { error } = await queryWithRetry(() =>
      supabase.from('recipes').delete().eq('id', id)
    );

    if (error) {
      throw new Error('No se pudo eliminar la receta');
    }

    set((state) => ({ recipes: state.recipes.filter(r => r.id !== id) }));
  },

addEmployee: async (employee) => {
    const user = useAuthStore.getState().user;
    if (!user) throw new Error('No hay usuario autenticado');

    const getNextExpediente = async (): Promise<number> => {
      if (navigator.onLine) {
        const { data: expRows } = await queryWithRetry(() =>
          supabase
            .from('employees')
            .select('expediente')
            .eq('user_id', user.id)
            .not('expediente', 'is', null)
            .order('created_at', { ascending: true })
            .order('id', { ascending: true })
        );
        if (expRows && expRows.length > 0) {
          return Math.max(...expRows.map((r: any) => r.expediente)) + 1;
        }
        return 1;
      }
      const local = get().employees.filter(e => e.expediente != null);
      if (local.length > 0) {
        return Math.max(...local.map(e => e.expediente as number)) + 1;
      }
      return 1;
    };

    if (!navigator.onLine) {
      const tempId = crypto.randomUUID();
      const expediente = await getNextExpediente();
      const tempEmployee = {
        ...employee,
        id: tempId,
        user_id: user.id,
        name: capitalize(employee.name),
        expediente,
        vacation_balance: employee.vacation_balance ?? 0,
        created_at: new Date().toISOString(),
      };
      set((state) => ({ employees: [tempEmployee, ...state.employees] }));
      await addToSyncQueue({ operation: 'addEmployee', table: 'employees', payload: { employee: tempEmployee } });
      get().refreshSyncQueueCount();
      try { await db.employees.put(tempEmployee).catch(() => {}); } catch {}
      return;
    }

    const employeeId = crypto.randomUUID();
    trackLocalCreation(employeeId);
    try {
      const expediente = await getNextExpediente();
      const { data, error } = await queryWithRetry(() =>
        supabase
          .from('employees')
          .insert({
            ...employee,
            id: employeeId,
            name: capitalize(employee.name),
            user_id: user.id,
            expediente,
            vacation_balance: employee.vacation_balance ?? 0,
          })
          .select()
          .single()
      );

      if (error) {
        logger.error('Error addEmployee:', error);
        throw new Error(error.message || 'No se pudo agregar el empleado');
      }

      set((state) => ({ employees: [data, ...state.employees] }));
    } catch (error: any) {
      logger.error('Error en addEmployee:', error);
      throw new Error(error.message || 'Error al agregar empleado');
    } finally {
      untrackLocalCreation(employeeId);
    }
  },

  updateEmployee: async (id, updates) => {
    const capitalizedUpdates = {
      ...updates,
      ...(updates.name !== undefined && { name: capitalize(updates.name) }),
    };
    const { error } = await queryWithRetry(() =>
      supabase.from('employees').update(capitalizedUpdates).eq('id', id)
    );

    if (error) {
      throw new Error('No se pudo actualizar el empleado');
    }

    set((state) => ({
      employees: state.employees.map(e => e.id === id ? { ...e, ...updates } : e),
    }));
  },

deleteEmployee: async (id) => {
    const user = useAuthStore.getState().user;
    if (!user) throw new Error('No hay usuario autenticado');

    const { data: employee, error: empError } = await queryWithRetry(() =>
      supabase.from('employees').select('*').eq('id', id).single()
    );
    if (empError || !employee) throw new Error('No se encontró el empleado');

    // Documentos del empleado: borrar archivos de storage y luego registros
    const { data: docs } = await supabase
      .from('employee_documents')
      .select('file_url')
      .eq('employee_id', id);
    const filePaths = (docs || [])
      .map((d: any) => d.file_url?.split('/hr-documents/')[1])
      .filter(Boolean);
    if (filePaths.length > 0) {
      await supabase.storage.from('hr-documents').remove(filePaths);
    }
    await supabase.from('employee_documents').delete().eq('employee_id', id);

    // Foto del empleado en storage (si está en el bucket hr-documents)
    const photoPath = employee.photo_url?.split('/hr-documents/')[1];
    if (photoPath) {
      await supabase.storage.from('hr-documents').remove([photoPath]);
    }

    // Registros asociados
    await supabase.from('employee_loans').delete().eq('employee_id', id);
    await supabase.from('payroll_drafts').delete().eq('employee_id', id);
    await supabase.from('payroll_entries').delete().eq('employee_id', id);
    await supabase.from('payroll_liquidations').delete().eq('employee_id', id);
    await supabase.from('employee_vacation_movements').delete().eq('employee_id', id);

    const { error } = await queryWithRetry(() =>
      supabase.from('employees').delete().eq('id', id)
    );

    if (error) {
      throw new Error('No se pudo eliminar el empleado');
    }

    set((state) => ({
      employees: state.employees.filter(e => e.id !== id),
      employeeDocuments: state.employeeDocuments.filter(d => d.employee_id !== id),
      employeeLoans: state.employeeLoans.filter(l => l.employee_id !== id),
      payrollDrafts: state.payrollDrafts.filter(d => d.employee_id !== id),
      payrollEntries: state.payrollEntries.filter(e => e.employee_id !== id),
      payrollLiquidations: state.payrollLiquidations.filter(l => l.employee_id !== id),
      vacationMovements: state.vacationMovements.filter(m => m.employee_id !== id),
    }));
  },

  addDepartment: async (name) => {
    const user = useAuthStore.getState().user;
    if (!user) throw new Error('No hay usuario autenticado');

    const { data, error } = await supabase
      .from('departments')
      .insert({ name: capitalize(name), user_id: user.id })
      .select()
      .single();

    if (error) {
      logger.error('Error addDepartment:', error);
      throw new Error(error.message || 'No se pudo agregar el departamento');
    }

    set((state) => ({ departments: [data, ...state.departments] }));
  },

  updateDepartment: async (id, name) => {
    const { error } = await supabase.from('departments').update({ name: capitalize(name) }).eq('id', id);

    if (error) {
      throw new Error('No se pudo actualizar el departamento');
    }

    set((state) => ({
      departments: state.departments.map(d => d.id === id ? { ...d, name: capitalize(name) } : d),
    }));
  },

  deleteDepartment: async (id) => {
    const user = useAuthStore.getState().user;
    if (!user) return;

    const { count: empCount, error: countError } = await supabase
      .from('employees')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .eq('category', id);

    if (countError) {
      throw new Error('No se pudo validar el departamento');
    }

    if (empCount && empCount > 0) {
      throw new Error(`Hay ${empCount} empleados en este departamento`);
    }

    const { error } = await supabase.from('departments').delete().eq('id', id);

    if (error) {
      throw new Error('No se pudo eliminar el departamento');
    }

    set((state) => ({ departments: state.departments.filter(d => d.id !== id) }));
  },

  getPayrollConfig: async () => {
    const user = useAuthStore.getState().user;
    if (!user) return;

    const { data, error } = await supabase
      .from('payroll_config')
      .select('*')
      .eq('user_id', user.id)
      .single();

    if (error && error.code !== 'PGRST116') {
      logger.error('Error fetching payroll config:', error);
      return;
    }

    if (data) {
      set({ payrollConfig: data });
    } else {
      const defaultConfig = {
        tax_exemption_base: 3260,
        tax_rate: 5,
        special_contribution_rate: 5,
        monthly_hours: 190.6,
        vacation_accrual_days: 2.5,
      };

      const { data: newData, error: insertError } = await supabase
        .from('payroll_config')
        .insert({ ...defaultConfig, user_id: user.id })
        .select()
        .single();

      if (!insertError && newData) {
        set({ payrollConfig: newData });
      }
    }
  },

  updatePayrollConfig: async (updates) => {
    const user = useAuthStore.getState().user;
    const config = get().payrollConfig;
    if (!user || !config) return;

    const { error } = await supabase
      .from('payroll_config')
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq('id', config.id);

    if (error) {
      throw new Error('No se pudo actualizar la configuración de nómina');
    }

    set((state) => ({ payrollConfig: state.payrollConfig ? { ...state.payrollConfig, ...updates } : null }));
  },

  calculatePayroll: async (month, year) => {
    const user = useAuthStore.getState().user;
    if (!user) throw new Error('No hay usuario autenticado');
    if (!navigator.onLine) throw new Error('Requiere conexión a internet para generar la nómina');

    if (!get().payrollConfig) await get().getPayrollConfig();
    const currentConfig = get().payrollConfig;
    if (!currentConfig) throw new Error('No se pudo cargar la configuración de nómina');

    const monthlyHours = currentConfig.monthly_hours ?? DEFAULT_MONTHLY_HOURS;
    const accrualDays = currentConfig.vacation_accrual_days ?? DEFAULT_VACATION_ACCRUAL_DAYS;
    const exemptionBase = currentConfig.tax_exemption_base ?? 3260;

    const appliedPeriod = get().payrollPeriods.find(p => p.month === month && p.year === year);
    if (appliedPeriod?.status === 'applied') throw new Error('El período está aplicado y bloqueado');

    const employees = get().employees;
    if (!employees || employees.length === 0) throw new Error('No hay personal que generarle nómina');
    const departments = get().departments;

    let drafts = await get().getPayrollDrafts(month, year);
    if (!drafts || drafts.length === 0) {
      drafts = employees.map(emp => ({
        id: crypto.randomUUID(),
        user_id: user.id,
        month,
        year,
        employee_id: emp.id,
        include: true,
        worked_hours: monthlyHours,
        hourly_rate: ROUND(emp.salary / monthlyHours),
        bonus: 0,
        advances: 0,
        retention: 0,
        vacation_days: 0,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }));
    }

    const included = drafts.filter(d => d.include);
    if (included.length === 0) throw new Error('No hay trabajadores seleccionados para la nómina de este mes');

    const { data: existingEntries } = await supabase
      .from('payroll_entries')
      .select('id')
      .eq('user_id', user.id)
      .eq('month', month)
      .eq('year', year);
    const isFirstGeneration = !existingEntries || existingEntries.length === 0;

    const activeLoans = get().employeeLoans.filter(l => l.status === 'active');

    const entriesToInsert = [];
    for (const d of included) {
      const emp = employees.find(e => e.id === d.employee_id);
      if (!emp) continue;
      const empDept = departments.find(dep => dep.id === emp.category);
      const loan = activeLoans.find(l => l.employee_id === emp.id);
      const loanDeduction = loan ? (loan.monthly_payment || 0) : 0;

      const isPartner = emp.person_type === 'partner';
      let result;
      if (isPartner) {
        result = calcularNominaSocio({
          retiro: emp.salary,
          baseContribution: emp.base_contribution ?? 0,
          bonus: d.bonus,
          advances: d.advances,
          loanDeduction,
          otherDeductions: d.retention,
        });
      } else {
        result = calcularNominaEmpleado({
          baseSalary: emp.salary,
          hourlyRate: d.hourly_rate || undefined,
          workedHours: d.worked_hours,
          monthlyHours,
          bonus: d.bonus,
          vacationDays: d.vacation_days,
          advances: d.advances,
          loanDeduction,
          otherDeductions: d.retention,
          exemptionBase,
        });
      }

      entriesToInsert.push({
        user_id: user.id,
        employee_id: emp.id,
        employee_name: emp.name,
        employee_category: empDept?.name || 'Sin Departamento',
        month,
        year,
        base_salary: emp.salary,
        earned_salary: result.earnedSalary,
        exemption_base: exemptionBase,
        taxable_base: result.taxableBase,
        tax_amount: result.taxAmount,
        special_contribution: result.specialContribution,
        net_salary: result.netSalary,
        vacation_days: d.vacation_days,
        vacation_base: result.vacationBase,
        employer_contribution: result.employerContribution,
        is_custom: false,
        overtime_hours: result.overtimeHours,
        overtime_type: result.overtimeType,
        overtime_pay: result.overtimePay,
        bonus: result.bonus,
        vacation_pay: result.vacationPay,
        advances: result.advances,
        loan_deduction: result.loanDeduction,
        other_deductions: result.otherDeductions,
        gross_salary: result.grossSalary,
        worked_hours: result.workedHours,
        hourly_rate: result.hourlyRate,
        days_paid: result.daysPaid,
      });
    }

    if (isFirstGeneration) {
      for (const d of included) {
        const loan = activeLoans.find(l => l.employee_id === d.employee_id);
        if (!loan) continue;
        const newBalance = Math.max(0, (loan.balance || 0) - (loan.monthly_payment || 0));
        const newStatus = newBalance <= 0 ? 'paid' : 'active';
        await supabase.from('employee_loans')
          .update({ balance: newBalance, status: newStatus, updated_at: new Date().toISOString() })
          .eq('id', loan.id);
      }
    }

    // Vacaciones: recálculo completo del mes (delete + reinsert)
    await supabase
      .from('employee_vacation_movements')
      .delete()
      .eq('user_id', user.id)
      .eq('month', month)
      .eq('year', year);

    const movements: any[] = [];
    for (const d of included) {
      const emp = employees.find(e => e.id === d.employee_id);
      if (!emp) continue;
      movements.push({ user_id: user.id, employee_id: emp.id, month, year, type: 'accrual', days: accrualDays, note: 'Acumulación mensual' });
      if (d.vacation_days > 0) {
        movements.push({ user_id: user.id, employee_id: emp.id, month, year, type: 'paid', days: -d.vacation_days, note: 'Vacaciones pagadas' });
      }
    }
    if (movements.length > 0) {
      await supabase.from('employee_vacation_movements').insert(movements);
    }

    // Saldo de vacaciones = suma de todos los movimientos históricos (excluyendo el mes recalculado)
    const balanceUpdates: { id: string; balance: number }[] = [];
    for (const d of included) {
      const emp = employees.find(e => e.id === d.employee_id);
      if (!emp) continue;
      const { data: movRows } = await supabase
        .from('employee_vacation_movements')
        .select('days')
        .eq('user_id', user.id)
        .eq('employee_id', emp.id)
        .not('month', 'eq', month)
        .not('year', 'eq', year);
      const balance = Math.max(0, ROUND((movRows || []).reduce((s: number, m: any) => s + (m.days || 0), 0)));
      await supabase.from('employees').update({ vacation_balance: balance }).eq('id', emp.id);
      balanceUpdates.push({ id: emp.id, balance });
    }

    // Período en Borrador (no pisar uno aplicado)
    const monthStr = `${year}-${String(month).padStart(2, '0')}`;
    await supabase.from('payroll_periods').upsert(
      { user_id: user.id, month, year, status: 'draft', updated_at: new Date().toISOString() },
      { onConflict: 'user_id,month,year' }
    );
    await get().getPayrollPeriod(month, year);

    // Delete + reinsert de entradas
    await supabase.from('payroll_entries').delete().eq('user_id', user.id).eq('month', month).eq('year', year);
    const { data, error } = await supabase.from('payroll_entries').insert(entriesToInsert).select();
    if (error) {
      logger.error('Error inserting payroll entries:', error);
      throw new Error('No se pudo generar la nómina');
    }

    set((state) => ({
      payrollEntries: data || [],
      employees: state.employees.map(e => {
        const up = balanceUpdates.find(b => b.id === e.id);
        return up ? { ...e, vacation_balance: up.balance } : e;
      }),
      payrollConfig: state.payrollConfig ? { ...state.payrollConfig, last_calculated_month: monthStr } : null,
    }));

    await supabase.from('payroll_config').update({ last_calculated_month: monthStr }).eq('user_id', user.id);

    await get().getVacationMovements(month, year);

    await get().logAction('payroll', 'GENERAR_NOMINA', {
      month,
      year,
      total_employees: included.length,
      total_net: entriesToInsert.reduce((sum: number, e: any) => sum + e.net_salary, 0),
    });
  },

  getPayrollEntries: async (month, year) => {
    const user = useAuthStore.getState().user;
    if (!user) return;

    const { data, error } = await supabase
      .from('payroll_entries')
      .select('*')
      .eq('user_id', user.id)
      .eq('month', month)
      .eq('year', year)
      .order('employee_category', { ascending: true })
      .order('employee_name', { ascending: true });

    if (error) {
      logger.error('Error fetching payroll entries:', error);
      return;
    }

    set({ payrollEntries: data || [] });
  },

  getEmployeesPaginated: async (page, search, departmentId, sortBy = 'name', sortOrder = 'asc') => {
    const user = useAuthStore.getState().user;
    if (!user) return;

    const pageSize = 10;
    const offset = (page - 1) * pageSize;

    let query = supabase
      .from('employees')
      .select('*', { count: 'exact' })
      .eq('user_id', user.id);

    if (search) {
      query = query.ilike('name', `%${search}%`);
    }

    if (departmentId) {
      query = query.eq('category', departmentId);
    }

    const sortField = sortBy === 'salary' ? 'salary' : 'name';
    query = query.order(sortField, { ascending: sortOrder === 'asc' });

    const { data, error, count } = await query.range(offset, offset + pageSize - 1);

    if (error) {
      logger.error('Error fetching employees paginated:', error);
      return;
    }

    set({ 
      employees: data || [], 
      employeesPage: page,
      employeesTotal: count || 0 
    });
  },

  getEmployeesCount: async (search, departmentId) => {
    const user = useAuthStore.getState().user;
    if (!user) return 0;

    // Si está offline, retornar 0 para evitar crash
    if (!navigator.onLine) {
      logger.info('[getEmployeesCount] Offline: returning 0');
      return 0;
    }

    try {
      let query = supabase
        .from('employees')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', user.id);

      if (search) {
        query = query.ilike('name', `%${search}%`);
      }

      if (departmentId) {
        query = query.eq('category', departmentId);
      }

      const { count, error } = await query;

      if (error) {
        logger.error('Error counting employees:', error);
        return 0;
      }

      return count || 0;
    } catch (err) {
      logger.warn('[getEmployeesCount] Error:', err);
      return 0;
    }
  },

  getDepartmentsPaginated: async (page, search) => {
    const user = useAuthStore.getState().user;
    if (!user) return;

    const pageSize = 10;
    const offset = (page - 1) * pageSize;

    let query = supabase
      .from('departments')
      .select('*', { count: 'exact' })
      .eq('user_id', user.id);

    if (search) {
      query = query.ilike('name', `%${search}%`);
    }

    const { data, error, count } = await query
      .order('name', { ascending: true })
      .range(offset, offset + pageSize - 1);

    if (error) {
      logger.error('Error fetching departments paginated:', error);
      return;
    }

    set({ 
      departments: data || [], 
      departmentsPage: page,
      departmentsTotal: count || 0 
    });
  },

  getDepartmentsCount: async (search) => {
    const user = useAuthStore.getState().user;
    if (!user) return 0;

    // Si está offline, retornar 0 para evitar crash
    if (!navigator.onLine) {
      logger.info('[getDepartmentsCount] Offline: returning 0');
      return 0;
    }

    try {
      let query = supabase
        .from('departments')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', user.id);

      if (search) {
        query = query.ilike('name', `%${search}%`);
      }

      const { count, error } = await query;

      if (error) {
        logger.error('Error counting departments:', error);
        return 0;
      }

      return count || 0;
    } catch (err) {
      logger.warn('[getDepartmentsCount] Error:', err);
      return 0;
    }
  },

  getPayrollEntriesPaginated: async (page, month, year) => {
    const user = useAuthStore.getState().user;
    if (!user) return;

    const pageSize = 20;
    const offset = (page - 1) * pageSize;

    const { data, error, count } = await supabase
      .from('payroll_entries')
      .select('*', { count: 'exact' })
      .eq('user_id', user.id)
      .eq('month', month)
      .eq('year', year)
      .order('employee_category', { ascending: true })
      .order('employee_name', { ascending: true })
      .range(offset, offset + pageSize - 1);

    if (error) {
      logger.error('Error fetching payroll entries paginated:', error);
      return;
    }

    set({ 
      payrollEntries: data || [], 
      payrollPage: page,
      payrollMonthFilter: month,
      payrollYearFilter: year,
      payrollTotal: count || 0 
    });
  },

  getPayrollEntriesCount: async (month, year) => {
    const user = useAuthStore.getState().user;
    if (!user) return 0;

    // Si está offline, retornar 0 para evitar crash
    if (!navigator.onLine) {
      logger.info('[getPayrollEntriesCount] Offline: returning 0');
      return 0;
    }

    try {
      const { count, error } = await supabase
        .from('payroll_entries')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', user.id)
        .eq('month', month)
        .eq('year', year);

      if (error) {
        logger.error('Error counting payroll entries:', error);
        return 0;
      }

      return count || 0;
    } catch (err) {
      logger.warn('[getPayrollEntriesCount] Error:', err);
      return 0;
    }
  },

  updatePayrollEntry: async (id, updates) => {
    const currentEntry = get().payrollEntries.find(e => e.id === id);
    if (!currentEntry) return;

    const applied = get().payrollPeriods.find(p => p.month === currentEntry.month && p.year === currentEntry.year)?.status === 'applied';
    if (applied) throw new Error('El período está aplicado y bloqueado');

    const config = get().payrollConfig;
    if (!config) throw new Error('No se pudo cargar la configuración de nómina');

    const employee = get().employees.find(e => e.id === currentEntry.employee_id);
    const isPartner = employee?.person_type === 'partner';

    const exemptionBase = config.tax_exemption_base ?? 3260;
    const monthlyHours = config.monthly_hours ?? DEFAULT_MONTHLY_HOURS;

    const baseSalary = currentEntry.base_salary ?? employee?.salary ?? 0;
    const hourlyRate = currentEntry.hourly_rate ?? ROUND(baseSalary / monthlyHours);
    const workedHours = updates.worked_hours ?? currentEntry.worked_hours ?? monthlyHours;

    const overtimeHours = updates.overtime_hours ?? currentEntry.overtime_hours ?? 0;
    const overtimeType = (updates.overtime_type !== undefined ? updates.overtime_type : currentEntry.overtime_type) ?? undefined;
    const bonus = updates.bonus ?? currentEntry.bonus ?? 0;
    const vacationDays = updates.vacation_days ?? currentEntry.vacation_days ?? 0;
    const advances = updates.advances ?? currentEntry.advances ?? 0;
    const otherDeductions = updates.other_deductions ?? currentEntry.other_deductions ?? 0;

    const activeLoan = get().employeeLoans.find(l => l.employee_id === currentEntry.employee_id && l.status === 'active');
    const loanDeduction = updates.loan_deduction ?? currentEntry.loan_deduction ?? (activeLoan?.monthly_payment ?? 0);

    let result;
    if (isPartner) {
      result = calcularNominaSocio({
        retiro: baseSalary,
        baseContribution: employee?.base_contribution ?? 0,
        bonus,
        advances,
        loanDeduction,
        otherDeductions,
      });
    } else {
      result = calcularNominaEmpleado({
        baseSalary,
        hourlyRate,
        workedHours,
        monthlyHours,
        overtimeHours,
        overtimeType,
        bonus,
        vacationDays,
        advances,
        loanDeduction,
        otherDeductions,
        exemptionBase,
      });
    }

    const finalUpdates = {
      ...updates,
      base_salary: baseSalary,
      earned_salary: result.earnedSalary,
      exemption_base: exemptionBase,
      taxable_base: result.taxableBase,
      tax_amount: result.taxAmount,
      special_contribution: result.specialContribution,
      net_salary: result.netSalary,
      vacation_days: vacationDays,
      vacation_base: result.vacationBase,
      employer_contribution: result.employerContribution,
      overtime_hours: result.overtimeHours,
      overtime_type: result.overtimeType || null,
      overtime_pay: result.overtimePay,
      bonus: result.bonus,
      vacation_pay: result.vacationPay,
      advances: result.advances,
      loan_deduction: result.loanDeduction,
      other_deductions: result.otherDeductions,
      gross_salary: result.grossSalary,
      worked_hours: result.workedHours,
      hourly_rate: result.hourlyRate,
      days_paid: result.daysPaid,
      is_custom: true,
    };

    const { error } = await supabase
      .from('payroll_entries')
      .update({ ...finalUpdates, updated_at: new Date().toISOString() })
      .eq('id', id);

    if (error) {
      throw new Error('No se pudo actualizar el registro de nómina');
    }

    set((state) => ({
      payrollEntries: state.payrollEntries.map(e => e.id === id ? { ...e, ...finalUpdates } : e),
    }));

    const entry = get().payrollEntries.find(e => e.id === id);
    if (entry) {
      await get().logAction('payroll', 'ACTUALIZAR_NOMINA', {
        employee_name: entry.employee_name,
        field: Object.keys(updates)[0],
        old_value: Object.values(updates)[0],
      });
    }
  },

  regeneratePayrollEntry: async (id) => {
    const entry = get().payrollEntries.find(e => e.id === id);
    if (!entry) return;

    const applied = get().payrollPeriods.find(p => p.month === entry.month && p.year === entry.year)?.status === 'applied';
    if (applied) throw new Error('El período está aplicado y bloqueado');

    const config = get().payrollConfig;
    if (!config) throw new Error('No se pudo cargar la configuración de nómina');

    const employee = get().employees.find(e => e.id === entry.employee_id);
    if (!employee) return;

    const draft = get().payrollDrafts.find(d => d.employee_id === entry.employee_id && d.month === entry.month && d.year === entry.year);

    const isPartner = employee.person_type === 'partner';
    const exemptionBase = config.tax_exemption_base ?? 3260;
    const monthlyHours = config.monthly_hours ?? DEFAULT_MONTHLY_HOURS;

    const baseSalary = employee.salary;
    const hourlyRate = draft?.hourly_rate ?? ROUND(baseSalary / monthlyHours);
    const workedHours = draft?.worked_hours ?? monthlyHours;
    const vacationDays = draft?.vacation_days ?? 0;

    const activeLoan = get().employeeLoans.find(l => l.employee_id === employee.id && l.status === 'active');
    const loanDeduction = activeLoan?.monthly_payment ?? 0;

    let result;
    if (isPartner) {
      result = calcularNominaSocio({
        retiro: baseSalary,
        baseContribution: employee.base_contribution ?? 0,
        bonus: 0,
        advances: 0,
        loanDeduction,
        otherDeductions: 0,
      });
    } else {
      result = calcularNominaEmpleado({
        baseSalary,
        hourlyRate,
        workedHours,
        monthlyHours,
        overtimeHours: 0,
        overtimeType: undefined,
        bonus: 0,
        vacationDays,
        advances: 0,
        loanDeduction,
        otherDeductions: 0,
        exemptionBase,
      });
    }

    const finalUpdates = {
      base_salary: baseSalary,
      earned_salary: result.earnedSalary,
      exemption_base: exemptionBase,
      taxable_base: result.taxableBase,
      tax_amount: result.taxAmount,
      special_contribution: result.specialContribution,
      net_salary: result.netSalary,
      vacation_days: vacationDays,
      vacation_base: result.vacationBase,
      employer_contribution: result.employerContribution,
      overtime_hours: result.overtimeHours,
      overtime_type: result.overtimeType || null,
      overtime_pay: result.overtimePay,
      bonus: result.bonus,
      vacation_pay: result.vacationPay,
      advances: result.advances,
      loan_deduction: result.loanDeduction,
      other_deductions: result.otherDeductions,
      gross_salary: result.grossSalary,
      worked_hours: result.workedHours,
      hourly_rate: result.hourlyRate,
      days_paid: result.daysPaid,
      is_custom: false,
    };

    const { error } = await supabase
      .from('payroll_entries')
      .update({ ...finalUpdates, updated_at: new Date().toISOString() })
      .eq('id', id);

    if (error) {
      throw new Error('No se pudo regenerar el registro de nómina');
    }

    set((state) => ({
      payrollEntries: state.payrollEntries.map(e => e.id === id ? { ...e, ...finalUpdates } : e),
    }));

    const updated = get().payrollEntries.find(e => e.id === id);
    if (updated) {
      await get().logAction('payroll', 'ACTUALIZAR_NOMINA', {
        employee_name: updated.employee_name,
        field: 'regenerate',
        old_value: 'default',
      });
    }
  },

  getPayrollPeriod: async (month, year) => {
    const user = useAuthStore.getState().user;
    if (!user || !navigator.onLine) return;

    const { data, error } = await supabase
      .from('payroll_periods')
      .select('*')
      .eq('user_id', user.id)
      .eq('month', month)
      .eq('year', year)
      .maybeSingle();

    if (error) {
      logger.error('Error fetching payroll period:', error);
      return;
    }

    const period = data as PayrollPeriod | null;
    set((state) => {
      const others = state.payrollPeriods.filter(p => !(p.month === month && p.year === year));
      return { payrollPeriods: period ? [...others, period] : others };
    });
  },

  applyPayroll: async (month, year) => {
    const user = useAuthStore.getState().user;
    if (!user) throw new Error('No hay usuario autenticado');
    if (!navigator.onLine) throw new Error('Requiere conexión a internet para aplicar la nómina');

    const verifiedRole = get().verifiedRole || get().accessPins.find(p => p.is_active)?.role;
    if (verifiedRole && verifiedRole !== 'owner') {
      throw new Error('Solo el rol Dueño/a puede aplicar la nómina');
    }

    const appliedBy = user.name || user.email;

    const { data, error } = await supabase
      .from('payroll_periods')
      .upsert(
        {
          user_id: user.id,
          month,
          year,
          status: 'applied',
          applied_at: new Date().toISOString(),
          applied_by: appliedBy,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'user_id,month,year' }
      )
      .select()
      .single();

    if (error) {
      logger.error('Error applying payroll:', error);
      throw new Error('No se pudo aplicar la nómina');
    }

    set((state) => {
      const others = state.payrollPeriods.filter(p => !(p.month === month && p.year === year));
      return { payrollPeriods: [data as PayrollPeriod, ...others] };
    });

    const monthName = new Date(0, month - 1).toLocaleString('es', { month: 'long' });
    await get().logAction('payroll', 'APLICAR_NOMINA', {
      month,
      year,
      period: `${capitalize(monthName)} ${year}`,
    });
  },

  reopenPayroll: async (month, year) => {
    const user = useAuthStore.getState().user;
    if (!user) throw new Error('No hay usuario autenticado');
    if (!navigator.onLine) throw new Error('Requiere conexión a internet para reabrir la nómina');

    const verifiedRole = get().verifiedRole || get().accessPins.find(p => p.is_active)?.role;
    if (verifiedRole && verifiedRole !== 'owner') {
      throw new Error('Solo el rol Dueño/a puede reabrir la nómina');
    }

    const period = get().payrollPeriods.find(p => p.month === month && p.year === year);
    if (!period) throw new Error('No existe el período de nómina');

    const { data, error } = await supabase
      .from('payroll_periods')
      .update({ status: 'draft', applied_at: null, applied_by: null, updated_at: new Date().toISOString() })
      .eq('id', period.id)
      .select()
      .single();

    if (error) {
      logger.error('Error reopening payroll:', error);
      throw new Error('No se pudo reabrir la nómina');
    }

    set((state) => ({
      payrollPeriods: state.payrollPeriods.map(p => p.id === period.id ? data as PayrollPeriod : p),
    }));

    const monthName = new Date(0, month - 1).toLocaleString('es', { month: 'long' });
    await get().logAction('payroll', 'REABRIR_NOMINA', {
      month,
      year,
      period: `${capitalize(monthName)} ${year}`,
      by: 'owner',
    });
  },

  getPayrollDrafts: async (month, year) => {
    const user = useAuthStore.getState().user;
    if (!user || !navigator.onLine) return [];

    const { data, error } = await supabase
      .from('payroll_drafts')
      .select('*')
      .eq('user_id', user.id)
      .eq('month', month)
      .eq('year', year);

    if (error) {
      logger.error('Error fetching payroll drafts:', error);
      return [];
    }

    const drafts: PayrollDraft[] = (data || []).map((d: any) => ({
      ...d,
      include: Boolean(d.include),
    }));

    set((state) => ({
      payrollDrafts: [
        ...state.payrollDrafts.filter(p => !(p.month === month && p.year === year)),
        ...drafts,
      ],
    }));

    return drafts;
  },

  savePayrollDrafts: async (month, year, drafts) => {
    const user = useAuthStore.getState().user;
    if (!user) throw new Error('No hay usuario autenticado');
    if (!navigator.onLine) throw new Error('Requiere conexión a internet para guardar la captación');

    const applied = get().payrollPeriods.find(p => p.month === month && p.year === year)?.status === 'applied';
    if (applied) throw new Error('El período está aplicado y bloqueado');

    const rows = drafts.map((d) => ({
      user_id: user.id,
      month,
      year,
      employee_id: d.employee_id,
      include: d.include ? 1 : 0,
      worked_hours: d.worked_hours,
      hourly_rate: d.hourly_rate,
      bonus: d.bonus,
      advances: d.advances,
      retention: d.retention,
      vacation_days: d.vacation_days,
      note: d.note,
      updated_at: new Date().toISOString(),
    }));

    if (rows.length === 0) return;

    const { error } = await supabase
      .from('payroll_drafts')
      .upsert(rows, { onConflict: 'user_id,month,year,employee_id' });

    if (error) {
      logger.error('Error saving payroll drafts:', error);
      throw new Error('No se pudo guardar la captación');
    }

    set((state) => ({
      payrollDrafts: [
        ...state.payrollDrafts.filter(p => !(p.month === month && p.year === year)),
        ...drafts.map(d => ({
          id: crypto.randomUUID(),
          user_id: user.id,
          month,
          year,
          employee_id: d.employee_id,
          include: d.include,
          worked_hours: d.worked_hours,
          hourly_rate: d.hourly_rate,
          bonus: d.bonus,
          advances: d.advances,
          retention: d.retention,
          vacation_days: d.vacation_days,
          note: d.note,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })),
      ],
    }));
  },

  getEmployeeLoans: async () => {
    const user = useAuthStore.getState().user;
    if (!user || !navigator.onLine) return;

    const { data, error } = await supabase
      .from('employee_loans')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false });

    if (error) {
      logger.error('Error fetching employee loans:', error);
      return;
    }

    set({ employeeLoans: data as EmployeeLoan[] || [] });
  },

  addLoan: async (loan) => {
    const user = useAuthStore.getState().user;
    if (!user) throw new Error('No hay usuario autenticado');
    if (!navigator.onLine) throw new Error('Requiere conexión a internet para registrar la deducción');

    const { data, error } = await supabase
      .from('employee_loans')
      .insert({
        user_id: user.id,
        employee_id: loan.employee_id,
        total_amount: loan.total_amount,
        monthly_payment: loan.monthly_payment,
        balance: loan.total_amount,
        start_date: loan.start_date || null,
        status: 'active',
        deduction_type: loan.deduction_type,
        reason: loan.reason,
      })
      .select()
      .single();

    if (error) {
      logger.error('Error addLoan:', error);
      throw new Error(error.message || 'No se pudo registrar la deducción');
    }

    set((state) => ({ employeeLoans: [data as EmployeeLoan, ...state.employeeLoans] }));
  },

  deleteLoan: async (id) => {
    if (!navigator.onLine) throw new Error('Requiere conexión a internet para eliminar la deducción');

    const { error } = await supabase.from('employee_loans').delete().eq('id', id);

    if (error) {
      throw new Error('No se pudo eliminar la deducción');
    }

    set((state) => ({ employeeLoans: state.employeeLoans.filter(l => l.id !== id) }));
  },

  payLoanInstallment: async (id) => {
    const user = useAuthStore.getState().user;
    if (!user) throw new Error('No hay usuario autenticado');
    if (!navigator.onLine) throw new Error('Requiere conexión a internet para registrar el pago');

    const { data: loan, error: fetchError } = await supabase
      .from('employee_loans')
      .select('*')
      .eq('id', id)
      .single();

    if (fetchError || !loan) {
      throw new Error('No se encontró la deducción');
    }

    const newBalance = Math.max(0, (loan.balance ?? 0) - (loan.monthly_payment ?? 0));
    const newStatus = newBalance <= 0 ? 'paid' : 'active';

    const { data, error } = await supabase
      .from('employee_loans')
      .update({ balance: newBalance, status: newStatus, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single();

    if (error) {
      throw new Error('No se pudo registrar el pago de la cuota');
    }

    set((state) => ({
      employeeLoans: state.employeeLoans.map(l => l.id === id ? data as EmployeeLoan : l),
    }));
  },

  getPayrollLiquidations: async () => {
    const user = useAuthStore.getState().user;
    if (!user || !navigator.onLine) return;

    const { data, error } = await supabase
      .from('payroll_liquidations')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false });

    if (error) {
      logger.error('Error fetching payroll liquidations:', error);
      return;
    }

    set({ payrollLiquidations: data as PayrollLiquidation[] || [] });
  },

  saveLiquidation: async (liquidation) => {
    const user = useAuthStore.getState().user;
    if (!user) throw new Error('No hay usuario autenticado');
    if (!navigator.onLine) throw new Error('Requiere conexión a internet para guardar la liquidación');

    const { data, error } = await supabase
      .from('payroll_liquidations')
      .insert({ ...liquidation, user_id: user.id })
      .select()
      .single();

    if (error) {
      logger.error('Error saveLiquidation:', error);
      throw new Error(error.message || 'No se pudo guardar la liquidación');
    }

    set((state) => ({ payrollLiquidations: [data as PayrollLiquidation, ...state.payrollLiquidations] }));
  },

  deleteLiquidation: async (id) => {
    if (!navigator.onLine) throw new Error('Requiere conexión a internet para eliminar la liquidación');

    const { error } = await supabase.from('payroll_liquidations').delete().eq('id', id);

    if (error) {
      throw new Error('No se pudo eliminar la liquidación');
    }

    set((state) => ({ payrollLiquidations: state.payrollLiquidations.filter(l => l.id !== id) }));
  },

  getVacationMovements: async (month, year) => {
    const user = useAuthStore.getState().user;
    if (!user || !navigator.onLine) return [];

    const { data, error } = await supabase
      .from('employee_vacation_movements')
      .select('*')
      .eq('user_id', user.id)
      .eq('month', month)
      .eq('year', year);

    if (error) {
      logger.error('Error fetching vacation movements:', error);
      return [];
    }

    const movements = data as EmployeeVacationMovement[] || [];
    set((state) => ({
      vacationMovements: [
        ...state.vacationMovements.filter(m => !(m.month === month && m.year === year)),
        ...movements,
      ],
    }));

    return movements;
  },

  getVacationBalance: async (employeeId, month, year) => {
    const user = useAuthStore.getState().user;
    if (!user || !navigator.onLine) return 0;

    const { data, error } = await supabase
      .from('employee_vacation_movements')
      .select('days')
      .eq('user_id', user.id)
      .eq('employee_id', employeeId)
      .not('month', 'eq', month)
      .not('year', 'eq', year);

    if (error) {
      logger.error('Error fetching vacation balance:', error);
      return 0;
    }

    const total = (data || []).reduce((sum: number, m: any) => sum + (m.days || 0), 0);
    return Math.max(0, Math.round(total * 100) / 100);
  },

  addCategory: async (name) => {
    const user = useAuthStore.getState().user;
    if (!user) throw new Error('No hay usuario autenticado');

    try {
      const { data, error } = await queryWithRetry(() =>
        supabase
          .from('categories')
          .insert({ user_id: user.id, name: capitalize(name) })
          .select()
          .single()
      );

      if (error) {
        throw new Error('No se pudo agregar la categoría');
      }

      set((state) => ({ categories: [data, ...state.categories] }));
    } catch (error: any) {
      logger.error('Error en addCategory:', error);
      throw new Error(error.message || 'Error al agregar categoría');
    }
  },

  deleteCategory: async (id) => {
    const { error } = await queryWithRetry(() =>
      supabase.from('categories').delete().eq('id', id)
    );

    if (error) {
      throw new Error('No se pudo eliminar la categoría');
    }

    set((state) => ({ categories: state.categories.filter(c => c.id !== id) }));
  },

  getDailyClosings: async () => {
    const user = useAuthStore.getState().user;
    if (!user) return;

    if (!navigator.onLine) {
      try {
        const cached = await getCachedDailyClosings(user.id);
        if (cached && cached.length > 0) {
          set({ dailyClosings: cached });
        }
      } catch {}
      return;
    }

    const { data, error } = await supabase
      .from('daily_closings')
      .select('*')
      .eq('user_id', user.id)
      .order('closing_date', { ascending: false });

    if (error) {
      throw new Error('No se pudieron cargar los cierres de caja');
    }

    set({ dailyClosings: data || [] });
  },

  createDailyClosing: async (closing) => {
    const user = useAuthStore.getState().user;
    if (!user) return { success: false, error: 'No autenticado' };

    const closingDate = new Date(closing.closing_date).toISOString().split('T')[0];
    if (isDateClosed(get().dailyClosings, closingDate)) {
      return { success: false, error: 'Ya existe un cierre para esta fecha' };
    }

    if (!navigator.onLine) {
      const id = crypto.randomUUID();
      const offlineClosing = { ...closing, id, user_id: user.id, created_at: new Date().toISOString(), sales_count: closing.sales_count || 0 } as DailyClosing;
      set((state) => ({ dailyClosings: [offlineClosing, ...state.dailyClosings] }));
      await addToSyncQueue({ operation: 'createDailyClosing', table: 'daily_closings', payload: { ...closing, id, user_id: user.id, created_at: offlineClosing.created_at } });
      get().refreshSyncQueueCount();
      try { await db.dailyClosings.put(offlineClosing); } catch {}
      return { success: true };
    }

    try {
      const { data, error } = await queryWithRetry(() =>
        supabase
          .from('daily_closings')
          .insert({ ...closing, user_id: user.id, sales_count: closing.sales_count || 0 })
          .select()
          .single()
      );

      if (error) {
        logger.error('Error createDailyClosing:', error);
        if (error.code === '23505') {
          return { success: false, error: 'Ya existe un cierre para esta fecha' };
        }
        throw new Error(error.message || 'No se pudo registrar el cierre de caja');
      }

      set((state) => ({ dailyClosings: [data, ...state.dailyClosings] }));
      return { success: true };
    } catch (error: any) {
      logger.error('Error en createDailyClosing:', error);
      return { success: false, error: error.message || 'Error al registrar cierre de caja' };
    }
  },

  recalculateStock: async () => {
    const user = useAuthStore.getState().user;
    if (!user) return;

    const { data: movements } = await supabase
      .from('movements')
      .select('*')
      .eq('user_id', user.id);

    const { data: products } = await supabase
      .from('products')
      .select('*')
      .eq('user_id', user.id);

    if (!movements || !products) return;

    for (const product of products) {
      let calculatedQty = 0;
      movements
        .filter(m => m.product_id === product.id)
        .forEach(m => {
          if (m.type === 'ENTRADA') {
            calculatedQty += Number(m.quantity);
          } else {
            calculatedQty -= Number(m.quantity);
          }
        });

      await supabase
        .from('products')
        .update({ quantity: Math.max(0, calculatedQty), updated_at: new Date().toISOString() })
        .eq('id', product.id);
    }

    await get().fetchAll();
  },

  uploadHRDocument: async (file: File, docType: 'MANUAL' | 'REGLAMENTO' | 'PNO') => {
    const user = useAuthStore.getState().user;
    if (!user) return { success: false, error: 'No autenticado' };

    if (!navigator.onLine) {
      return { success: false, error: 'No hay conexión — los documentos se pueden subir solo cuando hay internet' };
    }

    const fileExt = file.name.split('.').pop();
    const fileName = `${user.id}/${docType}/${Date.now()}_${file.name.replace(/[^a-zA-Z0-9.-]/g, '_')}`;
    const filePath = `hr-documents/${fileName}`;

    const { error: uploadError } = await supabase.storage
      .from('hr-documents')
      .upload(filePath, file, { upsert: false });

    if (uploadError) {
      return { success: false, error: 'Error al subir el archivo: ' + uploadError.message };
    }

    const { data: urlData } = supabase.storage.from('hr-documents').getPublicUrl(filePath);

    const docName = file.name.replace(`.${fileExt}`, '').replace(/_/g, ' ').replace(/[.-]/g, ' ');

    const { error: dbError } = await supabase
      .from('hr_documents')
      .insert({
        user_id: user.id,
        name: docName,
        doc_type: docType,
        file_url: urlData.publicUrl,
        file_name: file.name,
        file_size: file.size,
      });

    if (dbError) {
      await supabase.storage.from('hr-documents').remove([filePath]);
      return { success: false, error: 'Error al guardar el registro: ' + dbError.message };
    }

    await get().fetchHRDocuments();
    return { success: true };
  },

  fetchHRDocuments: async () => {
    const user = useAuthStore.getState().user;
    if (!user) return;

    const { data, error } = await supabase
      .from('hr_documents')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false });

    if (error) {
      throw new Error('No se pudieron cargar los documentos');
    }

    set({ hrDocuments: data || [] });
  },

  deleteHRDocument: async (id: string, fileUrl: string) => {
    const { error: dbError } = await supabase
      .from('hr_documents')
      .delete()
      .eq('id', id);

    if (dbError) {
      throw new Error('No se pudo eliminar el registro');
    }

    const filePath = fileUrl.split('/hr-documents/')[1];
    if (filePath) {
      await supabase.storage.from('hr-documents').remove([`${filePath}`]);
    }

    set((state) => ({
      hrDocuments: state.hrDocuments.filter((d) => d.id !== id),
    }));
  },

  uploadEmployeeDocument: async (file: File, employeeId: string, docType: 'CONTRATO' | 'IDENTIFICACION' | 'OTRO', name?: string) => {
    const user = useAuthStore.getState().user;
    if (!user) return { success: false, error: 'No autenticado' };

    if (!navigator.onLine) {
      return { success: false, error: 'No hay conexión — los documentos se pueden subir solo cuando hay internet' };
    }

    const fileExt = file.name.split('.').pop();
    const fileName = `${user.id}/employees/${employeeId}/${Date.now()}_${file.name.replace(/[^a-zA-Z0-9.-]/g, '_')}`;
    const filePath = `hr-documents/${fileName}`;

    const { error: uploadError } = await supabase.storage
      .from('hr-documents')
      .upload(filePath, file, { upsert: false });

    if (uploadError) {
      return { success: false, error: 'Error al subir el archivo: ' + uploadError.message };
    }

    const { data: urlData } = supabase.storage.from('hr-documents').getPublicUrl(filePath);

    const docName = name || file.name.replace(`.${fileExt}`, '').replace(/_/g, ' ').replace(/[.-]/g, ' ');

    const { error: dbError } = await supabase
      .from('employee_documents')
      .insert({
        user_id: user.id,
        employee_id: employeeId,
        name: docName,
        doc_type: docType,
        file_url: urlData.publicUrl,
        file_name: file.name,
        file_size: file.size,
      });

    if (dbError) {
      await supabase.storage.from('hr-documents').remove([filePath]);
      return { success: false, error: 'Error al guardar el registro: ' + dbError.message };
    }

    await get().fetchEmployeeDocuments(employeeId);
    return { success: true };
  },

  fetchEmployeeDocuments: async (employeeId: string) => {
    const user = useAuthStore.getState().user;
    if (!user) return;

    const { data, error } = await supabase
      .from('employee_documents')
      .select('*')
      .eq('employee_id', employeeId)
      .order('created_at', { ascending: false });

    if (error) {
      throw new Error('No se pudieron cargar los documentos');
    }

    set({ employeeDocuments: data || [] });
  },

  deleteEmployeeDocument: async (id: string, fileUrl: string) => {
    const { error: dbError } = await supabase
      .from('employee_documents')
      .delete()
      .eq('id', id);

    if (dbError) {
      throw new Error('No se pudo eliminar el registro');
    }

    const filePath = fileUrl.split('/hr-documents/')[1];
    if (filePath) {
      await supabase.storage.from('hr-documents').remove([`${filePath}`]);
    }

    set((state) => ({
      employeeDocuments: state.employeeDocuments.filter((d) => d.id !== id),
    }));
  },

forceRefreshData: async () => {
    logger.info('[forceRefreshData] Refreshing data from Supabase...');
    const { fetchAll } = useDatabaseStore.getState();
    await fetchAll();
  },
}));

async function replayPendingSyncQueue(set: any, get: any) {
  const pendingItems = await db.syncQueue.where('status').equals('pending').toArray();
  if (pendingItems.length === 0) return;

  if (pendingItems.length > 500) {
    logger.warn(`[replayPendingSyncQueue] Queue size is ${pendingItems.length}, exceeding limit of 500. Notifying user.`);
    toast.error('La cola de sincronización offline es demasiado grande. Por favor, sincroniza online cuanto antes.');
  }

  logger.info(`[replayPendingSyncQueue] Replaying ${pendingItems.length} pending items...`);

  for (const item of pendingItems) {
    try {
    logger.info(`[replayPendingSyncQueue] Processing operation: ${item.operation}`);
    const p = item.payload as any;
    switch (item.operation) {
      case 'addProduct':
        if (p.product) {
          set((state: any) => {
            const updatedProducts = state.products.some((x: any) => x.id === p.product.id) ? state.products : [p.product, ...state.products];
            const updatedMovements = p.movement && !state.movements.some((m: any) => m.id === p.movement.id) ? [p.movement, ...state.movements] : state.movements;
            
            const newState = {
              ...state,
              products: updatedProducts,
              movements: updatedMovements,
            };
            
            if (p.productWarehouse && Array.isArray(p.productWarehouse)) {
              newState.productWarehouse = [...state.productWarehouse, ...p.productWarehouse];
            }
            return newState;
          });
          // Usar la versión actual del producto (con in_transit computado) en vez de la stale del sync queue
          const enrichedProduct = get().products.find((x: any) => x.id === p.product.id);
          if (enrichedProduct) {
            try { await db.products.put(enrichedProduct).catch(() => {}); } catch {}
          } else {
            try { await db.products.put(p.product).catch(() => {}); } catch {}
          }
          if (p.movement) {
            const enrichedMovement = get().movements.find((m: any) => m.id === p.movement.id);
            if (enrichedMovement) {
              try { await db.movements.put(enrichedMovement).catch(() => {}); } catch {}
            } else {
              try { await db.movements.put(p.movement).catch(() => {}); } catch {}
            }
          }
          if (p.productWarehouse && Array.isArray(p.productWarehouse) && p.productWarehouse.length > 0) {
            try { await db.productWarehouse.bulkPut(get().productWarehouse).catch(() => {}); } catch {}
          }
          // También persistir transitItems para que no se pierdan al reabrir offline
          try { await db.transitItems.bulkPut(get().transitItems).catch(() => {}); } catch {}
          try { await db.products.bulkPut(get().products).catch(() => {}); } catch {}
        }
        break;
      case 'updateProduct':
        set((state: any) => ({
          ...state,
          products: state.products.map((x: any) => x.id === p.id ? { ...x, ...p.updates } : x),
        }));
        try { await db.products.bulkPut(get().products).catch(() => {}); } catch {}
        break;
      case 'deleteProduct':
        set((state: any) => ({
          ...state,
          products: state.products.map((x: any) => x.id === p.id ? { ...x, is_active: false } : x),
        }));
        try { await db.products.bulkPut(get().products).catch(() => {}); } catch {}
        break;
      case 'addMovement':
        set((state: any) => {
          if (state.movements.some((m: any) => m.id === p.id)) return state;
          const newMovement = { ...p } as any;
          let newState = { ...state, movements: [newMovement, ...state.movements] };

          if (newMovement.type === 'SALIDA') {
            const transitId = ('ti-' + (newMovement.id || '').replace(/-/g, '').substring(0, 14)) as string;
            const transitItem = {
              id: transitId,
              user_id: newMovement.user_id,
              product_id: newMovement.product_id,
              quantity: Number(newMovement.quantity),
              consumed: 0,
              remaining: Number(newMovement.quantity),
              reason: newMovement.reason || 'Enviado a cocina/preparacion',
              sent_date: newMovement.date || new Date().toISOString(),
              created_at: newMovement.created_at || new Date().toISOString(),
              warehouse_id: newMovement.warehouse_id || null,
            } as any;

            if (newMovement.warehouse_id) {
              const pw = state.productWarehouse.find((pw: any) => pw.product_id === newMovement.product_id && pw.warehouse_id === newMovement.warehouse_id);
              const currentQty = pw ? Number(pw.quantity) : 0;
              let newQty = Math.max(0, currentQty - Number(newMovement.quantity));

              newState = {
                ...newState,
                productWarehouse: state.productWarehouse.map((pw: any) =>
                  pw.product_id === newMovement.product_id && pw.warehouse_id === newMovement.warehouse_id
                    ? { ...pw, quantity: newQty }
                    : pw
                ),
                transitItems: [transitItem, ...state.transitItems],
                products: state.products.map((pr: any) =>
                  pr.id === newMovement.product_id
                    ? { ...pr, quantity: Math.max(0, newQty), in_transit: Number(pr.in_transit || 0) + Number(newMovement.quantity) }
                    : pr
                ),
              };
            } else {
              const product = state.products.find((pr: any) => pr.id === newMovement.product_id);
              let newQuantity = Math.max(0, Number(product?.quantity || 0) - Number(newMovement.quantity));
              let newInTransit = Number(product?.in_transit || 0) + Number(newMovement.quantity);

              newState = {
                ...newState,
                transitItems: [transitItem, ...state.transitItems],
                products: state.products.map((pr: any) =>
                  pr.id === newMovement.product_id
                    ? { ...pr, quantity: newQuantity, in_transit: newInTransit }
                    : pr
                ),
              };
            }
          }
          else if (newMovement.type === 'ENTRADA' || newMovement.type === 'AJUSTE') {
            if (newMovement.warehouse_id) {
              const pw = state.productWarehouse.find((pw: any) => pw.product_id === newMovement.product_id && pw.warehouse_id === newMovement.warehouse_id);
              const currentQty = pw ? Number(pw.quantity) : 0;
              let newQty = Math.max(0, currentQty + Number(newMovement.quantity));
              newState = {
                ...newState,
                productWarehouse: state.productWarehouse.map((pw: any) =>
                  pw.product_id === newMovement.product_id && pw.warehouse_id === newMovement.warehouse_id
                    ? { ...pw, quantity: newQty }
                    : pw
                ),
                products: state.products.map((pr: any) =>
                  pr.id === newMovement.product_id
                    ? { ...pr, quantity: Math.max(0, newQty) }
                    : pr
                ),
              };
            } else {
              const product = state.products.find((pr: any) => pr.id === newMovement.product_id);
              let newQuantity = Math.max(0, Number(product?.quantity || 0) + Number(newMovement.quantity));
              newState = {
                ...newState,
                products: state.products.map((pr: any) =>
                  pr.id === newMovement.product_id
                    ? { ...pr, quantity: newQuantity }
                    : pr
                ),
              };
            }
          }
          else if (newMovement.type === 'MERMA') {
            if (newMovement.warehouse_id) {
              const pw = state.productWarehouse.find((pw: any) => pw.product_id === newMovement.product_id && pw.warehouse_id === newMovement.warehouse_id);
              const currentQty = pw ? Number(pw.quantity) : 0;
              let newQty = Math.max(0, currentQty - Number(newMovement.quantity));
              newState = {
                ...newState,
                productWarehouse: state.productWarehouse.map((pw: any) =>
                  pw.product_id === newMovement.product_id && pw.warehouse_id === newMovement.warehouse_id
                    ? { ...pw, quantity: newQty }
                    : pw
                ),
                products: state.products.map((pr: any) =>
                  pr.id === newMovement.product_id
                    ? { ...pr, quantity: Math.max(0, newQty) }
                    : pr
                ),
              };
            } else {
              const product = state.products.find((pr: any) => pr.id === newMovement.product_id);
              let newQuantity = Math.max(0, Number(product?.quantity || 0) - Number(newMovement.quantity));
              newState = {
                ...newState,
                products: state.products.map((pr: any) =>
                  pr.id === newMovement.product_id
                    ? { ...pr, quantity: newQuantity }
                    : pr
                ),
              };
            }
          }
          return newState;
        });
        // Después del replay, siempre persistir a Dexie para todos los tipos de movimiento
        {
          const mType = (p as any).type;
          if (mType === 'SALIDA') {
            try { await db.transitItems.bulkPut(get().transitItems).catch(() => {}); } catch {}
          }
          try { await db.products.bulkPut(get().products).catch(() => {}); } catch {}
          try { await db.movements.bulkPut(get().movements).catch(() => {}); } catch {}
          if ((p as any).warehouse_id) {
            try { await db.productWarehouse.bulkPut(get().productWarehouse).catch(() => {}); } catch {}
          }
        }
        break;
      case 'addSale':
        if (p.sale) {
          const saleWithItems = { ...p.sale, items: p.sale_items || [] };
          set((state: any) => ({
            ...state,
            sales: state.sales.some((s: any) => s.id === saleWithItems.id) ? state.sales : [saleWithItems, ...state.sales],
          }));
          if (p.itemsToConsume && Array.isArray(p.itemsToConsume)) {
            for (const ci of p.itemsToConsume) {
              set((state: any) => {
                let remainingLocal = ci.qtyNeeded;
                let consumedLocal = 0;
                const updatedTransitItems = state.transitItems
                  .filter((t: any) => t.product_id === ci.productId && t.remaining > 0)
                  .sort((a: any, b: any) => new Date(a.sent_date).getTime() - new Date(b.sent_date).getTime())
                  .map((t: any) => {
                    if (remainingLocal <= 0) return t;
                    const toConsume = Math.min(t.remaining, remainingLocal);
                    remainingLocal -= toConsume;
                    consumedLocal += toConsume;
                    return { ...t, remaining: t.remaining - toConsume, consumed: (t.consumed || 0) + toConsume };
                  });
                const newInTransit = Math.max(0, Number(state.products.find((pr: any) => pr.id === ci.productId)?.in_transit || 0) - consumedLocal);
                return {
                  ...state,
                  transitItems: updatedTransitItems,
                  products: state.products.map((pr: any) => pr.id === ci.productId ? { ...pr, in_transit: newInTransit } : pr),
                };
              });
            }
            try { await db.transitItems.bulkPut(get().transitItems).catch(() => {}); } catch {}
          }
        }
        break;
      case 'addRecipe':
        if (p.recipe) {
          const recipeWithIngredients = { ...p.recipe, ingredients: p.ingredients || [] };
          set((state: any) => ({
            ...state,
            recipes: state.recipes.some((r: any) => r.id === recipeWithIngredients.id) ? state.recipes : [recipeWithIngredients, ...state.recipes],
          }));
          try { await db.recipes.bulkPut(get().recipes).catch(() => {}); } catch {}
        }
        break;
      case 'updateRecipe':
        set((state: any) => ({
          ...state,
          recipes: state.recipes.map((r: any) => r.id === p.id ? { ...r, ...p.updates } : r),
        }));
        try { await db.recipes.bulkPut(get().recipes).catch(() => {}); } catch {}
        break;
      case 'deleteRecipe':
        set((state: any) => ({
          recipes: state.recipes.filter((r: any) => r.id !== p.id),
        }));
        try { await db.recipes.delete(p.id).catch(() => {}); } catch {}
        break;
      case 'createPendingAccount':
        set((state: any) => ({
          pendingAccounts: state.pendingAccounts.some((a: any) => a.id === p.id) ? state.pendingAccounts : [p, ...state.pendingAccounts],
        }));
        break;
      case 'justifyMovement':
        set((state: any) => ({
          movements: state.movements.map((m: any) =>
            m.id === p.id ? { ...m, status: 'JUSTIFICADO', justification: p.justification, justification_date: new Date().toISOString() } : m
          ),
        }));
        try { await db.movements.bulkPut(get().movements).catch(() => {}); } catch {}
        break;
      case 'updatePendingAccount':
        set((state: any) => ({
          pendingAccounts: state.pendingAccounts.map((a: any) =>
            a.id === p.accountId ? { ...a, ...p.updates, updated_at: new Date().toISOString() } : a
          ),
        }));
        break;
      case 'addItemsToPendingAccount':
        set((state: any) => ({
          pendingAccounts: state.pendingAccounts.map((a: any) => {
            if (a.id !== p.accountId) return a;
            const newItems = (p.items || []).map((i: any) => ({ ...i, added_at: i.added_at || new Date().toISOString() }));
            const allItems = [...(a.items || []), ...newItems];
            const newTotal = p.isAccountHouse ? 0 : allItems.reduce((sum: number, i: any) => sum + (i.subtotal || 0), 0);
            return { ...a, items: allItems, total_amount: newTotal, is_account_house: p.isAccountHouse, sale_type: p.saleType, updated_at: new Date().toISOString() };
          }),
        }));
        break;
      case 'updatePendingAccountItems':
        set((state: any) => ({
          pendingAccounts: state.pendingAccounts.map((a: any) => a.id === p.accountId ? { ...a, items: p.items, updated_at: new Date().toISOString() } : a),
        }));
        break;
      case 'togglePendingAccountType':
        set((state: any) => ({
          pendingAccounts: state.pendingAccounts.map((a: any) => a.id === p.accountId ? { ...a, is_account_house: p.is_account_house, total_amount: p.is_account_house ? 0 : a.items?.reduce((sum: number, i: any) => sum + i.subtotal, 0) || 0 } : a),
        }));
        break;
      case 'deletePendingAccount':
        set((state: any) => ({
          pendingAccounts: state.pendingAccounts.filter((a: any) => a.id !== p.accountId),
          transitItems: p.transitRestores?.length ? state.transitItems.map((t: any) => {
            const restore = p.transitRestores.find((r: any) => r.transitItemId === t.id);
            return restore ? { ...t, remaining: t.remaining + restore.quantity } : t;
          }) : state.transitItems,
        }));
        break;
      case 'markPendingAccountPaid':
        set((state: any) => ({
          pendingAccounts: state.pendingAccounts.filter((a: any) => a.id !== p.accountId),
        }));
        break;
      case 'createDailyClosing':
        set((state: any) => ({
          dailyClosings: state.dailyClosings.some((d: any) => d.id === p.id) ? state.dailyClosings : [p, ...state.dailyClosings],
        }));
        break;
      case 'cancelTransit':
        set((state: any) => {
          const transitItem = state.transitItems.find((t: any) => t.id === p.transitItemId);
          if (!transitItem) return state;
          const product = state.products.find((pr: any) => pr.id === p.productId);
          const newRemaining = transitItem.remaining - p.quantity;
          const newInTransit = Math.max(0, Number(product?.in_transit || 0) - p.quantity);
          const newQty = Number(product?.quantity || 0) + p.quantity;
          return {
            transitItems: state.transitItems.map((t: any) => t.id === p.transitItemId ? { ...t, remaining: newRemaining } : t).filter((t: any) => t.remaining > 0),
            products: state.products.map((pr: any) => pr.id === p.productId ? { ...pr, in_transit: newInTransit, quantity: newQty } : pr),
            productWarehouse: state.productWarehouse.map((pw: any) =>
              pw.product_id === p.productId && pw.warehouse_id === transitItem.warehouse_id
                ? { ...pw, quantity: Number(pw.quantity) + p.quantity } : pw
            ),
          };
        });
        try { await db.transitItems.bulkPut(get().transitItems).catch(() => {}); } catch {}
        try { await db.products.bulkPut(get().products).catch(() => {}); } catch {}
        break;
      case 'registerWasteFromTransit':
        set((state: any) => {
          const transitItem = state.transitItems.find((t: any) => t.id === p.transitItemId);
          if (!transitItem) return state;
          const newRemaining = transitItem.remaining - p.quantity;
          const newInTransit = Math.max(0, Number(state.products.find((pr: any) => pr.id === p.productId)?.in_transit || 0) - p.quantity);
          return {
            transitItems: state.transitItems.map((t: any) => t.id === p.transitItemId ? { ...t, remaining: newRemaining } : t).filter((t: any) => t.remaining > 0),
            products: state.products.map((pr: any) => pr.id === p.productId ? { ...pr, in_transit: newInTransit } : pr),
          };
        });
        try { await db.transitItems.bulkPut(get().transitItems).catch(() => {}); } catch {}
        break;
      case 'registerManualConsumption':
        set((state: any) => {
          const transitItem = state.transitItems.find((t: any) => t.id === p.transitItemId);
          if (!transitItem) return state;
          const newRemaining = transitItem.remaining - p.quantity;
          const newConsumed = (transitItem.consumed || 0) + p.quantity;
          const newInTransit = Math.max(0, Number(state.products.find((pr: any) => pr.id === p.productId)?.in_transit || 0) - p.quantity);
          return {
            transitItems: state.transitItems.map((t: any) => t.id === p.transitItemId ? { ...t, remaining: newRemaining, consumed: newConsumed } : t).filter((t: any) => t.remaining > 0),
            products: state.products.map((pr: any) => pr.id === p.productId ? { ...pr, in_transit: newInTransit } : pr),
          };
        });
        try { await db.transitItems.bulkPut(get().transitItems).catch(() => {}); } catch {}
        break;
      case 'updateAccessPinAttempts':
        set((state: any) => ({
          accessPins: state.accessPins.map((pin: any) =>
            pin.id === p.pinId ? { ...pin, ...(p.failed_attempts !== undefined && { failed_attempts: p.failed_attempts }), ...(p.blocked_until !== undefined && { blocked_until: p.blocked_until }) } : pin
          ),
        }));
        break;
    }
    } catch (e) {
      logger.error(`[replayPendingSyncQueue] Error processing ${item.operation}:`, e);
    }
  }

  // Persistencia consolidada al final del replay — garantiza que Dexie
  // refleje el estado completo de Zustand después de procesar todos los items
  try {
    const finalState = get();
    await db.transitItems.bulkPut(finalState.transitItems).catch(() => {});
    await db.products.bulkPut(finalState.products).catch(() => {});
    await db.movements.bulkPut(finalState.movements).catch(() => {});
    await db.productWarehouse.bulkPut(finalState.productWarehouse).catch(() => {});
  } catch {}
}

async function restoreFromCache(userId: string) {
  const [products, movements, warehouses, transitAll, sales, recipes, employees, categories, pendingAccounts, dailyClosings, accessPins, productWarehouse] = await Promise.all([
    getCachedProducts(userId),
    getCachedMovements(userId),
    getCachedWarehouses(userId),
    getCachedTransitItems(userId),
    getCachedSales(userId),
    getCachedRecipes(userId),
    getCachedEmployees(userId),
    getCachedCategories(userId),
    getCachedPendingAccounts(userId),
    getCachedDailyClosings(userId),
    getCachedAccessPins(userId),
    getCachedProductWarehouse(),
  ]);

  const transitItems = transitAll.filter(t => t.remaining > 0);

  // Recalcular quantity desde los movimientos (más fiable que el valor almacenado en Dexie)
  const qtyFromMovements = new Map<string, number>();
  for (const m of movements) {
    const current = qtyFromMovements.get(m.product_id) || 0;
    if (m.type === 'ENTRADA') qtyFromMovements.set(m.product_id, current + Number(m.quantity));
    else if (m.type === 'SALIDA' || m.type === 'MERMA') qtyFromMovements.set(m.product_id, current - Number(m.quantity));
    else if (m.type === 'AJUSTE') qtyFromMovements.set(m.product_id, current + Number(m.quantity));
  }

  const productsWithTransit = products.map(p => {
    const totalInTransit = transitItems
      .filter(t => t.product_id === p.id)
      .reduce((sum, t) => sum + t.remaining, 0);
    const computedQty = qtyFromMovements.has(p.id)
      ? Math.max(0, qtyFromMovements.get(p.id)!)
      : p.quantity;
    return { ...p, quantity: computedQty, in_transit: totalInTransit };
  });

  // Recalcular productWarehouse.quantity desde movimientos con warehouse_id
  const qtyPerWarehouse = new Map<string, number>();
  for (const m of movements) {
    if (!(m as any).warehouse_id) continue;
    const key = `${m.product_id}::${(m as any).warehouse_id}`;
    const current = qtyPerWarehouse.get(key) || 0;
    if (m.type === 'ENTRADA') qtyPerWarehouse.set(key, current + Number(m.quantity));
    else if (m.type === 'SALIDA' || m.type === 'MERMA') qtyPerWarehouse.set(key, current - Number(m.quantity));
    else if (m.type === 'AJUSTE') qtyPerWarehouse.set(key, current + Number(m.quantity));
  }

  // Enriquecer productWarehouse con quantity + in_transit calculados
  const productWarehouseWithTransit = productWarehouse.map(pw => {
    const transitForWarehouse = transitItems
      .filter(t => t.product_id === pw.product_id && t.warehouse_id === pw.warehouse_id)
      .reduce((sum, t) => sum + t.remaining, 0);
    const key = `${pw.product_id}::${pw.warehouse_id}`;
    const computedQty = qtyPerWarehouse.has(key)
      ? Math.max(0, qtyPerWarehouse.get(key)!)
      : pw.quantity;
    return { ...pw, quantity: computedQty, in_transit: transitForWarehouse };
  });

  // Restaurar currentWarehouseId desde main warehouse (o el primero disponible)
  const mainWarehouse = warehouses.find(w => w.is_main) || warehouses[0];
  const currentWarehouseId = useDatabaseStore.getState().currentWarehouseId || mainWarehouse?.id || '';

  useDatabaseStore.setState({
    products: productsWithTransit,
    movements,
    warehouses,
    transitItems,
    sales,
    recipes,
    employees,
    categories,
    pendingAccounts: pendingAccounts.filter(p => p.status === 'pending'),
    dailyClosings,
    accessPins,
    productWarehouse: productWarehouseWithTransit,
    currentWarehouseId,
    isLoading: false,
  });

  // Solo ejecutar replay del sync queue si hay conexión.
  // Offline los datos de Dexie ya están en su estado final; el replay
  // causaría doble consumo de transitItems y parpadeo a 0 en la UI.
  if (navigator.onLine) {
    await replayPendingSyncQueue(useDatabaseStore.setState, useDatabaseStore.getState);

    const postReplayTransit = useDatabaseStore.getState().transitItems;
    if (transitItems.length > 0 && postReplayTransit.length === 0) {
      logger.warn('⚠️ replayPendingSyncQueue eliminó transitItems — restaurando...');
      useDatabaseStore.setState({ transitItems });
      try { await db.transitItems.bulkPut(transitItems).catch(() => {}); } catch {}
    }
  }
}
