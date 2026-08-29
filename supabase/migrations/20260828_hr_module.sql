-- Módulo RRHH — migración defensiva (idempotente)
-- Crea columnas nuevas, tablas nuevas y políticas RLS para el módulo de Recursos Humanos.
-- Ejecutar manualmente en el dashboard de Supabase (SQL Editor).

-- =============================================================
-- 1. ALTER employees — columnas nuevas
-- =============================================================
ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS person_type text NOT NULL DEFAULT 'employee',
  ADD COLUMN IF NOT EXISTS base_contribution real,
  ADD COLUMN IF NOT EXISTS contract_type text,
  ADD COLUMN IF NOT EXISTS contract_end_date date,
  ADD COLUMN IF NOT EXISTS expediente integer,
  ADD COLUMN IF NOT EXISTS vacation_balance real NOT NULL DEFAULT 0;

-- Expediente único por negocio (user_id + expediente)
CREATE UNIQUE INDEX IF NOT EXISTS employees_user_expediente_idx ON employees(user_id, expediente);

-- Backfill de expediente para empleados existentes: asigna número secuencial
-- por negocio (orden created_at/id) solo a empleados que aún no tienen expediente.
-- Es idempotente: no re-numera ni choca con el índice único (user_id, expediente).
UPDATE employees AS e
SET expediente = seq.n
FROM (
  SELECT id, row_number() OVER (PARTITION BY user_id ORDER BY created_at, id) AS n
  FROM employees
) AS seq
WHERE e.id = seq.id
  AND e.expediente IS NULL;

-- =============================================================
-- 2. ALTER payroll_config — columnas nuevas
-- =============================================================
ALTER TABLE payroll_config
  ADD COLUMN IF NOT EXISTS monthly_hours real NOT NULL DEFAULT 190.6,
  ADD COLUMN IF NOT EXISTS vacation_accrual_days real NOT NULL DEFAULT 2.5;

-- =============================================================
-- 3. ALTER payroll_entries — columnas nuevas
-- =============================================================
ALTER TABLE payroll_entries
  ADD COLUMN IF NOT EXISTS overtime_hours real NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS overtime_type text,
  ADD COLUMN IF NOT EXISTS overtime_pay real NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS bonus real NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS vacation_pay real NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS advances real NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS loan_deduction real NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS other_deductions real NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS gross_salary real NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS worked_hours real NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS hourly_rate real NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS days_paid real NOT NULL DEFAULT 0;

-- =============================================================
-- 4. Tablas nuevas
-- =============================================================

-- employee_loans (deducciones/retenciones)
CREATE TABLE IF NOT EXISTS employee_loans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  employee_id uuid NOT NULL,
  total_amount real NOT NULL DEFAULT 0,
  monthly_payment real NOT NULL DEFAULT 0,
  balance real NOT NULL DEFAULT 0,
  start_date date,
  status text NOT NULL DEFAULT 'active',
  deduction_type text NOT NULL DEFAULT 'prestamo',
  reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- payroll_periods
CREATE TABLE IF NOT EXISTS payroll_periods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  month integer NOT NULL,
  year integer NOT NULL,
  status text NOT NULL DEFAULT 'draft',
  applied_at timestamptz,
  applied_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, month, year)
);

-- payroll_drafts (captación pre-nómina)
CREATE TABLE IF NOT EXISTS payroll_drafts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  month integer NOT NULL,
  year integer NOT NULL,
  employee_id uuid NOT NULL,
  include smallint NOT NULL DEFAULT 1,
  worked_hours real NOT NULL DEFAULT 0,
  hourly_rate real NOT NULL DEFAULT 0,
  bonus real NOT NULL DEFAULT 0,
  advances real NOT NULL DEFAULT 0,
  retention real NOT NULL DEFAULT 0,
  vacation_days real NOT NULL DEFAULT 0,
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, month, year, employee_id)
);

-- payroll_liquidations
CREATE TABLE IF NOT EXISTS payroll_liquidations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  employee_id uuid NOT NULL,
  employee_name text NOT NULL,
  base_salary real NOT NULL DEFAULT 0,
  hire_date date,
  end_date date,
  months_worked real NOT NULL DEFAULT 0,
  vacation_accumulated real NOT NULL DEFAULT 0,
  vacation_taken real NOT NULL DEFAULT 0,
  vacation_pending real NOT NULL DEFAULT 0,
  vacation_pay real NOT NULL DEFAULT 0,
  severance_months real NOT NULL DEFAULT 0,
  severance_pay real NOT NULL DEFAULT 0,
  notice_days integer NOT NULL DEFAULT 0,
  notice_pay real NOT NULL DEFAULT 0,
  gross_total real NOT NULL DEFAULT 0,
  cess real NOT NULL DEFAULT 0,
  iip real NOT NULL DEFAULT 0,
  net_total real NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- employee_vacation_movements
CREATE TABLE IF NOT EXISTS employee_vacation_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  employee_id uuid NOT NULL,
  month integer NOT NULL,
  year integer NOT NULL,
  type text NOT NULL,
  days real NOT NULL DEFAULT 0,
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- =============================================================
-- 5. RLS (user_id = auth.uid()) — tabla por tabla
-- =============================================================
ALTER TABLE employee_loans ENABLE ROW LEVEL SECURITY;
ALTER TABLE payroll_periods ENABLE ROW LEVEL SECURITY;
ALTER TABLE payroll_drafts ENABLE ROW LEVEL SECURITY;
ALTER TABLE payroll_liquidations ENABLE ROW LEVEL SECURITY;
ALTER TABLE employee_vacation_movements ENABLE ROW LEVEL SECURITY;

-- Nota: las tablas employees, departments, payroll_config, payroll_entries,
-- hr_documents y employee_documents ya existen con RLS aplicado desde Supabase.
-- Si alguna no tuviera RLS, descomentar los bloques siguientes:

-- employees
-- ALTER TABLE employees ENABLE ROW LEVEL SECURITY;
-- DROP POLICY IF EXISTS "employees_select_policy" ON employees;
-- CREATE POLICY "employees_select_policy" ON employees FOR SELECT USING (user_id = auth.uid());
-- DROP POLICY IF EXISTS "employees_insert_policy" ON employees;
-- CREATE POLICY "employees_insert_policy" ON employees FOR INSERT WITH CHECK (user_id = auth.uid());
-- DROP POLICY IF EXISTS "employees_update_policy" ON employees;
-- CREATE POLICY "employees_update_policy" ON employees FOR UPDATE USING (user_id = auth.uid());
-- DROP POLICY IF EXISTS "employees_delete_policy" ON employees;
-- CREATE POLICY "employees_delete_policy" ON employees FOR DELETE USING (user_id = auth.uid());

-- employee_loans
DROP POLICY IF EXISTS "employee_loans_select_policy" ON employee_loans;
CREATE POLICY "employee_loans_select_policy" ON employee_loans FOR SELECT USING (user_id = auth.uid());
DROP POLICY IF EXISTS "employee_loans_insert_policy" ON employee_loans;
CREATE POLICY "employee_loans_insert_policy" ON employee_loans FOR INSERT WITH CHECK (user_id = auth.uid());
DROP POLICY IF EXISTS "employee_loans_update_policy" ON employee_loans;
CREATE POLICY "employee_loans_update_policy" ON employee_loans FOR UPDATE USING (user_id = auth.uid());
DROP POLICY IF EXISTS "employee_loans_delete_policy" ON employee_loans;
CREATE POLICY "employee_loans_delete_policy" ON employee_loans FOR DELETE USING (user_id = auth.uid());

-- payroll_periods
DROP POLICY IF EXISTS "payroll_periods_select_policy" ON payroll_periods;
CREATE POLICY "payroll_periods_select_policy" ON payroll_periods FOR SELECT USING (user_id = auth.uid());
DROP POLICY IF EXISTS "payroll_periods_insert_policy" ON payroll_periods;
CREATE POLICY "payroll_periods_insert_policy" ON payroll_periods FOR INSERT WITH CHECK (user_id = auth.uid());
DROP POLICY IF EXISTS "payroll_periods_update_policy" ON payroll_periods;
CREATE POLICY "payroll_periods_update_policy" ON payroll_periods FOR UPDATE USING (user_id = auth.uid());
DROP POLICY IF EXISTS "payroll_periods_delete_policy" ON payroll_periods;
CREATE POLICY "payroll_periods_delete_policy" ON payroll_periods FOR DELETE USING (user_id = auth.uid());

-- payroll_drafts
DROP POLICY IF EXISTS "payroll_drafts_select_policy" ON payroll_drafts;
CREATE POLICY "payroll_drafts_select_policy" ON payroll_drafts FOR SELECT USING (user_id = auth.uid());
DROP POLICY IF EXISTS "payroll_drafts_insert_policy" ON payroll_drafts;
CREATE POLICY "payroll_drafts_insert_policy" ON payroll_drafts FOR INSERT WITH CHECK (user_id = auth.uid());
DROP POLICY IF EXISTS "payroll_drafts_update_policy" ON payroll_drafts;
CREATE POLICY "payroll_drafts_update_policy" ON payroll_drafts FOR UPDATE USING (user_id = auth.uid());
DROP POLICY IF EXISTS "payroll_drafts_delete_policy" ON payroll_drafts;
CREATE POLICY "payroll_drafts_delete_policy" ON payroll_drafts FOR DELETE USING (user_id = auth.uid());

-- payroll_liquidations
DROP POLICY IF EXISTS "payroll_liquidations_select_policy" ON payroll_liquidations;
CREATE POLICY "payroll_liquidations_select_policy" ON payroll_liquidations FOR SELECT USING (user_id = auth.uid());
DROP POLICY IF EXISTS "payroll_liquidations_insert_policy" ON payroll_liquidations;
CREATE POLICY "payroll_liquidations_insert_policy" ON payroll_liquidations FOR INSERT WITH CHECK (user_id = auth.uid());
DROP POLICY IF EXISTS "payroll_liquidations_delete_policy" ON payroll_liquidations;
CREATE POLICY "payroll_liquidations_delete_policy" ON payroll_liquidations FOR DELETE USING (user_id = auth.uid());

-- employee_vacation_movements
DROP POLICY IF EXISTS "employee_vacation_movements_select_policy" ON employee_vacation_movements;
CREATE POLICY "employee_vacation_movements_select_policy" ON employee_vacation_movements FOR SELECT USING (user_id = auth.uid());
DROP POLICY IF EXISTS "employee_vacation_movements_insert_policy" ON employee_vacation_movements;
CREATE POLICY "employee_vacation_movements_insert_policy" ON employee_vacation_movements FOR INSERT WITH CHECK (user_id = auth.uid());
DROP POLICY IF EXISTS "employee_vacation_movements_delete_policy" ON employee_vacation_movements;
CREATE POLICY "employee_vacation_movements_delete_policy" ON employee_vacation_movements FOR DELETE USING (user_id = auth.uid());