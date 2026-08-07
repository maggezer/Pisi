import { appendTeamEvent, getSetting, listTeamEvents, setSetting } from './db.js';

export const EXTENSION_API_VERSION = '1.0.0';
export const EXTENSION_POINTS = Object.freeze([
  'nodeType', 'exporter', 'taskView', 'toolbarTool', 'mapLayout', 'rightPanel'
]);

const extensionRegistry = new Map(EXTENSION_POINTS.map((point) => [point, new Map()]));
const pluginRegistry = new Map();

function normalizeId(value) {
  const id = String(value || '').trim().toLocaleLowerCase('en-US');
  if (!/^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/.test(id)) throw new TypeError('Uzantı kimliği geçersiz.');
  return id;
}

export function registerExtension(point, descriptor = {}, owner = 'app') {
  if (!extensionRegistry.has(point)) throw new TypeError(`Bilinmeyen uzantı noktası: ${point}`);
  const id = normalizeId(descriptor.id);
  const bucket = extensionRegistry.get(point);
  if (bucket.has(id)) throw new Error(`Uzantı zaten kayıtlı: ${point}/${id}`);
  const record = Object.freeze({
    ...descriptor, id, owner, point,
    label: String(descriptor.label || id).slice(0, 120),
    apiVersion: EXTENSION_API_VERSION
  });
  bucket.set(id, record);
  document.dispatchEvent(new CustomEvent('pisi:extension-changed', { detail: { action: 'registered', point, id } }));
  return () => bucket.delete(id);
}

export function listExtensions(point) {
  if (point) return Array.from(extensionRegistry.get(point)?.values() || []);
  return Object.fromEntries(EXTENSION_POINTS.map((name) => [name, listExtensions(name)]));
}

export async function invokeExtension(point, id, context = {}) {
  const extension = extensionRegistry.get(point)?.get(normalizeId(id));
  if (!extension) throw new Error(`Uzantı bulunamadı: ${point}/${id}`);
  const handler = extension.run || extension.handler || extension.render;
  if (typeof handler !== 'function') throw new TypeError('Uzantının çalıştırılabilir işleyicisi yok.');
  return handler(Object.freeze({ ...context, extension }));
}

export async function registerPlugin(manifest = {}, activate = manifest.activate) {
  const id = normalizeId(manifest.id);
  if (pluginRegistry.has(id)) throw new Error(`Eklenti zaten etkin: ${id}`);
  if (Number(String(manifest.apiVersion || '1').split('.')[0]) !== 1) throw new Error('Uyumsuz Pisi eklenti API sürümü.');
  if (typeof activate !== 'function') throw new TypeError('Eklenti activate fonksiyonu sağlamalı.');
  const disposables = [];
  const context = Object.freeze({
    apiVersion: EXTENSION_API_VERSION,
    register(point, descriptor) {
      const dispose = registerExtension(point, descriptor, id);
      disposables.push(dispose);
      return dispose;
    },
    emit(name, detail) { document.dispatchEvent(new CustomEvent(`pisi:plugin:${name}`, { detail })); }
  });
  const deactivate = await activate(context);
  pluginRegistry.set(id, { id, name: manifest.name || id, version: manifest.version || '0.0.0', disposables, deactivate });
  return () => deactivatePlugin(id);
}

export async function deactivatePlugin(id) {
  const plugin = pluginRegistry.get(normalizeId(id));
  if (!plugin) return false;
  await plugin.deactivate?.();
  plugin.disposables.reverse().forEach((dispose) => dispose());
  pluginRegistry.delete(plugin.id);
  return true;
}

export function listPlugins() {
  return Array.from(pluginRegistry.values()).map(({ id, name, version }) => ({ id, name, version, apiVersion: EXTENSION_API_VERSION }));
}

const teamProviders = new Map();
let activeProviderId = 'local';

export function registerTeamProvider(provider = {}) {
  const id = normalizeId(provider.id);
  if (teamProviders.has(id)) throw new Error(`Team provider zaten kayıtlı: ${id}`);
  for (const method of ['getConfig', 'saveConfig', 'listEvents', 'appendEvent']) {
    if (typeof provider[method] !== 'function') throw new TypeError(`Team provider ${method} fonksiyonunu sağlamalı.`);
  }
  teamProviders.set(id, Object.freeze({ ...provider, id, label: provider.label || id, apiVersion: '1.0.0' }));
  return () => id !== 'local' && teamProviders.delete(id);
}

registerTeamProvider({
  id: 'local', label: 'Yerel',
  async getConfig() {
    return getSetting('teamConfig', { name: 'Pisi Team', revision: 0, members: [], provider: 'local' });
  },
  async saveConfig(config, options = {}) {
    const current = await this.getConfig();
    if (options.expectedRevision !== undefined && options.expectedRevision !== current.revision) {
      throw new Error('Team ayarları başka bir işlem tarafından güncellendi.');
    }
    const next = { ...current, ...config, revision: current.revision + 1, updatedAt: new Date().toISOString() };
    await setSetting('teamConfig', next);
    await appendTeamEvent({ type: 'team-config', payload: { revision: next.revision } });
    return next;
  },
  listEvents: (options = {}) => listTeamEvents(options.limit || 100),
  appendEvent: appendTeamEvent
});

export const teamApi = Object.freeze({
  version: '1.0.0',
  registerProvider: registerTeamProvider,
  listProviders: () => Array.from(teamProviders.values()).map(({ id, label, apiVersion }) => ({ id, label, apiVersion })),
  useProvider(id) {
    const normalized = normalizeId(id);
    if (!teamProviders.has(normalized)) throw new Error('Team provider bulunamadı.');
    activeProviderId = normalized;
  },
  getConfig: (...args) => teamProviders.get(activeProviderId).getConfig(...args),
  saveConfig: (...args) => teamProviders.get(activeProviderId).saveConfig(...args),
  listEvents: (...args) => teamProviders.get(activeProviderId).listEvents(...args),
  appendEvent: (...args) => teamProviders.get(activeProviderId).appendEvent(...args)
});

export function initializePlatformApis(appContext = {}) {
  const root = window.Pisi || (window.Pisi = {});
  root.version = '3.0.0-mobile';
  root.context = Object.freeze({ ...appContext });
  root.extensions = Object.freeze({
    apiVersion: EXTENSION_API_VERSION, points: EXTENSION_POINTS,
    register: registerExtension, list: listExtensions, invoke: invokeExtension,
    registerPlugin, deactivatePlugin, listPlugins
  });
  root.team = teamApi;
  return root;
}

// Güvenli, uygulama içine alınmış örnek uzantılar.
registerExtension('mapLayout', {
  id: 'radial', label: 'Radyal yerleşim',
  run({ nodes = [], center = { x: 700, y: 500 } }) {
    const radius = Math.max(220, nodes.length * 34);
    return nodes.map((node, index) => ({
      ...node,
      x: center.x + Math.cos(index / Math.max(1, nodes.length) * Math.PI * 2) * radius,
      y: center.y + Math.sin(index / Math.max(1, nodes.length) * Math.PI * 2) * radius
    }));
  }
});
