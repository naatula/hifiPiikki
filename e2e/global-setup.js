// Runs once before the whole suite: applies migrations and seeds the baseline
// fixtures (the `claude` user + e2e tabs/products). The dev server is started by
// Playwright's `webServer` config; this only touches the shared SQLite DB.
const { execFileSync } = require('child_process')
const path = require('path')

const ROOT = path.resolve(__dirname, '..')
const PY = path.join(ROOT, 'venv', 'bin', 'python')

module.exports = async () => {
  execFileSync(PY, ['manage.py', 'migrate', '--noinput'], { cwd: ROOT, stdio: 'ignore' })
  execFileSync(PY, [path.join('e2e', 'seed.py'), 'baseline'], { cwd: ROOT, stdio: 'inherit' })
}
