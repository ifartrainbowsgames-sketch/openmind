import fs from 'node:fs'

const yamlPath = process.argv[2] || `${process.env.TEMP}/nango-providers.yaml`
const text = fs.readFileSync(yamlPath, 'utf8')
const providers = []
let current = null
let inCats = false

for (const line of text.split('\n')) {
  const top = line.match(/^([a-z0-9][a-z0-9-]*):\s*$/)
  if (top) {
    if (current && !current.alias) providers.push(current)
    current = { id: top[1], name: top[1], categories: [], auth: '' }
    inCats = false
    continue
  }
  if (!current) continue
  if (/^\s+alias:/.test(line)) {
    current.alias = true
    inCats = false
    continue
  }
  const dn = line.match(/^\s+display_name:\s*(.+)\s*$/)
  if (dn) {
    current.name = dn[1].replace(/^['"]|['"]$/g, '')
    continue
  }
  if (/^\s+categories:\s*$/.test(line)) {
    inCats = true
    continue
  }
  if (inCats) {
    const cat = line.match(/^\s+-\s+([a-zA-Z0-9_-]+)\s*$/)
    if (cat) {
      current.categories.push(cat[1])
      continue
    }
    inCats = false
  }
  const auth = line.match(/^\s+auth_mode:\s+(\S+)/)
  if (auth) current.auth = auth[1]
}
if (current && !current.alias) providers.push(current)

providers.sort((a, b) => a.name.localeCompare(b.name))
const categories = [...new Set(providers.flatMap((p) => p.categories))].sort()
const out = {
  generatedAt: new Date().toISOString().slice(0, 10),
  source: 'NangoHQ/nango packages/providers/providers.yaml',
  count: providers.length,
  categories,
  providers: providers.map(({ id, name, categories: cats, auth }) => ({ id, name, categories: cats, auth })),
}

fs.mkdirSync('src/data', { recursive: true })
fs.writeFileSync('src/data/nango-providers.json', JSON.stringify(out))
console.log(`${out.count} providers, ${categories.length} categories`)
