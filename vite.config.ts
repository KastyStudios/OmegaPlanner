import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          calendar: ['@fullcalendar/core', '@fullcalendar/react', '@fullcalendar/daygrid', '@fullcalendar/timegrid', '@fullcalendar/interaction', '@fullcalendar/list'],
          vendor: ['react', 'react-dom', 'react-router-dom', 'dexie', 'dexie-react-hooks', 'rrule', 'date-fns'],
        },
      },
    },
  },
});
