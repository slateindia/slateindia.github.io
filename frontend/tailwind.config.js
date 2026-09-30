/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: { extend: { colors: { ink: "#1f2430", muted: "#5b6472", line: "#dfe3e8", paper: "#f7f8fa", accent: "#3b4a8c" } } },
  plugins: [],
};
