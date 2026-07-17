import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    // Node, not jsdom: these suites cover the money and permission logic, which is
    // pure. The one place that touches a browser global (pdfGenerator calls
    // window.open) stubs it itself, so jsdom would cost startup time and buy nothing.
    environment: 'node',
    include: ['src/**/*.test.js'],
  },
});
