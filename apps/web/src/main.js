// Mini Agent waterfall client (extracted from index.html;
// served by apps/server at /src/main.js).
let threadId = 'mini-' + Date.now();
document.getElementById('tid').textContent = threadId;
const items = document.getElementById('items');
const status = document.getElementById('status');
const agentBlocks = {};
function addItem(cls, text) {
  const d = document.createElement('div');
  d.className = 'item ' + cls;
  d.textContent = text;
  items.appendChild(d);
  return d;
}
document.getElementById('newthread').addEventListener('click', () => {
  threadId = 'mini-' + Date.now();
  document.getElementById('tid').textContent = threadId;
  items.innerHTML = '';
});
document.getElementById('send').addEventListener('click', async () => {
  const prompt = document.getElementById('prompt').value;
  addItem('user', prompt);
  status.textContent = 'running...';
  try {
    const resp = await fetch('/api/chat', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({prompt, threadId})
    });
    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    for (;;) {
      const {value, done} = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, {stream: true});
      let idx;
      while ((idx = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, idx).trim();
        buffer = buffer.slice(idx + 1);
        if (!line.startsWith('data:')) continue;
        let ev;
        try { ev = JSON.parse(line.slice(5).trim()); } catch (e) { continue; }
        const p = ev.params || {};
        if (ev.method === 'item/started' && p.item && p.item.type === 'toolCall') {
          addItem('tool', 'tool call: ' + (p.item.name || '') + ' ...');
        } else if (ev.method === 'item/completed' && p.item && p.item.type === 'toolCall') {
          addItem('tool', 'tool done: ' + p.item.name + ' ' + (p.item.action || '') + ' ' + (p.item.path || ''));
        } else if (ev.method === 'turn/plan/updated') {
          const marks = {pending: '○', in_progress: '▶', completed: '●'};
          const lines = (p.plan || []).map(s => (marks[s.status] || '○') + ' ' + s.step);
          addItem('plan', 'plan\n' + lines.join('\n'));
        } else if (ev.method === 'item/reasoning/textDelta') {
          if (!agentBlocks[p.itemId]) agentBlocks[p.itemId] = addItem('reasoning', '');
          agentBlocks[p.itemId].textContent += p.delta || '';
        } else if (ev.method === 'item/agentMessage/delta') {
          if (!agentBlocks[p.itemId]) agentBlocks[p.itemId] = addItem('agent', '');
          agentBlocks[p.itemId].textContent += p.delta || '';
        } else if (ev.method === 'turn/completed') {
          status.textContent = 'completed';
        } else if (ev.method === 'turn/failed') {
          addItem('failed', 'turn failed: ' + (p.error || ''));
          status.textContent = 'failed';
        }
      }
    }
  } catch (err) {
    status.textContent = 'error: ' + err;
  }
});
