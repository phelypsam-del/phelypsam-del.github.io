// Small, safe Markdown renderer (everything is HTML-escaped first).
(function () {
  const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  function inline(s) {
    const codes = [];
    s = s.replace(/`([^`\n]+)`/g, (_, c) => { codes.push(c); return '\u0000' + (codes.length - 1) + '\u0000'; });
    s = esc(s);
    s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
    s = s.replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/g, '$1<a href="$2" target="_blank" rel="noopener noreferrer">$2</a>');
    s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/__([^_]+)__/g, '<strong>$1</strong>');
    s = s.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>').replace(/(^|[\s(])_([^_\n]+)_/g, '$1<em>$2</em>');
    s = s.replace(/~~([^~]+)~~/g, '<del>$1</del>');
    s = s.replace(/\u0000(\d+)\u0000/g, (_, i) => '<code>' + esc(codes[i]) + '</code>');
    return s;
  }

  function render(src) {
    const lines = String(src || '').replace(/\r/g, '').split('\n');
    let out = '', i = 0;
    const para = [];
    const flush = () => { if (para.length) { out += '<p>' + inline(para.join('\n')).replace(/\n/g, '<br>') + '</p>'; para.length = 0; } };

    while (i < lines.length) {
      const line = lines[i];
      let m;
      if ((m = line.match(/^\s*```\s*([\w+#.-]*)/))) {
        flush();
        const lang = m[1] || ''; const code = []; i++;
        while (i < lines.length && !/^\s*```\s*$/.test(lines[i])) code.push(lines[i++]);
        i++;
        out += '<div class="code"><div class="code-head"><span>' + esc(lang || 'code') +
          '</span><button class="copy-code" type="button">Copy</button></div><pre><code>' + esc(code.join('\n')) + '</code></pre></div>';
        continue;
      }
      if ((m = line.match(/^(#{1,6})\s+(.*)/))) { flush(); const n = Math.min(m[1].length + 1, 6); out += `<h${n}>${inline(m[2])}</h${n}>`; i++; continue; }
      if (/^\s*([-*_])\s*\1\s*\1[\s\1]*$/.test(line)) { flush(); out += '<hr>'; i++; continue; }
      if (/^\s*>/.test(line)) {
        flush(); const q = [];
        while (i < lines.length && /^\s*>/.test(lines[i])) q.push(lines[i++].replace(/^\s*>\s?/, ''));
        out += '<blockquote>' + render(q.join('\n')) + '</blockquote>'; continue;
      }
      if (/^\s*\|.*\|\s*$/.test(line) && i + 1 < lines.length && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1])) {
        flush();
        const cells = l => l.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim());
        const head = cells(line); i += 2;
        let t = '<div class="table-wrap"><table><thead><tr>' + head.map(h => '<th>' + inline(h) + '</th>').join('') + '</tr></thead><tbody>';
        while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) t += '<tr>' + cells(lines[i++]).map(c => '<td>' + inline(c) + '</td>').join('') + '</tr>';
        out += t + '</tbody></table></div>'; continue;
      }
      if ((m = line.match(/^(\s*)([-*+]|\d+[.)])\s+/))) {
        flush();
        const ordered = /\d/.test(m[2]);
        const items = [];
        while (i < lines.length) {
          const l = lines[i];
          const mm = l.match(/^(\s*)([-*+]|\d+[.)])\s+(.*)/);
          if (mm && mm[1].length <= m[1].length + 1) { items.push([mm[3]]); i++; }
          else if (items.length && l.trim() && /^\s{2,}/.test(l)) { items[items.length - 1].push(l.replace(/^\s{2,4}/, '')); i++; }
          else if (!l.trim() && i + 1 < lines.length && /^(\s*)([-*+]|\d+[.)])\s+/.test(lines[i + 1])) { i++; }
          else break;
        }
        const tag = ordered ? 'ol' : 'ul';
        out += `<${tag}>` + items.map(it => {
          const [first, ...rest] = it;
          return '<li>' + inline(first) + (rest.length ? render(rest.join('\n')) : '') + '</li>';
        }).join('') + `</${tag}>`;
        continue;
      }
      if (!line.trim()) { flush(); i++; continue; }
      para.push(line); i++;
    }
    flush();
    return out;
  }
  window.renderMarkdown = render;
})();
