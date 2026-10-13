const { execFileSync } = require('node:child_process');
const path = require('node:path');

// Use the registry-installed resource editor before NSIS captures the application.
module.exports = async function applyWindowsResources(context) {
  if (context.electronPlatformName !== 'win32') return;
  const projectDir = context.packager.projectDir;
  const editor = path.join(projectDir, 'node_modules/electron-winstaller/vendor/rcedit.exe');
  const executable = path.relative(projectDir, path.join(context.appOutDir, 'luckyx. Studio.exe'));
  execFileSync(editor, [executable, '--set-icon', 'build/icon.ico',
    '--set-version-string', 'ProductName', 'luckyx. Studio',
    '--set-version-string', 'FileDescription', 'luckyx. Studio',
    '--set-file-version', context.packager.appInfo.version,
    '--set-product-version', context.packager.appInfo.version], { cwd: projectDir });
};
