export const EXTENSION_API_VERSION = '1.0.0';
export const EXTENSION_POINTS = Object.freeze([
  'nodeType', 'exporter', 'taskView', 'toolbarTool', 'mapLayout', 'rightPanel'
]);

const extensionRegistry = new Map(EXTENSION_POINTS.map((point) => [point, new Map()]));

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

export function initializePlatformApis(appContext = {}) {
  const root = window.Pisi || (window.Pisi = {});
  root.version = '3.1.0-mobile';
  root.context = Object.freeze({ ...appContext });
  root.extensions = Object.freeze({
    apiVersion: EXTENSION_API_VERSION, points: EXTENSION_POINTS,
    register: registerExtension, list: listExtensions, invoke: invokeExtension
  });
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
