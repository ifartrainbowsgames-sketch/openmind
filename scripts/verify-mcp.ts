/**
 * Live check of the MCP path.
 *
 * Typechecking proved nothing about the E2B transport — the endpoint the code
 * called did not exist and every type was happy. The same risk applies to the
 * MCP layer, which two branches rewrote independently before being merged.
 *
 * Two halves, because they cannot be tested the same way:
 *
 *   1. TRANSPORT — driven against a real HTTP server on loopback. Proves the
 *      handshake, session reuse, tools/list, tools/call and that
 *      `structuredContent` survives instead of being flattened to prose.
 *
 *   2. URL GUARD — `resolveConnectionTools` refuses loopback by design, so the
 *      transport half cannot go through it. That refusal is itself a security
 *      property (an MCP URL is user-supplied, and `http://169.254.169.254/`
 *      reaches cloud metadata), so it is asserted rather than worked around.
 *
 *   npx tsx scripts/verify-mcp.ts
 */

import { createServer, type Server } from 'node:http'
import { callServerToolDetailed, listServerTools } from '../src/lib/mcp'
import { isMcpWriteTool, validateConnectionUrl } from '../src/lib/agent'

const PORT = 8791

const TOOLS = [
  {
    name: 'search_issues',
    description: 'Search issues and pull requests',
    inputSchema: {
      type: 'object',
      properties: { owner: { type: 'string' }, query: { type: 'string' } },
      required: ['query'],
    },
  },
  {
    name: 'delete_repo',
    description: 'Permanently delete a repository',
    inputSchema: { type: 'object', properties: { repo: { type: 'string' } }, required: ['repo'] },
  },
]

/** Requests the server actually received, so we can assert what was sent. */
const received: { method?: string; params?: Record<string, unknown>; session?: string }[] = []

function startServer(): Promise<Server> {
  const server = createServer((req, res) => {
    let body = ''
    req.on('data', (chunk) => { body += chunk })
    req.on('end', () => {
      let message: { id?: unknown; method?: string; params?: Record<string, unknown> } = {}
      try {
        message = JSON.parse(body || '{}')
      } catch { /* falls through to 202 */ }
      received.push({
        method: message.method,
        params: message.params,
        session: req.headers['mcp-session-id'] as string | undefined,
      })

      const send = (result: unknown) => {
        res.writeHead(200, { 'Content-Type': 'application/json', 'mcp-session-id': 'sess-1' })
        res.end(JSON.stringify({ jsonrpc: '2.0', id: message.id, result }))
      }

      if (message.method === 'initialize') {
        return send({ protocolVersion: '2025-06-18', capabilities: {}, serverInfo: { name: 'verify', version: '1' } })
      }
      if (message.method === 'tools/list') return send({ tools: TOOLS })
      if (message.method === 'tools/call') {
        return send({
          content: [{ type: 'text', text: `ran ${String(message.params?.name)}` }],
          structuredContent: { ok: true, tool: message.params?.name, args: message.params?.arguments },
        })
      }
      res.writeHead(202)
      res.end()
    })
  })
  return new Promise((resolve) => server.listen(PORT, () => resolve(server)))
}

let failures = 0
function check(label: string, passed: boolean, detail = ''): void {
  if (!passed) failures++
  console.log(`${passed ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`)
}

function rejects(label: string, url: string, expected: RegExp): void {
  try {
    validateConnectionUrl(url)
    check(label, false, 'was accepted')
  } catch (error) {
    check(label, expected.test(error instanceof Error ? error.message : ''), String(error))
  }
}

async function main(): Promise<void> {
  const server = await startServer()
  const spec = { url: `http://127.0.0.1:${PORT}`, name: 'verify' }

  try {
    console.log('— transport —')

    const tools = await listServerTools(spec)
    check('tools/list returns the advertised tools', tools.length === 2)
    check('names survive', tools.some((t) => t.name === 'search_issues'))
    check('descriptions survive (the write gate reads them)',
      tools.find((t) => t.name === 'delete_repo')?.description === 'Permanently delete a repository')
    check('input schemas survive', Boolean(tools.find((t) => t.name === 'search_issues')?.inputSchema))
    check('handshake ran before the list', received[0]?.method === 'initialize')

    const called = await callServerToolDetailed(spec, 'search_issues', { query: 'open bugs' })
    check('tools/call returns text', called.text.includes('ran search_issues'), called.text)
    check('structuredContent is NOT flattened away', Boolean(called.data))
    check('arguments arrived at the server',
      JSON.stringify(received.at(-1)?.params ?? {}).includes('open bugs'))
    check('the session id was reused, not re-handshaked',
      received.filter((r) => r.method === 'initialize').length === 1,
      `${received.filter((r) => r.method === 'initialize').length} handshake(s)`)

    console.log('\n— write gate —')
    check('delete_repo reads as a write',
      isMcpWriteTool({ name: 'delete_repo', description: 'Permanently delete a repository' }))
    check('search_issues reads as a read',
      !isMcpWriteTool({ name: 'search_issues', description: 'Search issues and pull requests' }))
    check('a destructive tool with an innocuous name is caught by its description',
      isMcpWriteTool({ name: 'execute', description: 'Permanently delete a repository' }))

    console.log('\n— url guard (an MCP URL is user-supplied) —')
    rejects('plain http is refused', 'http://example.com/mcp', /HTTPS/i)
    rejects('loopback is refused', 'https://127.0.0.1/mcp', /local/i)
    rejects('localhost is refused', 'https://localhost/mcp', /local/i)
    rejects('cloud metadata is refused', 'https://169.254.169.254/latest/meta-data', /local|private/i)
    rejects('private ranges are refused', 'https://10.0.0.5/mcp', /local|private/i)
    rejects('credentials in the url are refused', 'https://u:p@example.com/mcp', /credential/i)
    check('a normal https url is accepted',
      validateConnectionUrl('https://mcp.example.com/v1').hostname === 'mcp.example.com')
  } finally {
    server.close()
  }

  console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed')
  process.exit(failures ? 1 : 0)
}

main().catch((error) => {
  console.error('THREW', error)
  process.exit(1)
})
