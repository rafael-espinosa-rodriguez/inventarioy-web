import { test, expect, Page } from '@playwright/test';

const CREDENTIALS = { email: 'payrolltest638434@gmail.com', password: 'PayrollTest123!' };
const APP_URL = 'http://localhost:3000';
const SUPABASE_URL = 'https://ybymcbwnjcgdoqrosqdw.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlieW1jYnduamNnZG9xcm9zcWR3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM4NTQxMDcsImV4cCI6MjA4OTQzMDEwN30.JNlytCWFtSkvp0v3t0-Au4X5tmfBEUn4kPwvr5vmORI';

async function login(page: Page) {
  await page.goto(APP_URL + '/login', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => true });
    window.dispatchEvent(new Event('online'));
  });
  await page.waitForTimeout(1000);
  const r = await page.evaluate(async ({ u, a, e, p }) => {
    const resp = await fetch(`${u}/auth/v1/token?grant_type=password`, {
      method: 'POST', headers: { apikey: a, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: e, password: p })
    });
    const d = await resp.json();
    if (!d.access_token) return { ok: false, error: d.error_description || d.msg || 'fail', status: resp.status };
    localStorage.setItem('sb-ybymcbwnjcgdoqrosqdw-auth-token', JSON.stringify({
      access_token: d.access_token, refresh_token: d.refresh_token,
      expires_at: Date.now() + d.expires_in * 1000, expires_in: d.expires_in,
      token_type: 'bearer', user: d.user
    }));
    return { ok: true };
  }, { u: SUPABASE_URL, a: SUPABASE_ANON, e: CREDENTIALS.email, p: CREDENTIALS.password });
  if (!r.ok) throw new Error('Login failed: ' + r.error);
  // Acceso directo al módulo HR como owner (sin depender de PINs configurados)
  await page.evaluate(() => {
    localStorage.setItem('verifiedRole', 'owner');
    localStorage.setItem('verifiedRoleName', 'Test');
  });
}

async function seedAndCleanup(page: Page) {
  return page.evaluate(async ({ supabaseUrl, supabaseAnon }) => {
    const headers = { apikey: supabaseAnon, 'Content-Type': 'application/json' };
    let accessToken = '';
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i) || '';
      try {
        const val = JSON.parse(localStorage.getItem(key) || '');
        if (val?.access_token) { accessToken = val.access_token; break; }
        if (val?.currentSession?.access_token) { accessToken = val.currentSession.access_token; break; }
      } catch { /* ignore */ }
    }
    if (!accessToken) return { ok: false, error: 'no token' };
    const authHeaders = { ...headers, Authorization: 'Bearer ' + accessToken };
    const uResp = await fetch(`${supabaseUrl}/auth/v1/user`, { headers: authHeaders });
    const uData = await uResp.json();
    const uid = uData?.id;
    if (!uid) return { ok: false, error: 'no uid' };

    const ih = { ...authHeaders, Prefer: 'return=minimal' };

    // Limpieza de datos HR del usuario de prueba
    const hrTables = ['employee_vacation_movements', 'payroll_liquidations', 'employee_loans', 'payroll_drafts', 'payroll_periods', 'payroll_entries', 'employee_documents', 'employees'];
    for (const table of hrTables) {
      try { await fetch(`${supabaseUrl}/rest/v1/${table}?user_id=eq.${uid}`, { method: 'DELETE', headers: authHeaders }); } catch { /* ignore */ }
    }
    try {
      const deps = await (await fetch(`${supabaseUrl}/rest/v1/departments?user_id=eq.${uid}&name=eq.Depto%20Payroll%20Prueba`, { headers: authHeaders })).json();
      for (const d of deps) {
        await fetch(`${supabaseUrl}/rest/v1/departments?id=eq.${d.id}`, { method: 'DELETE', headers: authHeaders });
      }
    } catch { /* ignore */ }

    // Limpiar caché IndexedDB para evitar datos viejos
    try { indexedDB.deleteDatabase('InventarioYLocal'); } catch { /* ignore */ }

    const now = new Date().toISOString();
    const uuid = () => crypto.randomUUID();

    const deptId = uuid();
    await fetch(`${supabaseUrl}/rest/v1/departments`, { method: 'POST', headers: ih, body: JSON.stringify({ id: deptId, user_id: uid, name: 'Depto Payroll Prueba', created_at: now }) });

    const cfgId = uuid();
    await fetch(`${supabaseUrl}/rest/v1/payroll_config`, {
      method: 'POST', headers: ih,
      body: JSON.stringify({ id: cfgId, user_id: uid, tax_exemption_base: 3260, tax_rate: 5, special_contribution_rate: 5, monthly_hours: 190.6, vacation_accrual_days: 2.5, created_at: now, updated_at: now })
    });

    const e1Id = uuid();
    const e2Id = uuid();
    const employees = [
      { id: e1Id, user_id: uid, name: 'Payroll Test Uno', role: 'Cajero Prueba', salary: 10000, category: deptId, hire_date: '2024-01-01', person_type: 'employee', contract_type: 'indefinite', expediente: 1, vacation_balance: 0, created_at: now },
      { id: e2Id, user_id: uid, name: 'Payroll Test Dos', role: 'Cocinero Prueba', salary: 8000, category: deptId, hire_date: '2024-02-01', person_type: 'employee', contract_type: 'fixed', contract_end_date: '2026-12-31', expediente: 2, vacation_balance: 0, created_at: now },
    ];
    for (const emp of employees) {
      await fetch(`${supabaseUrl}/rest/v1/employees`, { method: 'POST', headers: ih, body: JSON.stringify(emp) });
    }

    return { ok: true, deptId, employees: [e1Id, e2Id] };
  }, { supabaseUrl: SUPABASE_URL, supabaseAnon: SUPABASE_ANON });
}

test('Flujo de nómina: captación → generar → conceptos → aplicar', { tag: '@critical' }, async ({ page }) => {
  test.setTimeout(600000);

  await login(page);
  const seed = await seedAndCleanup(page);
  expect(seed.ok).toBe(true);

  // Recargar la página para que el store (zustand) re-ejecute su carga inicial
  // desde Supabase y así refleje los empleados sembrados por API en seedAndCleanup.
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(4000);

  await page.goto(APP_URL + '/dashboard/hr', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(3000);
  await expect(page.locator('body')).toContainText('Recursos Humanos', { timeout: 60000 });

  // Cerrar el modal global "Teléfono de Contacto" si aparece (onboarding de la app)
  const masTarde = page.getByRole('button', { name: 'Más tarde' });
  if (await masTarde.isVisible().catch(() => false)) {
    await masTarde.click();
    await page.waitForTimeout(300);
  }

  // Pestaña Nómina
  await page.getByRole('button', { name: 'Nómina' }).first().click();
  await expect(page.locator('body')).toContainText('Captación pre-nómina', { timeout: 30000 });

  // La captación debe mostrar los empleados sembrados
  await expect(page.locator('body')).toContainText('Payroll Test Uno', { timeout: 30000 });
  await expect(page.locator('body')).toContainText('Payroll Test Dos', { timeout: 30000 });

  // Guardar Captación
  await page.getByRole('button', { name: /Guardar Captación/ }).click();
  await page.waitForTimeout(1500);

  // Generar Nómina
  await page.getByRole('button', { name: /Generar Nómina/ }).click();
  await page.waitForTimeout(4000);

  // Tabla de nómina con trabajadores y totales
  await expect(page.locator('body')).toContainText('Total Salario Devengado (a Pagar)', { timeout: 30000 });
  const nominaBody = (await page.locator('body').textContent().catch(() => '')) || '';
  expect(nominaBody).toMatch(/Payroll Test Uno/);
  expect(nominaBody).toMatch(/Payroll Test Dos/);

  // Conceptos: bonificación en la primera fila (2º input numérico del modal)
  await page.getByTitle('Editar conceptos').first().click();
  await page.waitForTimeout(600);
  await page.getByRole('dialog').locator('input[type="number"]').nth(1).fill('100');
  await page.getByRole('dialog').getByRole('button', { name: 'Guardar' }).click();
  await page.waitForTimeout(2000);

  // Aplicar Nómina (owner)
  await page.getByRole('button', { name: /Aplicar Nómina/ }).click();
  await page.waitForTimeout(800);
  await page.getByRole('dialog').getByRole('button', { name: 'Aplicar', exact: true }).click();
  await expect(page.locator('body')).toContainText('Nómina aplicada (bloqueada)', { timeout: 30000 });
});