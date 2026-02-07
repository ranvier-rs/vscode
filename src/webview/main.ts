import './app.css';
import '@xyflow/svelte/dist/style.css';
import App from './App.svelte';

const app = new App({
  target: document.getElementById('app')!
});

export default app;
