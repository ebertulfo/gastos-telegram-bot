/** @type {import('tailwindcss').Config} */
export default {
    darkMode: ["class"],
    content: ["./index.html", "./src/**/*.{ts,tsx,js,jsx}"],
    theme: {
        extend: {
            fontFamily: {
                display: ['Sora', 'sans-serif'],
                mono: ['DM Mono', 'monospace'],
            },
            colors: {
                background: 'var(--background)',
                foreground: 'var(--foreground)',
                accent: {
                    DEFAULT: 'var(--accent)',
                    hover: 'var(--accent-hover)',
                },
                destructive: 'var(--destructive)',
                border: 'var(--border)',
            },
            borderRadius: {
                sm: 'var(--radius-sm)',
                md: 'var(--radius-md)',
                lg: 'var(--radius-lg)',
                xl: 'var(--radius-xl)',
                '2xl': 'var(--radius-2xl)',
            },
        }
    },
    plugins: [require("tailwindcss-animate")],
}
