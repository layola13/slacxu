export function adminPageHtml(): string {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Codex Ultra 密钥管理</title>
  <style>
    body{font-family:system-ui,sans-serif;max-width:1160px;margin:30px auto;padding:0 16px;color:#172033;background:#f7f9fc}
    h1{font-size:25px}h2{font-size:18px}.panel{background:#fff;border:1px solid #dbe1ea;padding:16px;margin:14px 0;border-radius:8px}
    .row{display:flex;gap:8px;flex-wrap:wrap;align-items:center}.field{display:flex;flex-direction:column;gap:4px;margin:5px 0}
    input,button,textarea{padding:9px;border:1px solid #bbc4d4;border-radius:6px;font:inherit}input{min-width:170px}textarea{width:min(100%,720px);min-height:72px}
    button{cursor:pointer;background:#165dff;color:#fff;border:0}.secondary{background:#606b7d}.danger{background:#b42318}.hidden{display:none}.error{color:#b42318}
    .captcha{display:flex;gap:8px;align-items:center;margin-top:10px}.captcha img{width:210px;height:58px;border:1px solid #bbc4d4;border-radius:6px;background:#eef2f7;cursor:pointer}
    table{width:100%;border-collapse:collapse;margin-top:10px}td,th{padding:8px;border-bottom:1px solid #e4e8ef;text-align:left;font-size:13px}.hash{font-family:ui-monospace,monospace}
    @media(max-width:700px){table{display:block;overflow:auto}.row>*{flex:1 1 100%}}
  </style>
</head>
<body>
  <h1>Codex Ultra 密钥管理</h1>
  <section id="login" class="panel">
    <h2>管理员登录</h2>
    <div class="row"><input id="user" autocomplete="username" placeholder="用户名"><input id="pass" type="password" autocomplete="current-password" placeholder="密码"><input id="totp" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="Google 动态码（首次留空）"></div>
    <div class="captcha"><img id="captchaImage" alt="验证码，点击刷新" title="点击刷新"><input id="captchaAnswer" autocomplete="off" maxlength="5" placeholder="输入图中 5 位字符"><button id="loginButton">登录</button></div>
    <p id="loginError" class="error"></p>
  </section>
  <section id="totpSetup" class="panel hidden">
    <h2>首次绑定 Google Authenticator</h2>
    <p>使用 Google Authenticator、Microsoft Authenticator 或其他 TOTP 应用扫描二维码。扫描后输入当前 6 位动态码完成绑定。</p>
    <img id="totpQr" width="240" height="240" alt="Google Authenticator 二维码">
    <p>无法扫码时手工输入密钥：<code id="totpSecret"></code></p>
    <div class="row"><input id="totpConfirm" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="6 位动态码"><button id="totpConfirmButton">确认绑定并登录</button><button id="totpCancelButton" class="secondary">返回</button></div>
    <p id="totpError" class="error"></p>
  </section>
  <main id="app" class="hidden">
    <button id="logoutButton" class="secondary">退出</button>
    <section class="panel">
      <h2>系统设置与广告</h2>
      <div class="row">
        <label class="field">默认有效天数<input id="days" type="number" min="0.01" step="0.01"></label>
        <label class="field">强制刷新周期（小时）<input id="hours" type="number" min="0.1" step="0.1"></label>
        <label class="field">required 有效分钟<input id="ttl" type="number" min="1"></label>
      </div>
      <label class="field">Discord 邀请 URL<input id="invite" type="url"></label>
      <div class="row"><input id="campaignTitle" placeholder="广告标题"><input id="campaignUrl" type="url" placeholder="广告跳转 URL"><input id="campaignImage" type="url" placeholder="广告图片 URL"></div>
      <label class="field">广告内容<textarea id="campaignMessage"></textarea></label>
      <div class="row"><button id="saveSettingsButton">保存设置</button><button id="clearCampaignButton" class="secondary">关闭广告</button></div>
    </section>
    <section class="panel">
      <h2>手工签发</h2>
      <div class="row"><input id="machine" size="68" placeholder="64 位机器哈希"><input id="discord" placeholder="Discord 用户 ID"><input id="validity" type="number" min="0.01" step="0.01" value="1"><button id="issueButton">签发密钥</button></div>
      <pre id="issued"></pre>
    </section>
    <section class="panel">
      <h2>密钥列表</h2>
      <div class="row"><input id="query" placeholder="机器码、Discord 用户或 key preview"><button id="searchButton">查询</button></div>
      <div id="rows"></div>
    </section>
  </main>
  <script>
    const byId = (id) => document.getElementById(id);
    let captchaId = '';
    let enrollmentId = '';
    const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));
    async function api(path, options = {}) {
      const response = await fetch(path, {...options, headers: {'Content-Type':'application/json', ...(options.headers || {})}});
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || String(response.status));
      return body.data;
    }
    async function login() {
      try {
        const result = await api('/v1/admin/login', {method:'POST', body:JSON.stringify({username:byId('user').value, password:byId('pass').value, totp:byId('totp').value, captchaId, captchaAnswer:byId('captchaAnswer').value})});
        if (result.requiresTotpSetup) {
          enrollmentId = result.enrollmentId; byId('totpQr').src = result.qrDataUrl; byId('totpSecret').textContent = result.secret;
          byId('login').classList.add('hidden'); byId('totpSetup').classList.remove('hidden'); byId('totpConfirm').focus(); return;
        }
        byId('login').classList.add('hidden'); byId('app').classList.remove('hidden'); await load();
      } catch (error) { byId('loginError').textContent = error.message; await loadCaptcha(); }
    }
    async function loadCaptcha() {
      try {
        const challenge = await api('/v1/admin/captcha'); captchaId = challenge.captchaId;
        byId('captchaImage').src = challenge.imageDataUrl;
        byId('captchaAnswer').value = ''; byId('captchaAnswer').focus();
      } catch (error) { byId('loginError').textContent = '验证码加载失败：' + error.message; }
    }
    async function confirmTotpSetup() {
      try {
        await api('/v1/admin/totp/confirm', {method:'POST', body:JSON.stringify({enrollmentId, totp:byId('totpConfirm').value})});
        byId('totpSetup').classList.add('hidden'); byId('app').classList.remove('hidden'); await load();
      } catch (error) { byId('totpError').textContent = error.message; }
    }
    async function load() {
      try {
        const data = await api('/v1/admin/console?q=' + encodeURIComponent(byId('query').value));
        byId('days').value = data.settings.defaultValidityDays; byId('hours').value = data.settings.refreshIntervalHours;
        byId('ttl').value = data.settings.requiredTtlMinutes; byId('invite').value = data.settings.discordInviteUrl;
        const campaign = data.settings.campaign || {};
        byId('campaignTitle').value = campaign.title || ''; byId('campaignMessage').value = campaign.message || '';
        byId('campaignUrl').value = campaign.targetUrl || ''; byId('campaignImage').value = campaign.imageUrl || '';
        byId('rows').innerHTML = '<table><tr><th>机器码</th><th>Discord</th><th>密钥</th><th>签发 / 到期</th><th>最后刷新</th><th>状态</th><th></th></tr>' + data.licenses.map((license) =>
          '<tr><td class="hash" title="' + escapeHtml(license.machineHash) + '">' + escapeHtml(license.machineHash.slice(0, 12)) + '…</td><td>' + escapeHtml(license.discordUserId) + '</td><td>' + escapeHtml(license.keyPreview) + '</td><td>' + escapeHtml(new Date(license.issuedAt).toLocaleString()) + '<br>' + escapeHtml(new Date(license.expiresAt).toLocaleString()) + '</td><td>' + escapeHtml(license.refreshAt ? new Date(license.refreshAt).toLocaleString() : '未刷新') + '</td><td>' + escapeHtml(license.status) + '</td><td>' + (license.status === 'active' ? '<button class="danger revoke" data-id="' + escapeHtml(license.id) + '">撤销</button>' : '') + '</td></tr>').join('') + '</table>';
        document.querySelectorAll('.revoke').forEach((button) => button.addEventListener('click', () => revoke(button.dataset.id)));
      } catch (error) { if (error.message === 'Unauthorized') location.reload(); else alert(error.message); }
    }
    async function saveSettings() {
      const title = byId('campaignTitle').value.trim(), message = byId('campaignMessage').value.trim();
      const campaign = title && message ? {id:'admin-' + Date.now(), title, message, targetUrl:byId('campaignUrl').value, imageUrl:byId('campaignImage').value} : null;
      await api('/v1/admin/console/settings', {method:'PUT', body:JSON.stringify({defaultValidityDays:Number(byId('days').value), refreshIntervalHours:Number(byId('hours').value), requiredTtlMinutes:Number(byId('ttl').value), discordInviteUrl:byId('invite').value, campaign})});
      await load(); alert('设置已保存');
    }
    async function issue() {
      try {
        const data = await api('/v1/admin/console/issue', {method:'POST', body:JSON.stringify({machineHash:byId('machine').value, discordUserId:byId('discord').value, validityDays:Number(byId('validity').value)})});
        byId('issued').textContent = '密钥：' + data.key + '\n到期：' + new Date(data.expiresAt).toLocaleString(); await load();
      } catch (error) { alert(error.message); }
    }
    async function revoke(id) { if (confirm('确认撤销这个密钥？')) { await api('/v1/admin/console/revoke', {method:'POST', body:JSON.stringify({id})}); await load(); } }
    byId('loginButton').addEventListener('click', login); byId('captchaImage').addEventListener('click', loadCaptcha); byId('captchaAnswer').addEventListener('keydown', (event) => { if (event.key === 'Enter') login(); });
    byId('totpConfirmButton').addEventListener('click', confirmTotpSetup); byId('totpConfirm').addEventListener('keydown', (event) => { if (event.key === 'Enter') confirmTotpSetup(); });
    byId('totpCancelButton').addEventListener('click', () => { enrollmentId = ''; byId('totpSetup').classList.add('hidden'); byId('login').classList.remove('hidden'); loadCaptcha(); });
    byId('logoutButton').addEventListener('click', async () => { await api('/v1/admin/logout', {method:'POST'}); location.reload(); });
    byId('searchButton').addEventListener('click', load); byId('saveSettingsButton').addEventListener('click', saveSettings); byId('issueButton').addEventListener('click', issue);
    byId('clearCampaignButton').addEventListener('click', async () => { await api('/v1/admin/console/settings', {method:'PUT', body:JSON.stringify({campaign:null})}); await load(); });
    api('/v1/admin/console').then(() => { byId('login').classList.add('hidden'); byId('app').classList.remove('hidden'); load(); }).catch(loadCaptcha);
  </script>
</body>
</html>`;
}
