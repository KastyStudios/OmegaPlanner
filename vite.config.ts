import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// GitHub Pages serves the app from /<repo>/; the deploy workflow sets BASE_PATH.
const base = process.env.BASE_PATH ?? '/';

/*
 * Content Security Policy for the built app (the dev server needs inline scripts, so build only).
 * Scripts may only come from the app itself; network access only to the app and Dropbox's API.
 * Inline styles stay allowed: FullCalendar injects its CSS and React sets style attributes.
 */
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self' data:",
  "connect-src 'self' https://api.dropboxapi.com https://content.dropboxapi.com",
  "worker-src 'self'",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ');

const contentSecurityPolicy = (): Plugin => ({
  name: 'omegaplanner-csp',
  apply: 'build',
  transformIndexHtml: () => [
    { tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content: CSP }, injectTo: 'head-prepend' },
    { tag: 'meta', attrs: { name: 'referrer', content: 'no-referrer' }, injectTo: 'head-prepend' },
  ],
  // Cloudflare Pages reads _headers and sends these as real HTTP headers, which also allows
  // frame-ancestors (ignored in a meta tag). Other hosts just serve it as a file.
  generateBundle() {
    this.emitFile({
      type: 'asset',
      fileName: '_headers',
      source: [
        '/*',
        `  Content-Security-Policy: ${CSP}; frame-ancestors 'none'`,
        '  X-Content-Type-Options: nosniff',
        '  Referrer-Policy: no-referrer',
        '  Permissions-Policy: camera=(), microphone=(), geolocation=()',
        '/assets/*',
        '  Cache-Control: public, max-age=31536000, immutable',
        '/sw.js',
        '  Cache-Control: no-cache',
        '',
      ].join('\n'),
    });
  },
});

export default defineConfig({
  base,
  plugins: [
    react(),
    contentSecurityPolicy(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'OmegaPlanner',
        short_name: 'OmegaPlanner',
        description: 'Plan tasks, events, deadlines and goals.',
        lang: 'en',
        theme_color: '#F4F5F1',
        background_color: '#F4F5F1',
        display: 'standalone',
        start_url: base,
        scope: base,
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        navigateFallback: `${base}index.html`,
        // Never cache Dropbox traffic.
        navigateFallbackDenylist: [/^\/oauth2/],
      },
    }),
  ],
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
