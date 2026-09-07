import { App } from './app.js';
import './styles.css';

const root = document.querySelector<HTMLElement>('#app');
if (root) void new App(root).start();
