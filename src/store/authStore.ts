import { create } from 'zustand';
import { supabase } from '../lib/supabase';
import { clearLocalData } from '../lib/dexieDb';
import { useDatabaseStore } from './dbStore';
import { logger } from '../lib/logger';
import { syncEngine } from '../lib/syncEngine';
import { setRealtimeUserId } from '../lib/realtimeSync';

const checkRealInternetConnection = async (): Promise<boolean> => {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    const { error } = await supabase.from('products').select('id').limit(1).abortSignal(controller.signal).maybeSingle();

    clearTimeout(timeoutId);
    return !error;
  } catch {
    return false;
  }
};

const withTimeout = async <T>(promise: Promise<T> | any, timeoutMs: number = 10000): Promise<T> => {
  try {
    const result = await Promise.race([
      promise,
      new Promise<T>((_, reject) => setTimeout(() => reject(new Error('TIMEOUT')), timeoutMs))
    ]);
    return result;
  } catch (err: any) {
    if (err.message === 'TIMEOUT') {
      throw new Error('TIMEOUT');
    }
    throw err;
  }
};

export interface User {
  id: string;
  email: string;
  name: string;
  businessName: string;
  role: 'admin' | 'user';
  createdAt: string;
  subscription: {
    status: 'trialing' | 'active' | 'past_due' | 'canceled';
    trialEndsAt: string;
    validUntil: string | null;
  };
  isSubscriptionActive: boolean;
  generateTicket: boolean;
  ticketMessage: string;
  usdEnabled: boolean;
  usdRate: number;
  eurEnabled: boolean;
  eurRate: number;
  cupTransferEnabled: boolean;
  phone: string;
  address: string;
  businessHours: string;
  businessCode: string;
  themePreference: 'light' | 'dark';
}

interface AuthState {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<{ success: boolean; error?: string }>;
  register: (email: string, password: string, name: string, businessName: string, phone?: string) => Promise<{ success: boolean; error?: string }>;
  forgotPassword: (email: string) => Promise<{ success: boolean; error?: string }>;
  logout: () => Promise<void>;
  updateSubscription: (updates: Partial<User['subscription']>) => void;
  fetchUser: () => Promise<boolean>;
  initialize: () => Promise<void>;
}

let _isInitializing = false;
let _authListenerSubscription: any = null;

const checkSubscriptionActive = (role: string, subscription: User['subscription']): boolean => {
  if (role === 'admin') {
    return true;
  }
  
  if (subscription.status === 'canceled') {
    return false;
  }
  
  if (subscription.status === 'past_due') {
    return false;
  }
  
  if (subscription.status === 'active') {
    if (subscription.validUntil) {
      const validUntil = new Date(subscription.validUntil);
      if (validUntil > new Date()) {
        return true;
      }
    }
    return false;
  }
  
  if (subscription.status === 'trialing') {
    const trialEnd = new Date(subscription.trialEndsAt);
    if (trialEnd > new Date()) {
      return true;
    }
    return false;
  }
  
  return false;
};

const translateError = (message: string): string => {
  const errorTranslations: Record<string, string> = {
    'Invalid login credentials': 'Credenciales de inicio de sesión inválidas',
    'Email not confirmed': 'Correo electrónico no confirmado',
    'User already registered': 'Este correo electrónico ya está registrado',
    'User already exists': 'Este usuario ya existe',
    'Invalid email': 'Correo electrónico inválido',
    'Password should be at least 6 characters': 'La contraseña debe tener al menos 6 caracteres',
    'Signup requires a valid password': 'Para registrarse se requiere una contraseña válida',
    'Unable to validate email address: Invalid email format': 'No se pudo validar el correo electrónico: Formato inválido',
    'No valid workers found': 'No se encontraron trabajadores válidos',
    'Not authorized': 'No autorizado',
    'Session expired': 'Sesión expirada',
    'Token expired': 'Token expirado',
    'Invalid token': 'Token inválido',
    'Failed to parse signlink URL': 'Error al analizar la URL de enlace',
    'Linking requires a confirmation': 'La vinculación requiere una confirmación',
    'A user with this email address has already been registered': 'Ya existe un usuario con este correo electrónico',
    'To sign up, you must accept the Terms': 'Para registrarte, debes aceptar los Términos',
    'Security key issue': 'Problema con la clave de seguridad',
    'Phone number is invalid': 'El número de teléfono es inválido',
    'Invalid phone number': 'Número de teléfono inválido',
    'Too many requests': 'Demasiadas solicitudes. Por favor, espera un momento',
    'Network request failed': 'Error de solicitud de red',
    'Invalid URL': 'URL inválida',
    'Missing requirements for Sozial Login': 'Requisitos faltantes para inicio de sesión social',
    'Failed to fetch': 'Sin conexión a internet',
    'Failed to fetch (offline)': 'Sin conexión a internet',
    'NetworkError': 'Sin conexión a internet',
  };

  if (errorTranslations[message]) {
    return errorTranslations[message];
  }

  if (message.includes('Invalid login credentials')) {
    return 'Credenciales de inicio de sesión inválidas';
  }
  if (message.includes('already registered') || message.includes('already exists')) {
    return 'Este correo electrónico ya está registrado';
  }
  if (message.includes('invalid email') || message.includes('Invalid email')) {
    return 'Correo electrónico inválido';
  }
  if (message.includes('password')) {
    return 'Contraseña incorrecta';
  }
  if (message.includes('not confirmed')) {
    return 'Correo electrónico no confirmado. Revise su bandeja de entrada';
  }
  if (message.includes('rate limit') || message.includes('too many')) {
    return 'Demasiadas solicitudes. Por favor, espera un momento';
  }
  if (message.includes('network') || message.includes('fetch')) {
    return 'Error de conexión. Verifique su internet';
  }

  return message;
};

export const useAuthStore = create<AuthState>()((set, get) => ({
  user: null,
  isAuthenticated: false,
  isLoading: true,

  initialize: async () => {
    if (_isInitializing) {
      logger.info('initialize ya está en progreso, ignorando...');
      return;
    }
    _isInitializing = true;

    // Detección de multi-pestaña para evitar conflictos IndexedDB
    if (typeof window !== 'undefined') {
      const tabKey = 'inventarioy_tab_active';
      const existing = localStorage.getItem(tabKey);
      if (existing) {
        const age = Date.now() - parseInt(existing, 10);
        if (age < 3000) {
          logger.warn('⚠️ Otra pestaña de InventarioY está activa — pueden ocurrir conflictos de sincronización');
        }
      }
      localStorage.setItem(tabKey, String(Date.now()));
    }

    logger.info('Inicializando autenticación...');

    const savedUserData = localStorage.getItem('inventarioy_user');

    // Si hay datos de usuario guardados, mostrarlos inmediatamente mientras se verifica la sesión
    if (savedUserData) {
      try {
        const userData = JSON.parse(savedUserData);
        set({ user: userData, isAuthenticated: true, isLoading: true });
      } catch {
        set({ isLoading: true });
      }
    } else {
      set({ isLoading: true });
    }

    // === OPTIMIZACIÓN OFFLINE ===
    // Si no hay conexión, restaurar sesión guardada inmediatamente sin timeout
    if (!navigator.onLine) {
      logger.info('📴 Modo offline — restaurando sesión guardada', { 
        hasSavedUserData: !!savedUserData
      });
      if (savedUserData) {
        try {
          const userData = JSON.parse(savedUserData);
          set({ user: userData, isAuthenticated: true, isLoading: false });
          logger.info('✅ Sesión restaurada offline', { email: userData.email });
        } catch {
          set({ isLoading: false });
          logger.warn('Error parseando savedUserData');
        }
      } else {
        set({ isLoading: false });
        logger.info('❌ No hay savedUserData para restaurar');
      }
      _isInitializing = false;
      return;
    }

    try {
      const { data: { session } } = await Promise.race([
        supabase.auth.getSession(),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('AuthTimeout')), 30000)
        ),
      ]);

      if (session?.user) {
        await get().fetchUser();
      } else {
        if (savedUserData) {
          const userData = JSON.parse(savedUserData);
          set({ user: userData, isAuthenticated: true, isLoading: false });
        } else {
          set({ isLoading: false });
        }
      }

      if (!_authListenerSubscription) {
        logger.info('Creando listener de autenticación...');
        _authListenerSubscription = supabase.auth.onAuthStateChange(async (event, session) => {
          logger.info('Auth state change:', event);
          if (event === 'SIGNED_IN' && session?.user) {
            await get().fetchUser();
          } else if (event === 'SIGNED_OUT') {
            if (!navigator.onLine) {
              logger.info('[Auth] SIGNED_OUT ignorado — modo offline');
              return;
            }
            set({ user: null, isAuthenticated: false, isLoading: false });
          }
        });
      }
    } catch (err: any) {
      if (err?.name === 'AbortError' && err?.message?.includes('Lock broken')) {
        logger.warn('AbortError por multi-pestaña en initialize, restaurando sesión guardada');
        if (savedUserData) {
          try {
            const userData = JSON.parse(savedUserData);
            set({ user: userData, isAuthenticated: true, isLoading: false });
          } catch {
            set({ isLoading: false });
          }
        } else {
          set({ isLoading: false });
        }
      } else if (err?.message === 'AuthTimeout') {
        logger.warn('Timeout en getSession');
        if (savedUserData) {
          try {
            const userData = JSON.parse(savedUserData);
            set({ user: userData, isAuthenticated: true, isLoading: false });
          } catch {
            set({ isLoading: false });
          }
        } else {
          set({ isLoading: false });
        }
      } else if (err?.message?.includes('429') || err?.status === 429) {
        logger.warn('Rate limit alcanzado en autenticación, reintentando en 5 segundos...');
        await new Promise(r => setTimeout(r, 5000));
        try {
          const { data: { session } } = await supabase.auth.getSession();
          if (session?.user) {
            await get().fetchUser();
          } else {
            set({ isLoading: false });
          }
        } catch {
          set({ isLoading: false });
        }
      } else if (err?.message?.includes('fetch') || err?.message?.includes('network') || err?.message?.includes('NetworkError') || err?.name === 'TypeError') {
        // Error de red (posible caso donde navigator.onLine = true pero no hay internet real)
        logger.warn('Error de red en getSession, restaurando sesión guardada:', err.message);
        if (savedUserData) {
          try {
            const userData = JSON.parse(savedUserData);
            set({ user: userData, isAuthenticated: true, isLoading: false });
            logger.info('✅ Sesión restaurada tras error de red', { email: userData.email });
          } catch {
            set({ isLoading: false });
          }
        } else {
          set({ isLoading: false });
          logger.info('❌ No hay savedUserData para restaurar tras error de red');
        }
      } else if (import.meta.env.DEV) {
        logger.error('Error en initialize:', err);
        set({ isLoading: false });
      } else {
        set({ isLoading: false });
      }
    } finally {
      _isInitializing = false;
    }
  },

  fetchUser: async () => {
    logger.info('fetchUser llamado...');
    try {
      const { data: { user: authUser }, error: authError } = await withTimeout(
        supabase.auth.getUser(),
        10000
      ) as any;
      
      if (authError) {
        logger.error('Error en getUser:', authError);
        return false;
      }
      
      if (!authUser) {
        logger.info('No hay usuario autenticado');
        return false;
      }

      let profile = null;
      let retries = 0;
      const maxRetries = 3;

      while (!profile && retries < maxRetries) {
        try {
          const result: any = await withTimeout(
            supabase
              .from('profiles')
              .select('*')
              .eq('id', authUser.id)
              .single(),
            10000
          );

          if (result.error && (result.error as any).status === 406) {
            retries++;
            await new Promise(r => setTimeout(r, 300 * retries));
            continue;
          }

          profile = result.data;
          break;
        } catch (dbErr: any) {
          logger.error('Error de base de datos en fetchUser:', dbErr);
          retries++;
          if (retries >= maxRetries) throw dbErr;
          await new Promise(r => setTimeout(r, 500));
        }
      }

      if (!profile) {
        logger.warn('Perfil no encontrado, intentando auto-crear...');
        const { data: createdProfile, error: createError } = await withTimeout(
          supabase.from('profiles')
            .upsert({
              id: authUser.id,
              email: authUser.email,
              name: authUser.user_metadata?.name || '',
              business_name: authUser.user_metadata?.business_name || '',
              phone: authUser.user_metadata?.phone || '',
              role: 'user',
              subscription_status: 'trialing',
              trial_ends_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
              theme_preference: 'dark',
            })
            .select()
            .single(),
          10000
        ) as any;

        if (createError || !createdProfile) {
          logger.error('Fallo al auto-crear perfil:', createError);
          set({ isLoading: false });
          return false;
        }

        profile = createdProfile;
      }

      const subscription = {
        status: (profile?.subscription_status as any) || 'trialing',
        trialEndsAt: profile?.trial_ends_at || null,
        validUntil: profile?.valid_until ? profile.valid_until.split('T')[0] : null,
      };

      const user: User = {
        id: authUser.id,
        email: authUser.email || '',
        name: profile?.name || authUser.user_metadata?.name || '',
        businessName: profile?.business_name || '',
        role: (profile?.role as 'admin' | 'user') || 'user',
        createdAt: authUser.created_at,
        subscription,
        isSubscriptionActive: checkSubscriptionActive(profile?.role || 'user', subscription),
        generateTicket: profile?.generate_ticket ?? false,
        ticketMessage: profile?.ticket_message || '¡Gracias por su visita!',
        usdEnabled: profile?.usd_enabled ?? false,
        usdRate: profile?.usd_rate ?? 320,
        eurEnabled: profile?.eur_enabled ?? false,
        eurRate: profile?.eur_rate ?? 350,
        cupTransferEnabled: profile?.cup_transfer_enabled ?? false,
        phone: profile?.phone || '',
        address: profile?.address || '',
        businessHours: profile?.business_hours || '',
        businessCode: profile?.business_code || '',
        themePreference: (profile?.theme_preference as 'light' | 'dark') || 'dark',
      };

      logger.info('Usuario cargado', { email: user.email, role: user.role, subscriptionActive: user.isSubscriptionActive });
      
      // Guardar usuario en localStorage para persistencia de sesión
      if (typeof window !== 'undefined') {
        localStorage.setItem('inventarioy_user', JSON.stringify(user));
      }
      
      set({ user, isAuthenticated: true, isLoading: false });
      setRealtimeUserId(user.id);
      return true;
    } catch (err) {
      logger.error('Error en fetchUser:', err);
      set({ isLoading: false });
      return false;
    }
  },

  login: async (email: string, password: string) => {
    try {
      const isOnline = navigator.onLine && await checkRealInternetConnection();
      if (!isOnline) {
        return { success: false, error: 'Sin conexión a internet. Inicia sesión cuando tengas internet.' };
      }

      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (error) {
        return { success: false, error: translateError(error.message ?? String(error)) };
      }

      if (data.user) {
        localStorage.setItem('saved_email', email);

        const userLoaded = await get().fetchUser();
        if (!userLoaded) {
          localStorage.removeItem('saved_email');
          return { success: false, error: 'Error al cargar los datos del usuario. Intente de nuevo.' };
        }
        return { success: true };
      }

      return { success: false, error: 'Error desconocido al iniciar sesión' };
    } catch (err) {
      logger.error('Error inesperado en login:', err);
      return { success: false, error: 'Sin conexión a internet. Verifique su red e intente de nuevo.' };
    }
  },

  register: async (email: string, password: string, name: string, businessName: string, phone?: string) => {
    try {
      const isOnline = navigator.onLine && await checkRealInternetConnection();
      if (!isOnline) {
        return { success: false, error: 'Sin conexión a internet. Intente cuando tenga internet.' };
      }

      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: {
            name,
            business_name: businessName,
            phone: phone || '',
          },
        },
      });

      if (error) {
        return { success: false, error: translateError(error.message ?? String(error)) };
      }

      if (data?.user) {
        const { error: profileError } = await supabase.from('profiles').upsert({
          id: data.user.id,
          email,
          name,
          business_name: businessName,
          phone: phone || '',
          role: 'user',
          subscription_status: 'trialing',
          trial_ends_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
          theme_preference: 'dark',
        });

        if (profileError) {
          logger.error('Error al crear perfil en registro:', profileError);
          return { success: false, error: 'Error al crear el perfil. Intente de nuevo.' };
        }

        return { success: true };
      }

      return { success: false, error: 'Error desconocido al registrar' };
    } catch (err) {
      logger.error('Error inesperado en register:', err);
      return { success: false, error: 'Sin conexión a internet. Verifique su red e intente de nuevo.' };
    }
  },

  forgotPassword: async (email: string) => {
    try {
      const isOnline = navigator.onLine && await checkRealInternetConnection();
      if (!isOnline) {
        return { success: false, error: 'Sin conexión a internet. Intente cuando tenga internet.' };
      }

      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/reset-password`,
      });

      if (error) {
        return { success: false, error: translateError(error.message ?? String(error)) };
      }

      return { success: true };
    } catch (err) {
      logger.error('Error inesperado en forgotPassword:', err);
      return { success: false, error: 'Sin conexión a internet. Verifique su red e intente de nuevo.' };
    }
  },

  logout: async () => {
    logger.info('Logout llamado...');
    syncEngine.stop();
    setRealtimeUserId(null);
    try {
      // Código SQLite eliminado

      localStorage.removeItem('saved_email');
      localStorage.removeItem('inventarioy_user');

      _isInitializing = false;
      _authListenerSubscription = null;
      set({ user: null, isAuthenticated: false, isLoading: false });
      logger.info('Estado limpiado');

      // Resetear Zustand store de base de datos para evitar que datos del usuario anterior
      // queden en memoria y se filtren al siguiente login
      useDatabaseStore.setState({
        products: [],
        movements: [],
        sales: [],
        recipes: [],
        employees: [],
        employeeDocuments: [],
        categories: [],
        transitItems: [],
        dailyClosings: [],
        hrDocuments: [],
        departments: [],
        payrollConfig: null,
        payrollEntries: [],
        employeeLoans: [],
        payrollPeriods: [],
        payrollDrafts: [],
        payrollLiquidations: [],
        vacationMovements: [],
        accessPins: [],
        actionLogs: [],
        warehouses: [],
        productWarehouse: [],
        currentWarehouseId: null,
        pendingAccounts: [],
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
        syncQueueCount: 0,
        syncStatus: 'idle',
        syncProgress: null,
        isLoading: true,
      });
      logger.info('Zustand dbStore reseteado');

      await supabase.auth.signOut();
      logger.info('SignOut exitoso');

      try {
        await clearLocalData();
        logger.info('IndexedDB limpiado');
      } catch (dbErr) {
        logger.warn('Error limpiando IndexedDB:', dbErr);
      }
    } catch (err) {
      logger.error('Error en logout:', err);
    } finally {
      // Reactivar el motor de sincronización para el próximo usuario
      syncEngine.start();
      // Forzar redirección
      logger.info('Redireccionando...');
      window.location.href = '/';
    }
  },

  updateSubscription: async (updates) => {
    const { user } = get();
    if (!user) return;

    const newSubscription = { ...user.subscription, ...updates };
    
    await supabase
      .from('profiles')
      .update({ 
        subscription_status: newSubscription.status,
        valid_until: newSubscription.validUntil,
      })
      .eq('id', user.id);

    set({
      user: { ...user, subscription: newSubscription },
    });
  },
}));
