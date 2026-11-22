import tailwindcssAnimate from 'tailwindcss-animate';

/** @type {import('tailwindcss').Config} */
export default {
    content: [
      "./index.html",
      "./src/**/*.{js,ts,jsx,tsx}",
    ],
    theme: {
      extend: {
        colors: {
          // Tokens sémantiques shadcn/ui (CSS variables)
          background: 'hsl(var(--background))',
          foreground: 'hsl(var(--foreground))',
          card: {
            DEFAULT: 'hsl(var(--card))',
            foreground: 'hsl(var(--card-foreground))',
          },
          popover: {
            DEFAULT: 'hsl(var(--popover))',
            foreground: 'hsl(var(--popover-foreground))',
          },
          muted: {
            DEFAULT: 'hsl(var(--muted))',
            foreground: 'hsl(var(--muted-foreground))',
          },
          accent: {
            DEFAULT: 'hsl(var(--accent))',
            foreground: 'hsl(var(--accent-foreground))',
          },
          destructive: {
            DEFAULT: 'hsl(var(--destructive))',
            foreground: 'hsl(var(--destructive-foreground))',
          },
          border: 'hsl(var(--border))',
          input: 'hsl(var(--input))',
          ring: 'hsl(var(--ring))',

          // Couleurs principales Majord'home
          primary: {
            // Sans ces deux entrées, `bg-primary` / `text-primary-foreground` ne produisaient
            // aucune règle : le bouton par défaut de components/ui n'avait ni fond ni couleur de texte.
            DEFAULT: 'hsl(var(--primary))',
            foreground: 'hsl(var(--primary-foreground))',
            50: '#FDF3EE',
            100: '#F9E1D5',
            200: '#F2C2AB',
            300: '#E9A07D',
            400: '#DE8257',
            500: '#D4693C',
            600: '#C2532B',
            700: '#A0421F',
            800: '#7D3318',
            900: '#5A2410',
            950: '#3A170A',
          },
          // Couleurs secondaires
          secondary: {
            // Même raison que `primary` : le bouton secondaire de components/ui n'avait pas de fond.
            DEFAULT: 'hsl(var(--secondary))',
            foreground: 'hsl(var(--secondary-foreground))',
            25: '#FCFBF9',
            50: '#F7F5F1',
            100: '#F0EDE7',
            200: '#E8E4DC',
            300: '#DDD7CD',
            400: '#A39A8E',
            500: '#736A5F',
            600: '#5E564C',
            700: '#443E36',
            800: '#2C2823',
            900: '#1C1915',
            950: '#110F0C',
          },
          // Statuts (5 tons) et activités du planning : jamais le cuivre, qui est réservé à l'action.
          st: {
            neutre: '#6B645B', 'neutre-bg': '#F0EDE8',
            info: '#2D5BC7', 'info-bg': '#EAF0FC',
            ok: '#1E7A4C', 'ok-bg': '#E5F3EB',
            attente: '#94600C', 'attente-bg': '#FBF0DA',
            alerte: '#BE3328', 'alerte-bg': '#FCE9E6',
          },
          act: {
            pose: '#C2532B', 'pose-bg': '#FBEAE1',
            visite: '#2D5BC7', 'visite-bg': '#E8EEFB',
            entretien: '#1E7A4C', 'entretien-bg': '#E3F2E9',
            sav: '#7A4BB8', 'sav-bg': '#F0E9FA',
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
        borderColor: {
          DEFAULT: 'hsl(var(--border))',
        },
        borderRadius: {
          lg: 'var(--radius)',
          md: 'calc(var(--radius) - 2px)',
          sm: 'calc(var(--radius) - 4px)',
        },
        fontFamily: {
          display: ['"Bricolage Grotesque Variable"', 'ui-sans-serif', 'system-ui', 'sans-serif'],
          sans: ['"Figtree Variable"', 'ui-sans-serif', 'system-ui', 'sans-serif'],
          mono: ['"Geist Mono"', 'ui-monospace', 'monospace'],
        },
        // Tailles nommées de la direction artistique ; xs, sm, base… ne sont pas redéfinies.
        fontSize: {
          caption: ['12px', { lineHeight: '16px', fontWeight: '500' }],
          label: ['13px', { lineHeight: '18px', fontWeight: '600' }],
          'body-sm': ['14px', { lineHeight: '20px' }],
          cell: ['14.5px', { lineHeight: '20px' }],
          body: ['15px', { lineHeight: '22px' }],
          section: ['18px', { lineHeight: '26px', letterSpacing: '-0.012em', fontWeight: '600' }],
          count: ['20px', { lineHeight: '26px', fontWeight: '600' }],
          title: ['28px', { lineHeight: '34px', letterSpacing: '-0.022em', fontWeight: '600' }],
          kpi: ['32px', { lineHeight: '38px', letterSpacing: '-0.025em', fontWeight: '600' }],
        },
        boxShadow: {
          xs: '0 1px 2px rgba(28,25,21,.05)',
          sm: '0 1px 2px rgba(28,25,21,.04), 0 2px 6px -1px rgba(28,25,21,.06)',
          md: '0 2px 4px rgba(28,25,21,.04), 0 8px 20px -6px rgba(28,25,21,.10)',
          lg: '0 12px 32px -8px rgba(28,25,21,.18), 0 4px 8px rgba(28,25,21,.05)',
          ring: '0 0 0 3px rgba(194,83,43,.22)',
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
    plugins: [tailwindcssAnimate],
  };
  