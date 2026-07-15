// electron-builder afterPack hook.
//
// macOS without an Apple Developer certificate: apply a free ad-hoc
// signature (`codesign --sign -`). It cannot remove Gatekeeper warnings,
// but on Apple Silicon it downgrades the hard "app is damaged" block to
// "unidentified developer" — users can right-click → Open instead of
// needing `xattr` in a terminal.
const { execSync } = require('child_process');
const path = require('path');

exports.default = async function afterPack(context) {
    if (context.electronPlatformName !== 'darwin') return;

    // A real Developer ID certificate is configured — let electron-builder
    // handle signing, don't overwrite it.
    if (process.env.CSC_LINK || process.env.MAC_CSC_LINK) return;

    const appName = context.packager.appInfo.productFilename;
    const appPath = path.join(context.appOutDir, `${appName}.app`);

    try {
        console.log(`  • ad-hoc signing (no Apple Developer account): ${appPath}`);
        execSync(`codesign --force --deep --sign - "${appPath}"`, { stdio: 'inherit' });
        execSync(`codesign --verify --verbose "${appPath}"`, { stdio: 'inherit' });
    } catch (e) {
        console.warn('  • ad-hoc signing failed, shipping unsigned:', e.message);
    }
};
