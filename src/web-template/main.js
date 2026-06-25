import App from './App.svelte';

const app = new App({
  target: document.getElementById('app'),
  props: {
    initialData: window.__SRK_PREVIEW_INIT__,
  },
});

export default app;
