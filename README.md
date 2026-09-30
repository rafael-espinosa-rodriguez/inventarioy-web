# Inventarioy Web

**Gestor de inventario web con sincronización en la nube y modo offline**

Una aplicación web construida con TypeScript que permite gestionar inventarios desde cualquier navegador. Está equipada con Supabase para sincronización en la nube y PWA con IndexedDB (Dexie.js) para funcionamiento offline.

## Características

- 🌐 **Acceso desde el navegador** - Funciona en cualquier dispositivo con navegador
- ☁️ **Sincronización en la nube** - Supabase para persistencia y sincronización
- 📱 **PWA Offline-ready** - Funciona sin conexión gracias a IndexedDB (Dexie.js)
- 🔄 **Sincronización automática** - Sincroniza datos cuando recupera conexión
- ⚡ **Aplicación web progresiva** - Instalable como app en dispositivos

### Funcionalidades de Gestión

- **Stock Actual**: Control de inventario en tiempo real
- **Inventario**: Gestión de productos y movimientos
- **Movimientos (Kárdex)**: Historial completo de entradas y salidas
- **Tráfico**: Seguimiento de productos en tránsito
- **Ventas**: Punto de venta con soporte para recetas
- **Cierres de Caja**: Control diario de ventas
- **Recetas**: Gestión de recetas con ingredientes
- **Análisis**: Reportes y estadísticas

## Comparación con Inventarioy Desktop

| Característica | Web | Desktop |
|---|---|---|
| Conexión requerida | ✅ Sí (con PWA offline) | ❌ No |
| Base de datos | Supabase | SQLite |
| Tecnología offline | PWA + IndexedDB (Dexie.js) | Nativa |
| Instalación | Navegador | Desktop app |

## Stack Tecnológico

- **Frontend**: Frontend**: React 19 + TypeScript + Vite
- **Database**: Supabase
- **Offline Storage**: IndexedDB (Dexie.js)
- **PWA**: Service Workers
- **Styling**: Tailwind CSS

## Inicio Rápido

```bash
npm install
npm run dev
```

**Aplicación en vivo**: [inventarioy.vercel.app](https://inventarioy.vercel.app/)

## Variables de Entorno

Las variables de entorno están configuradas en Vercel para producción.

---

**Nota**: Si buscas una versión completamente offline sin requerimientos de conexión, consulta [inventarioy-desktop](https://github.com/Rafael6357/inventarioy-desktop)
