// Dev-only entry: http://localhost:1420/src/lib/ui/gallery.html?theme=dark
import { mount } from 'svelte';
import '../design/tokens.css';
import Gallery from './Gallery.svelte';

mount(Gallery, { target: document.getElementById('gallery')! });
