const fs = require('fs');
const { execSync } = require('child_process');

const ROOT = 'C:/Users/victoryeh/Desktop/AI計畫/Website/2.0/ai_maturity_survey_v2/2.0';
const html = fs.readFileSync(ROOT + '/index.html', 'utf-8');

// --- 1. inline script syntax -------------------------------------------------
const s = html.indexOf('<script>') + 8;
const e = html.lastIndexOf('</script>');
const inline = html.substring(s, e);
fs.writeFileSync('C:/Users/victoryeh/_inline_check.js', inline);
try {
  execSync('node --check C:/Users/victoryeh/_inline_check.js', { stdio: 'pipe' });
  console.log('1. Inline JS syntax: PASS');
} catch (err) {
  console.log('1. Inline JS syntax: FAIL');
  console.log(err.stderr.toString());
  process.exit(1);
}

// --- 2. Vue template compile -------------------------------------------------
const vm = require('vm');
const ctx = {
  console,
  document: {
    createElement: () => {
      let raw = '';
      return {
        set innerHTML(v) {
          const m = v.match(/foo="([^"]*)"/);
          raw = m ? m[1].replace(/&quot;/g, '"') : '';
        },
        children: [{ getAttribute: () => raw }],
        textContent: ''
      };
    }
  }
};
vm.createContext(ctx);
vm.runInContext(fs.readFileSync('C:/Users/victoryeh/vue.global.js', 'utf-8'), ctx);

const t0 = html.indexOf('<div id="app"');
const t1 = html.indexOf('>', t0);
const te = html.lastIndexOf('</main>') + 7;
let errs = 0, warns = 0;
ctx.Vue.compile(html.substring(t1 + 1, te), {
  onError: (x) => { errs++; console.log('   COMPILE ERROR:', x.message); },
  onWarn: (x) => { warns++; }
});
console.log(`2. Vue template: ${errs === 0 ? 'PASS' : 'FAIL'} (${errs} errors, ${warns} warnings)`);
if (errs) process.exit(1);
