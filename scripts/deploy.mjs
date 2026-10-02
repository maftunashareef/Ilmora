// Publish the production build to GitHub Pages.
//
// The source repository stays private; only the compiled `dist/` output is pushed
// (force) to the public site repository, which GitHub Pages serves at SITE_URL.
//
//   npm run deploy
//
// Requires: git with GitHub credentials (gh auth setup-git) and Node 18+.
import { execSync } from 'node:child_process'
import { cpSync, existsSync, rmSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const SITE_REPO = 'https://github.com/maftunashareef/ilmora-demo.git'
const SITE_URL = 'https://maftunashareef.github.io/ilmora-demo/'
const AUTHOR = 'maftunashareef <297155965+maftunashareef@users.noreply.github.com>'

const root = resolve(import.meta.dirname, '..')
const dist = resolve(root, 'dist')
const run = (cmd, cwd = root) => execSync(cmd, { stdio: 'inherit', cwd, shell: true })

run('npx tsc -b')
run('npx vite build --mode pages') // base = /ilmora-demo/ (see vite.config.ts)

// Single-page app on GitHub Pages: unknown paths get 404.html, which is the same app shell.
cpSync(resolve(dist, 'index.html'), resolve(dist, '404.html'))
writeFileSync(resolve(dist, '.nojekyll'), '')

if (existsSync(resolve(dist, '.git'))) rmSync(resolve(dist, '.git'), { recursive: true, force: true })
run('git init -q -b main', dist)
run('git add -A', dist)
run(`git -c user.name=ilmora-deploy -c user.email=deploy@ilmora.local commit -q --author="${AUTHOR}" -m "Deploy ILMORA demo ${new Date().toISOString()}"`, dist)
run(`git push -f ${SITE_REPO} main`, dist)
rmSync(resolve(dist, '.git'), { recursive: true, force: true })

console.log(`\nDeployed → ${SITE_URL}`)
