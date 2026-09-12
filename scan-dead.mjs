import { readdirSync, readFileSync, existsSync, statSync } from 'fs';
import { join, resolve, dirname, basename, extname } from 'path';

const root = resolve(process.argv[2]);
const exts = ['.ts', '.tsx', '.js', '.jsx', '.mjs'];
const skipDirs = new Set(['node_modules', 'dist', 'dist-server', 'public', '.git', 'coverage']);

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    let st;
    try { st = statSync(full); } catch { continue; }
    if (st.isDirectory()) {
      if (!skipDirs.has(entry)) walk(full, out);
    } else if (exts.includes(extname(entry))) {
      out.push(full);
    }
  }
  return out;
}

const files = walk(root);
const norm = (p) => p.replace(/\\/g, '/').toLowerCase();

// candidate pool: non-test source files
const candidates = new Set(
  files
    .filter((f) => !/(?:\.test\.|\.spec\.|\/tests\/|\/__tests?__\/|vite-env|\.d\.ts$|\/scripts\/|\/fixtures\/)/.test(norm(f)))
    .map(norm)
);

// collect import specifiers from every file (including tests — tests keep files alive)
const specRe = /(?:import|export)\s[\s\S]*?from\s*['"]([^'"]+)['"]|import\s*['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)|require\(\s*['"]([^'"]+)['"]\s*\)/g;
const referenced = new Set();

function resolveFromRoot(rest) {
  const base = resolve(root, rest);
  const tries = [];
  if (rest.endsWith('.js') || rest.endsWith('.mjs')) {
    tries.push(base.replace(/\.js$/, '.ts'), base.replace(/\.js$/, '.tsx'), base);
  } else {
    for (const e of exts) tries.push(base + e);
    for (const e of exts) tries.push(join(base, 'index' + e));
  }
  for (const t of tries) {
    if (existsSync(t) && statSync(t).isFile()) return norm(t);
  }
  return null;
}

function resolveSpec(fromFile, spec) {
  if (spec.startsWith('@/')) return resolveFromRoot(spec.slice(2)); // tsconfig/vite alias "@/*" -> scan root
  if (!spec.startsWith('.') && !spec.startsWith('/')) return null; // bare package
  const base = resolve(dirname(fromFile), spec);
  const tries = [];
  if (spec.endsWith('.js') || spec.endsWith('.mjs') || spec.endsWith('.jsx')) {
    const ts = base.replace(/\.(js|mjs|jsx)$/, extname(base) === '.mjs' ? '.mjs' : (spec.endsWith('.jsx') ? '.jsx' : '.ts'));
    tries.push(ts, base);
    if (spec.endsWith('.js')) tries.push(base.replace(/\.js$/, '.tsx'), base.replace(/\.js$/, '.jsx'));
  } else {
    for (const e of exts) tries.push(base + e);
    for (const e of exts) tries.push(join(base, 'index' + e));
  }
  for (const t of tries) {
    if (existsSync(t) && statSync(t).isFile()) return norm(t);
  }
  return null;
}

for (const f of files) {
  let src;
  try { src = readFileSync(f, 'utf8'); } catch { continue; }
  let m;
  specRe.lastIndex = 0;
  while ((m = specRe.exec(src))) {
    const spec = m[1] || m[2] || m[3] || m[4];
    if (!spec) continue;
    const r = resolveSpec(f, spec);
    if (r) referenced.add(r);
  }
}

const dead = [...candidates].filter((f) => !referenced.has(f)).sort();
const entryHints = /(?:^|\/)(main|index|app|App|router|routes|setupTests|server|load-env)\.(?:t|j)sx?$/;
const report = dead.map((f) => ({
  file: f.slice(norm(root).length + 1),
  isEntryLike: entryHints.test(f),
}));
for (const r of report) console.log(`${r.isEntryLike ? '[entry?] ' : 'dead:   '}${r.file}`);
console.log(`\nscanned ${files.length} files, ${candidates.size} candidates, ${report.length} unreferenced`);
