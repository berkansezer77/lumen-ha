/* Panel testlerini sırayla koştur; kırılanı say ve göster.
 *
 * Her test kendi başına da çalışır (node tests/panel/foo_test.js); bu dosya
 * yalnız hepsini bir arada koşturmak ve CI'ya tek bir çıkış kodu vermek için.
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const dizin = path.join(__dirname, 'panel');
const dosyalar = fs.readdirSync(dizin).filter((f) => f.endsWith('_test.js')).sort();
const kirik = [];

for (const ad of dosyalar) {
  try {
    execFileSync(process.execPath, [path.join(dizin, ad)],
      { stdio: ['ignore', 'pipe', 'pipe'], timeout: 60000 });
    console.log('OK   ' + ad);
  } catch (err) {
    kirik.push(ad);
    console.log('KIRIK ' + ad);
    const cikti = String((err.stdout || '') + (err.stderr || ''));
    console.log(cikti.split('\n').slice(-8).map((l) => '     ' + l).join('\n'));
  }
}

console.log('\n' + dosyalar.length + ' test · kırık: ' + kirik.length);
process.exit(kirik.length ? 1 : 0);
