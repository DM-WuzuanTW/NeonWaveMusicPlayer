// Remove build output dirs before building.
// dist-electron accumulates hashed chunks across builds (the electron plugin
// does not empty it), and electron-builder packs the whole directory —
// stale chunks bloat the installer if not cleaned.
const fs = require('fs');
const path = require('path');

for (const dir of ['dist', 'dist-electron']) {
    const full = path.resolve(__dirname, '..', dir);
    fs.rmSync(full, { recursive: true, force: true });
    console.log(`[clean] removed ${dir}`);
}
