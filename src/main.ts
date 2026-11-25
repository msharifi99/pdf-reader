import { mount } from 'svelte';
import App from './App.svelte';
import { initCore } from './lib/core/core';

await initCore();
mount(App, { target: document.getElementById('app')! });
