const path = require('node:path');
(async () => {
  const { packager } = await import('@electron/packager');
  const output = await packager({ dir: path.resolve(__dirname, '..'), out: path.resolve(__dirname, '../release'),
    download: { cacheRoot: process.env.electron_config_cache || path.join(require('node:os').tmpdir(), 'powerview-electron-cache') },
    name: 'PowerView', platform: process.platform, arch: process.arch, overwrite: true, asar: true,
    icon: path.resolve(__dirname, '../assets/PowerView_big'),
    ignore: [/^\/release/, /^\/test/, /^\/docs/, /^\/\.git/, /^\/\.github/, /^\/evaluation/],
    appBundleId: 'com.example.powerview', appCategoryType: 'public.app-category.utilities' });
  console.log(output.join('\n'));
})().catch(error => { console.error(error); process.exitCode = 1; });
