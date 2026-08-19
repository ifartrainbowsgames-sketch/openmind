// Cross-checks the two key-vault crypto implementations.
//
// worker/crypto.ts (Node) and supabase/functions/vault-keys/crypto.ts (Deno)
// are duplicated because the Edge Function deploys standalone. If their formats
// ever drift, every stored key becomes undecryptable — silently, and only in
// production. This proves a key sealed by one opens with the other.
//
// Run: npx tsx scripts/check-crypto.ts
import { sealKey as sealNode, openKey as openNode, keyHint } from '../worker/crypto'
import { sealKey as sealEdge, openKey as openEdge } from '../supabase/functions/vault-keys/crypto'

const SECRET = 'cross-impl-test-secret-value-9876543210'
const PLAIN = 'sk-proj-Abc123XyZ-7f2a'

let failures = 0
const check = (name: string, cond: boolean) => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}`)
  if (!cond) failures++
}

const node = await sealNode(PLAIN, SECRET)
const edge = await sealEdge(PLAIN, SECRET)

check('node seals, node opens', (await openNode(node, SECRET)) === PLAIN)
check('edge seals, edge opens', (await openEdge(edge, SECRET)) === PLAIN)
check('edge seals, node opens', (await openNode(edge, SECRET)) === PLAIN)
check('node seals, edge opens', (await openEdge(node, SECRET)) === PLAIN)
check('hints agree', node.hint === edge.hint && node.hint === keyHint(PLAIN))
check('IVs are distinct per seal', node.iv !== edge.iv)

console.log(failures ? `\n${failures} FAILURE(S) — the two implementations have drifted` : '\ncrypto implementations agree')
process.exit(failures ? 1 : 0)
