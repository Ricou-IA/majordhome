/** @type {import('tailwindcss').Config} */
export default {
    content: [
      "./index.html",
      "./src/**/*.{js,ts,jsx,tsx}",
    ],
    theme: {
      extend: {
        colors: {
          // Couleurs principales Majord'home
          primary: {
            50: '#f0f9ff',
            100: '#e0f2fe',
            200: '#bae6fd',
            300: '#7dd3fc',
            400: '#38bdf8',
            500: '#0ea5e9',
            600: '#0284c7',
            700: '#0369a1',
            800: '#075985',
            900: '#0c4a6e',
            950: '#082f49',
          },
          // Couleurs secondaires
          secondary: {
            50: '#f8fafc',
            100: '#f1f5f9',
            200: '#e2e8f0',
            300: '#cbd5e1',
            400: '#94a3b8',
            500: '#64748b',
            600: '#475569',
            700: '#334155',
            800: '#1e293b',
            900: '#0f172a',
            950: '#020617',
          },
          // Couleurs statuts pipeline
          status: {
            lead: '#f59e0b',           // Amber - Lead
            prospect: '#3b82f6',       // Blue - Prospect
            quote: '#8b5cf6',          // Violet - Devis
            accepted: '#10b981',       // Emerald - Accepté
            progress: '#06b6d4',       // Cyan - En cours
            completed: '#22c55e',      // Green - Terminé
            invoiced: '#6366f1',       // Indigo - Facturé
            paid: '#14b8a6',           // Teal - Payé
            lost: '#ef4444',           // Red - Perdu
          },
          // Couleurs événements planning
          event: {
            rdv_agency: '#f59e0b',     // Amber - RDV Agence
            rdv_technical: '#3b82f6',  // Blue - RDV Technique
            installation: '#8b5cf6',   // Violet - Installation
            maintenance: '#10b981',    // Emerald - Entretien
            service: '#ef4444',        // Red - SAV
          },
        },
        fontFamily: {
          sans: ['Inter', 'system-ui', 'sans-serif'],
          mono: ['JetBrains Mono', 'monospace'],
        },
        boxShadow: {
          'card': '0 1px 3px 0 rgb(0 0 0 / 0.1), 0 1px 2px -1px rgb(0 0 0 / 0.1)',
          'card-hover': '0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)',
          'modal': '0 25px 50px -12px rgb(0 0 0 / 0.25)',
        },
        animation: {
          'fade-in': 'fadeIn 0.2s ease-out',
          'slide-up': 'slideUp 0.3s ease-out',
          'slide-down': 'slideDown 0.3s ease-out',
        },
        keyframes: {
          fadeIn: {
            '0%': { opacity: '0' },
            '100%': { opacity: '1' },
          },
          slideUp: {
            '0%': { opacity: '0', transform: 'translateY(10px)' },
            '100%': { opacity: '1', transform: 'translateY(0)' },
          },
          slideDown: {
            '0%': { opacity: '0', transform: 'translateY(-10px)' },
            '100%': { opacity: '1', transform: 'translateY(0)' },
          },
        },
      },
    },
    plugins: [],
  };
  