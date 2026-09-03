// js/markdown.js
// High-performance streaming Markdown compiler, code fences, inline syntax, and thinking process renderer.

import { esc } from './state.js';

const SENT = String.fromCharCode(1);

export function inline(s) {
  s = s.replace(/`([^`\n]+?)`/g, '<code>$1</code>');
  s = s.replace(/\*\*([^*\n]+?)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/__([^_\n]+?)__/g, '<strong>$1</strong>');
  s = s.replace(/(^|[^*\w])\*([^*\n]+?)\*(?!\*)/g, '$1<em>$2</em>');
  s = s.replace(/~~([^~\n]+?)~~/g, '<del>$1</del>');
  s = s.replace(/\[([^\]\n]*)\]\((https?:\/\/[^\s)"'<>]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
  return s;
}

function splitRow(line) {
  return line.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|').map((c) => c.trim());
}

const RE_FENCE = /```[a-zA-Z0-9_+#-]*\n?([\s\S]*?)```/g;
const RE_HEAD = /^(#{1,4})\s+(.*)$/;
const RE_HR = /^\s*(-{3,}|\*{3,}|_{3,})\s*$/;
const RE_QUOTE = /^\s*>/;
const RE_ITEM = /^\s*(?:[-*+]|\d+[.)])\s+/;
const RE_UL = /^\s*[-*+]\s+/;
const RE_TBL_SEP = /^\s*\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)+\|?\s*$/;

export function renderMd(src) {
  const blocks = [];
  let text = String(src || '').replace(/\r\n?/g, '\n');

  text = text.replace(RE_FENCE, (m, code) => {
    blocks.push('<pre><code>' + esc(code.replace(/\n$/, '')) + '</code></pre>');
    return '\n' + SENT + 'B' + (blocks.length - 1) + SENT + '\n';
  });

  const lines = text.split('\n');
  const out = [];
  let i = 0;
  const ph = new RegExp('^' + SENT + 'B(\\d+)' + SENT + '$');

  while (i < lines.length) {
    const line = lines[i];

    if (/^\s*$/.test(line)) { i++; continue; }

    const m = line.trim().match(ph);
    if (m) { out.push(blocks[+m[1]]); i++; continue; }

    if (RE_HEAD.test(line)) {
      const h = line.match(RE_HEAD);
      const lv = h[1].length;
      out.push('<h' + lv + '>' + inline(esc(h[2])) + '</h' + lv + '>');
      i++; continue;
    }

    if (RE_HR.test(line)) { out.push('<hr>'); i++; continue; }

    if (RE_QUOTE.test(line)) {
      const q = [];
      while (i < lines.length && RE_QUOTE.test(lines[i])) {
        q.push(lines[i].replace(/^\s*>\s?/, ''));
        i++;
      }
      out.push('<blockquote>' + renderMd(q.join('\n')) + '</blockquote>');
      continue;
    }

    if (line.indexOf('|') !== -1 && i + 1 < lines.length && RE_TBL_SEP.test(lines[i + 1])) {
      const head = splitRow(lines[i]);
      i += 2;
      const rows = [];
      while (i < lines.length && lines[i].indexOf('|') !== -1 && !/^\s*$/.test(lines[i])) {
        rows.push(splitRow(lines[i]));
        i++;
      }
      const thead = '<tr>' + head.map((c) => '<th>' + inline(esc(c)) + '</th>').join('') + '</tr>';
      const tbody = rows.map((r) => '<tr>' + r.map((c) => '<td>' + inline(esc(c)) + '</td>').join('') + '</tr>').join('');
      out.push('<table><thead>' + thead + '</thead><tbody>' + tbody + '</tbody></table>');
      continue;
    }

    if (RE_ITEM.test(line)) {
      const ordered = !RE_UL.test(line);
      const items = [];
      while (i < lines.length) {
        if (RE_ITEM.test(lines[i])) {
          items.push(lines[i].replace(RE_ITEM, ''));
          i++;
        } else if (items.length && /^\s{2,}\S/.test(lines[i]) && !RE_ITEM.test(lines[i])) {
          items[items.length - 1] += '\n' + lines[i].trim();
          i++;
        } else break;
      }
      const tag = ordered ? 'ol' : 'ul';
      out.push('<' + tag + '>' + items.map((t) => '<li>' + inline(esc(t)).replace(/\n/g, '<br>') + '</li>').join('') + '</' + tag + '>');
      continue;
    }

    const para = [];
    while (i < lines.length && !/^\s*$/.test(lines[i]) &&
      !RE_HEAD.test(lines[i]) && !RE_QUOTE.test(lines[i]) && !RE_ITEM.test(lines[i])) {
      para.push(lines[i]);
      i++;
    }
    out.push('<p>' + inline(esc(para.join('\n'))).replace(/\n/g, '<br>') + '</p>');
  }

  return out.join('');
}

export function renderParts(reasoning, content) {
  let html = '';
  if (reasoning && reasoning.trim()) {
    html += '<details class="reasoning" open><summary><span class="reasoning-sparkle">✦</span> <span>思考过程</span></summary><div class="reasoning-body">' +
      renderMd(reasoning) + '</div></details>';
  }
  html += renderMd(content || '');
  return html;
}
