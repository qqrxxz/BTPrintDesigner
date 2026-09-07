/**
 * Signs the packaged app ad-hoc.
 *
 * Apple Silicon refuses to run an unsigned binary at all, and electron-builder
 * skips signing when there is no certificate. An ad-hoc signature costs
 * nothing, needs no account, and is enough to make the app launchable; it is
 * not notarisation, so the first open still goes through the Finder's
 * right-click Open.
 */
const { execFileSync } = require('node:child_process');
const { join } = require('node:path');

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return;

  const app = join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', app], { stdio: 'inherit' });
  console.log(`  • ad-hoc signed ${app}`);
};
