import { BrowserWindow } from 'electron'
import { writeFile } from 'node:fs/promises'

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function renderInlineMarkdownHtml(text) {
  const s = String(text ?? '')
  if (!s) return ''

  let out = ''
  let pos = 0
  while (pos < s.length) {
    const boldOpen = s.indexOf('**', pos)
    let italicOpen = s.indexOf('*', pos)
    while (italicOpen !== -1 && (s[italicOpen + 1] === '*' || /\s/.test(s[italicOpen + 1] || ''))) {
      italicOpen = s.indexOf('*', italicOpen + 1)
    }

    const useBold = boldOpen !== -1 && (italicOpen === -1 || boldOpen <= italicOpen)
    const open = useBold ? boldOpen : italicOpen
    if (open === -1) {
      out += escapeHtml(s.slice(pos))
      break
    }

    const marker = useBold ? '**' : '*'
    const start = open + marker.length
    let close = s.indexOf(marker, start)
    while (!useBold && close !== -1 && /\s/.test(s[close - 1] || '')) {
      close = s.indexOf(marker, close + 1)
    }
    if (close === -1) {
      out += escapeHtml(s.slice(pos))
      break
    }

    out += escapeHtml(s.slice(pos, open))
    const markedText = s.slice(start, close)
    if (markedText) {
      if (useBold) out += `<strong>${escapeHtml(markedText)}</strong>`
      else out += `<em>${escapeHtml(markedText)}</em>`
    }
    pos = close + marker.length
  }

  return out
}

function renderMessageMarkdownHtml(text) {
  const lines = String(text ?? '').split('\n')
  const blocks = []
  let paragraph = []
  let i = 0

  const flushParagraph = () => {
    if (!paragraph.length) return
    const p = paragraph.map((line) => renderInlineMarkdownHtml(line)).join('<br>')
    blocks.push(`<p style="margin:0 0 8px 0">${p}</p>`)
    paragraph = []
  }

  while (i < lines.length) {
    const bullet = lines[i].match(/^\s*\*\s+(.+)$/)
    if (!bullet) {
      paragraph.push(lines[i])
      i += 1
      continue
    }

    flushParagraph()
    const items = []
    while (i < lines.length) {
      const item = lines[i].match(/^\s*\*\s+(.+)$/)
      const subitem = lines[i].match(/^\s+\+\s+(.+)$/)
      if (subitem && items.length) {
        items[items.length - 1].children.push(subitem[1])
        i += 1
        continue
      }
      if (!item) break
      items.push({ text: item[1], children: [] })
      i += 1
    }

    const listHtml = items.map((item) => {
      const childHtml = item.children.length
        ? `<ul style="margin:6px 0 0 0;padding-left:22px">${item.children.map((child) => `<li>${renderInlineMarkdownHtml(child)}</li>`).join('')}</ul>`
        : ''
      return `<li>${renderInlineMarkdownHtml(item.text)}${childHtml}</li>`
    }).join('')
    blocks.push(`<ul style="margin:0 0 8px 0;padding-left:22px">${listHtml}</ul>`)
  }

  flushParagraph()
  return blocks.join('')
}

/** chat: { title?, messages: { role, content }[] } */
export async function exportChatPdf(chat, outPath) {
  const title = escapeHtml(chat.title ?? 'Chat')
  const body = (chat.messages ?? []).map((m) => {
    const role = escapeHtml(m.role ?? '')
    const contentHtml = renderMessageMarkdownHtml(m.content ?? '')
    return `<p style="margin:12px 0 4px 0"><b>${role}:</b></p><div style="white-space:normal;margin-top:0">${contentHtml}</div>`
  }).join('')

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${title}</title></head><body style="font-family:system-ui,sans-serif;padding:32px"><h1>${title}</h1>${body}</body></html>`

  const win = new BrowserWindow({ show: false })
  try {
    await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
    const pdf = await win.webContents.printToPDF({
      printBackground: true,
      margins: { marginType: 'default' }
    })
    await writeFile(outPath, pdf)
  } finally {
    win.close()
  }
}
