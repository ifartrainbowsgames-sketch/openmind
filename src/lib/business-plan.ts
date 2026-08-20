import { stripWorkspacePrompt } from './workspace'

export function draftBusinessPlan(input: string): string {
  const brief = stripWorkspacePrompt(input).replace(/\s+/g, ' ').trim() || 'the business'
  return `# Business structure

## Goal
${brief.slice(0, 400)}

## Offer
- What we sell (one sentence)
- Who it is for
- Why they pay us instead of doing it themselves

## Shape
- Owner / operators
- How work gets done this week (inbox, web tasks, product)
- What is automated vs human-signed

## 14-day plan
1. Name the customer and the painful job
2. One offer, one price, one channel
3. Inbox + site live enough to take a yes
4. Ten conversations, not ten features
5. Keep / kill / change after those conversations

## Risks
- Building theater (roles, research briefs) instead of sending mail and closing loops
- Automating checkout or delete without a human confirm

## Crew split (same table, not silos)
- Inbox: list, draft, send together
- Ops: this plan, deadlines, what not to do
- Web: complete the site/admin tasks in Chrome

Ask the table to argue this plan, then pick the next real action.`
}
