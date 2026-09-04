import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        canvas: "#FAF8F3",
        ink: "#211F1B",
        forest: {
          DEFAULT: "#2F4B3C",
          light: "#3E5F4C",
          dark: "#213526",
        },
        clay: "#B5654A",
        sand: "#E8E1D3",
        line: "#DCD5C4",
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "sans-serif"],
      },
      borderRadius: {
        sm: "4px",
        DEFAULT: "6px",
        lg: "10px",
      },
    },
  },
  plugins: [],
};
export default config;
