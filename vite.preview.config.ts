import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vite';

export default defineConfig({
  root: 'src/web-template',
  plugins: [patchRendererCoreCaniuse(), patchRendererSvelteRuntime(), svelte({ emitCss: false })],
  define: {
    SRK_SUPPORTED_VERSIONS: JSON.stringify('>=0.3.0 <=0.3.13'),
  },
  build: {
    outDir: '../../dist/.preview-template-build',
    emptyOutDir: true,
    cssCodeSplit: false,
    rollupOptions: {
      output: {
        inlineDynamicImports: true,
        manualChunks: undefined,
      },
    },
  },
});

function patchRendererCoreCaniuse() {
  const rendererCorePath = '@algoux/standard-ranklist-renderer-component-core/dist/index.js';

  return {
    name: 'patch-renderer-core-caniuse',
    enforce: 'pre' as const,
    transform(code: string, id: string) {
      if (!id.includes(rendererCorePath)) {
        return null;
      }

      let patched = code.replace('import semver from "semver";\n', '');
      patched = patched.replace(
        'function caniuse(version) {\n  return semver.satisfies(version, srkSupportedVersions);\n}',
        `function compareSrkVersion(a, b) {
  for (let index = 0; index < 3; index += 1) {
    if (a[index] > b[index]) return 1;
    if (a[index] < b[index]) return -1;
  }
  return 0;
}
function parseSrkVersion(version) {
  const match = String(version).trim().match(/^v?(\\d+)\\.(\\d+)\\.(\\d+)$/);
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
}
function caniuse(version) {
  const parsed = parseSrkVersion(version);
  return Boolean(parsed && compareSrkVersion(parsed, [0, 3, 0]) >= 0 && compareSrkVersion(parsed, [0, 3, 13]) <= 0);
}`,
      );

      return {
        code: patched,
        map: null,
      };
    },
  };
}

function patchRendererSvelteRuntime() {
  const rendererPackagePath = '@algoux/standard-ranklist-renderer-component-svelte/dist/index.js';

  return {
    name: 'patch-renderer-svelte-runtime',
    enforce: 'pre' as const,
    transform(code: string, id: string) {
      if (!id.includes(rendererPackagePath)) {
        return null;
      }

      let patched = code.replace('import { createEventDispatcher, onDestroy, tick, onMount } from "svelte";\n', '');
      patched = patched.replace(
        'function noop() {\n}',
        () => `function noop() {
}
function get_current_component() {
  if (!current_component) {
    throw new Error("Function called outside component initialization");
  }
  return current_component;
}
function onMount(fn) {
  get_current_component().$$.on_mount.push(fn);
}
function onDestroy(fn) {
  get_current_component().$$.on_destroy.push(fn);
}
function custom_event(type, detail, { bubbles = false, cancelable = false } = {}) {
  const event = document.createEvent("CustomEvent");
  event.initCustomEvent(type, bubbles, cancelable, detail);
  return event;
}
function createEventDispatcher() {
  const component = get_current_component();
  return (type, detail, { cancelable = false } = {}) => {
    const callbacks = component.$$.callbacks[type];
    if (callbacks) {
      const event = custom_event(type, detail, { cancelable });
      callbacks.slice().forEach((fn) => {
        fn.call(component, event);
      });
      return !event.defaultPrevented;
    }
    return true;
  };
}
function tick() {
  schedule_update();
  return resolved_promise;
}`,
      );
      patched = patched.replace(
        'root: options.target || parent_component.$$.root',
        () => 'root: options.target || (parent_component ? parent_component.$$.root : document)',
      );

      return {
        code: patched,
        map: null,
      };
    },
  };
}
