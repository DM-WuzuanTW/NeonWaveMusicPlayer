const fs = require('fs');
const path = require('path');

const packageJsonPath = path.resolve(__dirname, '../package.json');
const packageLockPath = path.resolve(__dirname, '../package-lock.json');

let fileContent;
try {
    fileContent = fs.readFileSync(packageJsonPath, 'utf8');
    JSON.parse(fileContent);
} catch (parseErr) {
    console.warn('[Warning] package.json is corrupted or invalid. Attempting to auto-restore from Git...');
    try {
        const { execSync } = require('child_process');
        execSync('git restore package.json', { cwd: path.resolve(__dirname, '..') });
        fileContent = fs.readFileSync(packageJsonPath, 'utf8');
    } catch (restoreErr) {
        console.error('[Error] Failed to auto-restore package.json from Git:', restoreErr.message);
        process.exit(1);
    }
}

try {
    const packageJson = JSON.parse(fileContent);
    const version = packageJson.version;

    if (!version) {
        console.error('Error: No version found in package.json');
        process.exit(1);
    }

    const parts = version.split('.').map(Number);
    if (parts.length !== 3) {
        console.error(`Error: Version ${version} is not in m.n.p format`);
        process.exit(1);
    }

    let [major, minor, patch] = parts;

    
    
    patch += 1;

    
    if (patch > 9) {
        patch = 0;
        minor += 1;
    }

    
    if (minor > 9) {
        minor = 0;
        major += 1;
    }

    const newVersion = `${major}.${minor}.${patch}`;

    packageJson.version = newVersion;
    fs.writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2) + '\n');

    if (fs.existsSync(packageLockPath)) {
        const packageLock = JSON.parse(fs.readFileSync(packageLockPath, 'utf8'));
        packageLock.version = newVersion;
        if (packageLock.packages?.['']) {
            packageLock.packages[''].version = newVersion;
        }
        fs.writeFileSync(packageLockPath, JSON.stringify(packageLock, null, 2) + '\n');
    }

    console.log(newVersion);

} catch (err) {
    console.error('Error updating version:', err);
    process.exit(1);
}
