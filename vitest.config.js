import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.js'],
    // Appen används i Stockholm, och köberäkningen läser lokal tid: nightKey() drar bort
    // 6 timmar för att en fredag 00:30 ska höra till fredagskvällen, och closingHour()
    // jämför mot lokala klockslag. Körs testerna i UTC hamnar nattgränsen fel.
    env: { TZ: 'Europe/Stockholm' }
  }
});
