// Cálculos de nómina — fórmulas exactas del módulo RRHH (spec.rrhh.md)
// Empleado asalariado, socio (DL 92/2024) y liquidación al cese.

export const ROUND = (v: number) => Math.round(v * 100) / 100;

export const DEFAULT_MONTHLY_HOURS = 190.6;
export const DEFAULT_VACATION_ACCRUAL_DAYS = 2.5;
export const DEFAULT_EXEMPTION_BASE = 3260;
export const PARTNER_BASE_MIN = 2000;
export const PARTNER_BASE_MAX = 9500;
export const PARTNER_CONTRIBUTION_RATE = 0.2;

// Multiplicadores de horas extra
export const OVERTIME_MULTIPLIERS: Record<string, number> = {
  diurna: 2.0,
  nocturna: 2.5,
  descanso: 2.0,
  feriado: 3.0,
};

// Escala progresiva IIP (Res. 41/2023) — tramo 1 exento configurable
export const IIP_BRACKETS = [
  { min: 9510, max: 15000, rate: 0.05 },
  { min: 15000, max: 20000, rate: 0.075 },
  { min: 20000, max: 25000, rate: 0.10 },
  { min: 25000, max: 30000, rate: 0.15 },
  { min: 30000, max: Infinity, rate: 0.20 },
];

const clamp = (v: number, min: number, max: number) => Math.min(Math.max(v, min), max);

// CESS: 5% hasta 15,000 + 10% sobre el exceso (Ley 164/2023)
export function calcularCESS(gross: number): number {
  return ROUND(Math.min(gross, 15000) * 0.05 + Math.max(0, gross - 15000) * 0.10);
}

// IIP progresivo sobre el bruto. Primer tramo [0–exempt] exento (0%).
export function calcularIIP(gross: number, exemptionBase: number = DEFAULT_EXEMPTION_BASE): number {
  let tax = 0;
  const taxableInBracket = (gross: number, min: number, max: number) =>
    Math.max(0, Math.min(gross, max) - min);

  const firstUpper = Math.max(exemptionBase, 0);
  const firstTier = taxableInBracket(gross, firstUpper, 9510);
  if (firstTier > 0) tax += firstTier * 0.03;

  for (const b of IIP_BRACKETS) {
    const taxable = taxableInBracket(gross, b.min, b.max);
    if (taxable > 0) tax += taxable * b.rate;
  }

  return ROUND(tax);
}

export type OvertimeType = 'diurna' | 'nocturna' | 'descanso' | 'feriado';

export interface EmployeePayrollParams {
  baseSalary: number;
  hourlyRate?: number;
  workedHours?: number;
  monthlyHours?: number;
  overtimeHours?: number;
  overtimeType?: OvertimeType;
  bonus?: number;
  vacationDays?: number;
  advances?: number;
  loanDeduction?: number;
  otherDeductions?: number;
  exemptionBase?: number;
}

export interface PayrollResult {
  hourlyRate: number;
  workedHours: number;
  daysPaid: number;
  earnedSalary: number;
  overtimeHours: number;
  overtimeType?: OvertimeType;
  overtimePay: number;
  bonus: number;
  vacationDays: number;
  vacationPay: number;
  grossSalary: number;
  vacationBase: number;
  taxableBase: number;
  taxAmount: number;
  specialContribution: number;
  employerContribution: number;
  advances: number;
  loanDeduction: number;
  otherDeductions: number;
  totalDeductions: number;
  netSalary: number;
}

export function calcularNominaEmpleado(params: EmployeePayrollParams): PayrollResult {
  const monthlyHours = params.monthlyHours ?? DEFAULT_MONTHLY_HOURS;
  const exemptionBase = params.exemptionBase ?? DEFAULT_EXEMPTION_BASE;

  const hourlyRate = params.hourlyRate ?? ROUND(params.baseSalary / monthlyHours);
  const workedHours = params.workedHours ?? monthlyHours;
  const earnedSalary = ROUND(hourlyRate * workedHours);
  const daysPaid = ROUND(workedHours / 8);

  const overtimeHours = params.overtimeHours ?? 0;
  const overtimeType = params.overtimeType;
  const overtimeMult = overtimeType ? (OVERTIME_MULTIPLIERS[overtimeType] ?? 0) : 0;
  const overtimePay = overtimeHours > 0 ? ROUND((params.baseSalary / monthlyHours) * overtimeHours * overtimeMult) : 0;

  const bonus = params.bonus ?? 0;
  const vacationDays = params.vacationDays ?? 0;
  const vacationPay = vacationDays > 0 ? ROUND((params.baseSalary / 30) * vacationDays) : 0;

  const grossSalary = ROUND(params.baseSalary + overtimePay + bonus + vacationPay);
  const vacationBase = ROUND(grossSalary * 1.0909);

  const specialContribution = calcularCESS(grossSalary);
  const taxAmount = calcularIIP(grossSalary, exemptionBase);
  const employerContribution = ROUND(vacationBase * 0.14);

  const advances = params.advances ?? 0;
  const loanDeduction = params.loanDeduction ?? 0;
  const otherDeductions = params.otherDeductions ?? 0;
  const totalDeductions = ROUND(specialContribution + taxAmount + advances + loanDeduction + otherDeductions);
  const netSalary = ROUND(grossSalary - totalDeductions);

  const taxableBase = Math.max(0, ROUND(grossSalary - exemptionBase));

  return {
    hourlyRate,
    workedHours,
    daysPaid,
    earnedSalary,
    overtimeHours,
    overtimeType,
    overtimePay,
    bonus,
    vacationDays,
    vacationPay,
    grossSalary,
    vacationBase,
    taxableBase,
    taxAmount,
    specialContribution,
    employerContribution,
    advances,
    loanDeduction,
    otherDeductions,
    totalDeductions,
    netSalary,
  };
}

export interface PartnerPayrollParams {
  retiro: number;
  baseContribution: number;
  bonus?: number;
  advances?: number;
  loanDeduction?: number;
  otherDeductions?: number;
}

export function calcularNominaSocio(params: PartnerPayrollParams): PayrollResult {
  const base = clamp(params.baseContribution, PARTNER_BASE_MIN, PARTNER_BASE_MAX);
  const specialContribution = ROUND(base * PARTNER_CONTRIBUTION_RATE);

  const bonus = params.bonus ?? 0;
  const grossSalary = ROUND(params.retiro + bonus);

  const advances = params.advances ?? 0;
  const loanDeduction = params.loanDeduction ?? 0;
  const otherDeductions = params.otherDeductions ?? 0;
  const totalDeductions = ROUND(specialContribution + advances + loanDeduction + otherDeductions);
  const netSalary = ROUND(grossSalary - totalDeductions);

  return {
    hourlyRate: 0,
    workedHours: 0,
    daysPaid: 0,
    earnedSalary: params.retiro,
    overtimeHours: 0,
    overtimeType: undefined,
    overtimePay: 0,
    bonus,
    vacationDays: 0,
    vacationPay: 0,
    grossSalary,
    vacationBase: 0,
    taxableBase: 0,
    taxAmount: 0,
    specialContribution,
    employerContribution: 0,
    advances,
    loanDeduction,
    otherDeductions,
    totalDeductions,
    netSalary,
  };
}

export interface LiquidationParams {
  baseSalary: number;
  hireDate: string;
  endDate: string;
  vacationTaken: number;
  contractType?: 'indefinite' | 'fixed' | 'probation';
}

export interface LiquidationResult {
  monthsWorked: number;
  yearsWorked: number;
  vacationAccumulated: number;
  vacationTaken: number;
  vacationPending: number;
  vacationPay: number;
  severanceMonths: number;
  severancePay: number;
  noticeDays: number;
  noticePay: number;
  grossTotal: number;
  cess: number;
  iip: number;
  netTotal: number;
}

export function calcularLiquidacion(params: LiquidationParams): LiquidationResult {
  const start = new Date(`${params.hireDate}T00:00:00`).getTime();
  const end = new Date(`${params.endDate}T00:00:00`).getTime();
  const days = Math.floor((end - start) / 86400000);

  const monthsWorked = days / 30;
  const yearsWorked = days / 365;

  const vacationAccumulated = ROUND(monthsWorked * DEFAULT_VACATION_ACCRUAL_DAYS);
  const vacationPending = Math.max(0, ROUND(vacationAccumulated - (params.vacationTaken || 0)));
  const vacationPay = ROUND((params.baseSalary / 30) * vacationPending);

  const isIndefinite = params.contractType === 'indefinite';

  const severanceMonths = isIndefinite ? Math.min(yearsWorked, 6) : 0;
  const severancePay = isIndefinite ? ROUND(severanceMonths * params.baseSalary) : 0;

  const noticeDays = isIndefinite ? 30 : 0;
  const noticePay = isIndefinite ? ROUND((params.baseSalary / 30) * noticeDays) : 0;

  const grossTotal = ROUND(vacationPay + severancePay + noticePay);
  const cess = calcularCESS(grossTotal);
  const iip = calcularIIP(grossTotal, DEFAULT_EXEMPTION_BASE);
  const netTotal = ROUND(grossTotal - cess - iip);

  return {
    monthsWorked,
    yearsWorked,
    vacationAccumulated,
    vacationTaken: params.vacationTaken || 0,
    vacationPending,
    vacationPay,
    severanceMonths,
    severancePay,
    noticeDays,
    noticePay,
    grossTotal,
    cess,
    iip,
    netTotal,
  };
}