import { useState, useMemo, useEffect } from 'react';
import { Search, Calendar, FileText, ChevronLeft, ChevronRight, X } from 'lucide-react';
import { Input } from '../../components/ui/input';
import { Button } from '../../components/ui/button';
import { useDatabaseStore, ROLE_LABELS } from '../../store/dbStore';
import { usePersistentFilters } from '../../lib/hooks/usePersistentFilters';
import { MODULE_LABELS, ACTION_LABELS, DETAIL_KEY_TRANSLATIONS } from '../../lib/constants';

interface ActionLog {
  id: string;
  role: string;
  pin_role_label: string;
  module: string;
  action: string;
  details: Record<string, any>;
  created_at: string;
}

const MODULE_TRANSLATIONS: Record<string, string> = {
  sales: 'Ventas',
  inventory: 'Inventario',
  movements: 'Movimientos',
  transit: 'Tránsito',
  recipes: 'Recetas',
  consumption: 'Consumo',
  closings: 'Cierres',
  charts: 'Gráficos',
  analysis: 'Análisis',
  filtered: 'Centro Filtrado',
  hr: 'RR.HH.',
  settings: 'Configuración',
  payroll: 'Nómina',
  stock: 'Stock',
  accounts: 'Cuentas por Cobrar',
  closing: 'Cierre Diario',
  sync: 'Sincronización',
};

const MODULE_ICONS: Record<string, string> = {
  sales: '🛒',
  inventory: '📦',
  movements: '📋',
  transit: '🚚',
  recipes: '👨‍🍳',
  consumption: '📈',
  closings: '💰',
  charts: '📊',
  analysis: '🔍',
  filtered: '🔎',
  hr: '👥',
  ai: '🤖',
  settings: '⚙️',
  stock: '📉',
  accounts: '📋',
  closing: '💰',
  sync: '🔄',
  payroll: '💵',
};

const ACTION_COLORS: Record<string, string> = {
  CREAR: 'bg-surface-hover border-l-4 border-l-green-500 text-green-700',
  MODIFICAR: 'bg-surface-hover border-l-4 border-l-blue-500 text-blue-700',
  ELIMINAR: 'bg-surface-hover border-l-4 border-l-red-500 text-red-700',
  VENTA: 'bg-surface-hover border-l-4 border-l-purple-500 text-purple-700',
  COBRO: 'bg-surface-hover border-l-4 border-l-yellow-500 text-yellow-700',
  ENVIO: 'bg-surface-hover border-l-4 border-l-cyan-500 text-cyan-700',
  DEVOLUCION: 'bg-surface-hover border-l-4 border-l-orange-500 text-orange-700',
  WASTE: 'bg-surface-hover border-l-4 border-l-red-500 text-red-700',
  CONFIG: 'bg-surface-hover border-l-4 border-l-gray-500 text-gray-700',
  ENTRADA: 'bg-surface-hover border-l-4 border-l-green-500 text-green-700',
  SALIDA: 'bg-surface-hover border-l-4 border-l-red-500 text-red-700',
  MERMA: 'bg-surface-hover border-l-4 border-l-orange-500 text-orange-700',
  SUBIR: 'bg-surface-hover border-l-4 border-l-blue-500 text-blue-700',
  GENERAR_NOMINA: 'bg-surface-hover border-l-4 border-l-green-500 text-green-700',
  ACTUALIZAR_NOMINA: 'bg-surface-hover border-l-4 border-l-blue-500 text-blue-700',
  APLICAR_NOMINA: 'bg-surface-hover border-l-4 border-l-green-500 text-green-700',
  REABRIR_NOMINA: 'bg-surface-hover border-l-4 border-l-amber-500 text-amber-700',
  AJUSTE: 'bg-surface-hover border-l-4 border-l-yellow-500 text-yellow-700',
  ACTUALIZAR: 'bg-surface-hover border-l-4 border-l-blue-500 text-blue-700',
  CANCELAR_TRANSITO: 'bg-surface-hover border-l-4 border-l-orange-500 text-orange-700',
  MERMA_TRANSITO: 'bg-surface-hover border-l-4 border-l-red-500 text-red-700',
  CONSUMO_MANUAL: 'bg-surface-hover border-l-4 border-l-amber-500 text-amber-700',
  COBRAR: 'bg-surface-hover border-l-4 border-l-green-500 text-green-700',
  MARCAR_PAGADO: 'bg-surface-hover border-l-4 border-l-teal-500 text-teal-700',
  CANCELAR_CUENTA: 'bg-surface-hover border-l-4 border-l-red-500 text-red-700',
  EDITAR_PARAMETROS: 'bg-surface-hover border-l-4 border-l-gray-500 text-gray-700',
  AGREGAR_ITEMS: 'bg-surface-hover border-l-4 border-l-blue-500 text-blue-700',
  ACTUALIZAR_ITEMS: 'bg-surface-hover border-l-4 border-l-cyan-500 text-cyan-700',
  TOGGLE_TIPO: 'bg-surface-hover border-l-4 border-l-purple-500 text-purple-700',
  COMPENSAR: 'bg-surface-hover border-l-4 border-l-amber-500 text-amber-700',
  JUSTIFICAR: 'bg-surface-hover border-l-4 border-l-teal-500 text-teal-700',
};

const ACTION_TRANSLATIONS: Record<string, string> = {
  CREAR: 'Crear',
  MODIFICAR: 'Modificar',
  ELIMINAR: 'Eliminar',
  VENTA: 'Venta registrada',
  COBRO: 'Cobro de cuenta',
  ENVIO: 'Envío a producción',
  DEVOLUCION: 'Devolución a inventario',
  WASTE: 'Merma desperdiciada',
  CONFIG: 'Cambio de configuración',
  ENTRADA: 'Entrada de producto',
  SALIDA: 'Salida de producto',
  MERMA: 'Merma de producto',
  SUBIR: 'Documento subido',
  GENERAR_NOMINA: 'Nómina generada',
  ACTUALIZAR_NOMINA: 'Nómina actualizada',
  APLICAR_NOMINA: 'Nómina aplicada',
  REABRIR_NOMINA: 'Nómina reabierta',
  AJUSTE: 'Ajuste de inventario',
  ACTUALIZAR: 'Actualizar',
  CANCELAR_TRANSITO: 'Cancelar tránsito',
  MERMA_TRANSITO: 'Merma en tránsito',
  CONSUMO_MANUAL: 'Consumo manual',
  COBRAR: 'Cobrar cuenta',
  MARCAR_PAGADO: 'Marcar como pagada',
  CANCELAR_CUENTA: 'Cancelar cuenta',
  EDITAR_PARAMETROS: 'Editar parámetros',
  AGREGAR_ITEMS: 'Agregar ítems',
  ACTUALIZAR_ITEMS: 'Actualizar ítems',
  TOGGLE_TIPO: 'Cambiar tipo',
  COMPENSAR: 'Compensar',
  JUSTIFICAR: 'Justificar',
};

export default function ActionLogsView() {
  const { actionLogs, accessPins, getActionLogs, fetchMore } = useDatabaseStore();
  const { filters, setFilters, resetFilters } = usePersistentFilters<{
    searchTerm: string;
    roleFilter: string;
    startDate: string;
    endDate: string;
    currentPage: number;
  }>('actionLogs', { searchTerm: '', roleFilter: '', startDate: '', endDate: '', currentPage: 1 });
  const { searchTerm, roleFilter, startDate, endDate, currentPage } = filters;
  const setSearchTerm = (v: string) => setFilters({ searchTerm: v });
  const setRoleFilter = (v: string) => setFilters({ roleFilter: v });
  const setStartDate = (v: string) => setFilters({ startDate: v });
  const setEndDate = (v: string) => setFilters({ endDate: v });
  const setCurrentPage = (v: number | ((p: number) => number)) => setFilters(prev => ({ ...prev, currentPage: typeof v === 'function' ? v(prev.currentPage) : v }));
  const [hasMoreLogs, setHasMoreLogs] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const itemsPerPage = 15;

  useEffect(() => {
    try {
      getActionLogs();
    } catch (err) {
      console.error('[ActionLogsView] Error loading logs:', err);
    }
  }, []);

  const clearFilters = () => {
    resetFilters();
  };

  const uniqueRoles = useMemo(() => {
    const pins = accessPins || [];
    const roles = pins.map(pin => ROLE_LABELS[pin.role] || pin.role).filter(Boolean);
    return Array.from(new Set(roles)).sort();
  }, [accessPins]);

  const filteredLogs = useMemo(() => {
    const logs = actionLogs || [];
    return logs.filter((log: ActionLog) => {
      const matchesSearch = !searchTerm || 
        log.action.toLowerCase().includes(searchTerm.toLowerCase()) ||
        log.module.toLowerCase().includes(searchTerm.toLowerCase()) ||
        log.pin_role_label.toLowerCase().includes(searchTerm.toLowerCase()) ||
        (log.details?.product_name || '').toLowerCase().includes(searchTerm.toLowerCase());
      
      const matchesRole = !roleFilter || (accessPins || []).some(pin => 
        ROLE_LABELS[pin.role] === roleFilter && pin.role === log.role
      );
      
      const logDate = new Date(log.created_at);
      const start = startDate ? new Date(startDate + 'T00:00:00') : null;
      const end = endDate ? new Date(endDate + 'T23:59:59') : null;
      const matchesStartDate = !start || logDate >= start;
      const matchesEndDate = !end || logDate <= end;

      return matchesSearch && matchesRole && matchesStartDate && matchesEndDate;
    });
  }, [actionLogs, searchTerm, roleFilter, startDate, endDate, accessPins]);

  useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm, roleFilter, startDate, endDate]);

  const totalPages = Math.ceil(filteredLogs.length / itemsPerPage);
  const startIndex = (currentPage - 1) * itemsPerPage;
  const endIndex = startIndex + itemsPerPage;
  const paginatedLogs = filteredLogs.slice(startIndex, endIndex);

  const formatDate = (dateStr: string) => {
    if (!dateStr) return '-';
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return '-';
    return date.toLocaleString('es-CO', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    });
  };

  const formatDetails = (details: Record<string, any>, _module: string, _action: string) => {
    if (!details || Object.keys(details).length === 0) return '-';
    
    const formatValue = (value: any, key?: string): string => {
      if (typeof value === 'boolean') {
        return value ? 'Sí' : 'No';
      }

      let numericValue: number | null = null;
      if (typeof value === 'number' && !isNaN(value)) {
        numericValue = value;
      } else if (typeof value === 'string') {
        const trimmed = value.trim();
        if (/^\d+([.,]\d+)?$/.test(trimmed) && !isNaN(Number(trimmed.replace(',', '.')))) {
          numericValue = Number(trimmed.replace(',', '.'));
        }
      }

      if (numericValue !== null) {
        if (key === 'year') return Math.round(numericValue).toString();
        if (key === 'month') {
          const monthNames = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
                              'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
          return monthNames[Math.round(numericValue) - 1] || Math.round(numericValue).toString();
        }
        return String(numericValue);
      }

      return String(value);
    };
    
    const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const entries = Object.entries(details)
      .filter(([_, value]) => typeof value === 'string' ? !uuidPattern.test(value) : true);
    if (entries.length === 0) return '(IDs ocultos)';
    return entries.map(([key, value]) => {
      const displayKey = DETAIL_KEY_TRANSLATIONS[key] || key.replace(/_/g, ' ');
      return `${displayKey}: ${formatValue(value, key)}`;
    }).join(', ');
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-text flex items-center gap-2">
          <FileText className="h-6 w-6 text-primary" />
          Registro de Acciones
        </h1>
        <p className="text-sm text-text-secondary">
          Historial de acciones realizadas por cada rol en el sistema
        </p>
      </div>

      <div className="flex flex-col sm:flex-row gap-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-secondary" />
          <Input
            placeholder="Buscar por acción, módulo o rol..."
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            className="pl-9"
          />
        </div>

        <select
          value={roleFilter}
          onChange={e => setRoleFilter(e.target.value)}
          className="rounded-lg border border-border bg-bg px-3 py-2 text-sm text-text focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
        >
          <option value="">Todos los roles</option>
          {uniqueRoles.map(role => (
            <option key={role} value={role}>{role}</option>
          ))}
        </select>

        <div className="flex items-center gap-2">
          <span className="text-sm text-text-secondary">Desde:</span>
          <Input
            type="date"
            value={startDate}
            onChange={e => setStartDate(e.target.value)}
            className="w-auto"
          />
        </div>

        <div className="flex items-center gap-2">
          <span className="text-sm text-text-secondary">Hasta:</span>
          <Input
            type="date"
            value={endDate}
            onChange={e => setEndDate(e.target.value)}
            className="w-auto"
          />
        </div>

        {(searchTerm || roleFilter || startDate || endDate) && (
          <Button
            variant="outline"
            size="sm"
            onClick={clearFilters}
            className="text-xs"
          >
            Limpiar filtros
          </Button>
        )}
      </div>

      <div className="rounded-xl border border-border bg-surface overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="border-b border-border bg-bg/50 text-xs uppercase text-text-secondary">
              <tr>
                <th className="px-4 py-3 font-medium text-left">Fecha/Hora</th>
                <th className="px-4 py-3 font-medium text-left">Rol</th>
                <th className="px-4 py-3 font-medium text-left">Módulo</th>
                <th className="px-4 py-3 font-medium text-left">Acción</th>
                <th className="px-4 py-3 font-medium text-left">Detalles</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
{paginatedLogs.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-12 text-center text-text-secondary">
                  No se encontraron registros de acciones.
                </td>
              </tr>
            ) : (
              paginatedLogs.map(log => (
                  <tr key={log.id} className="hover:bg-surface-hover transition-colors">
                    <td className="px-4 py-3 text-sm text-text-secondary whitespace-nowrap">
                      {formatDate(log.created_at)}
                    </td>
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center rounded-full bg-primary/10 px-2 py-1 text-xs font-medium text-primary">
                        {log.pin_role_label || log.role}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-sm">
                        {MODULE_TRANSLATIONS[log.module] || log.module}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center rounded-full px-2 py-1 text-xs font-medium ${ACTION_COLORS[log.action] || 'bg-gray-100 text-gray-800'}`}>
                        {ACTION_TRANSLATIONS[log.action] || log.action}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm text-text-secondary" title={formatDetails(log.details, log.module, log.action)}>
                      {formatDetails(log.details, log.module, log.action)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>

          {hasMoreLogs && (
            <div className="flex justify-center py-4">
              <Button
                variant="outline"
                onClick={async () => {
                  setLoadingMore(true);
                  try {
                    const result = await fetchMore(50);
                    setHasMoreLogs(result.hasMore);
                  } catch (error) {
                    console.error('Error loading more logs:', error);
                  } finally {
                    setLoadingMore(false);
                  }
                }}
                disabled={loadingMore}
              >
                {loadingMore ? 'Cargando...' : 'Ver más registros'}
              </Button>
            </div>
          )}
        </div>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between py-4 px-4 border-t border-border">
          <div className="text-sm text-text-secondary">
            Mostrando {startIndex + 1}-{Math.min(endIndex, filteredLogs.length)} de {filteredLogs.length} registros
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
              disabled={currentPage === 1}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="text-sm text-text-secondary px-2">
              Página {currentPage} de {totalPages}
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
              disabled={currentPage === totalPages}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}