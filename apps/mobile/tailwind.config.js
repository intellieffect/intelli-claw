/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: "class",
  content: [
    "./app/**/*.{js,jsx,ts,tsx}",
    "./src/**/*.{js,jsx,ts,tsx}",
  ],
  presets: [require("nativewind/preset")],
  theme: {
    extend: {
      colors: {
        border: "hsl(0, 0%, 13%)",
        input: "hsl(0, 0%, 13%)",
        ring: "hsl(18, 100%, 56%)",
        background: "hsl(0, 0%, 4%)",
        foreground: "hsl(0, 0%, 98%)",
        primary: {
          DEFAULT: "hsl(18, 100%, 56%)",
          foreground: "hsl(0, 0%, 4%)",
        },
        secondary: {
          DEFAULT: "hsl(0, 0%, 12%)",
          foreground: "hsl(0, 0%, 98%)",
        },
        destructive: {
          DEFAULT: "hsl(0, 84%, 60%)",
          foreground: "hsl(0, 0%, 98%)",
        },
        muted: {
          DEFAULT: "hsl(0, 0%, 12%)",
          foreground: "hsl(0, 0%, 45%)",
        },
        accent: {
          DEFAULT: "hsl(18, 100%, 56%)",
          foreground: "hsl(0, 0%, 4%)",
        },
        card: {
          DEFAULT: "hsl(0, 0%, 8%)",
          foreground: "hsl(0, 0%, 98%)",
        },
        popover: {
          DEFAULT: "hsl(0, 0%, 8%)",
          foreground: "hsl(0, 0%, 98%)",
        },
        success: {
          DEFAULT: "hsl(160, 84%, 39%)",
          foreground: "hsl(0, 0%, 98%)",
        },
        warning: {
          DEFAULT: "hsl(38, 92%, 50%)",
          foreground: "hsl(0, 0%, 4%)",
        },
        info: {
          DEFAULT: "hsl(217, 91%, 60%)",
          foreground: "hsl(0, 0%, 98%)",
        },
      },
      borderRadius: {
        lg: 12,
        md: 10,
        sm: 8,
      },
    },
  },
  plugins: [],
};
