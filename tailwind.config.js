/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        primary: {
          50: '#FFF3F3',
          100: '#FFE8E8',
          200: '#FFC7C7',
          300: '#FFA3A3',
          400: '#FF6B6B',
          500: '#FF4554',
          600: '#EE1515',
          700: '#CC0000',
          800: '#A30000',
          900: '#841010',
          950: '#500A0A',
        },
        pokemon: {
          red: '#EE1515',
          blue: '#3B4CCA',
          yellow: '#FFDE00',
          gold: '#B3A125',
          black: '#222224',
          white: '#F0F0F0',
          wurmple: '#A03F3B',
        },
        correct: '#47A047', // grass-type green for correct letters
        present: '#FFDE00', // pokemon yellow for present but wrong position
        absent: '#616161', // pokeball button gray for absent letters
      },
      fontFamily: {
        sans: ['Inter', 'sans-serif'],
        pokemon: ['Flexo', 'sans-serif'],
      }
    },
  },
  plugins: [],
}
