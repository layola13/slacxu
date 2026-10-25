const applicationId = process.env.DISCORD_APPLICATION_ID?.trim();
const botToken = process.env.DISCORD_BOT_TOKEN?.trim();
const guildId = process.env.DISCORD_GUILD_ID?.trim();

if (!applicationId || !botToken) {
  throw new Error("DISCORD_APPLICATION_ID and DISCORD_BOT_TOKEN are required");
}

const command = {
  name: "free-key",
  description: "获取绑定当前机器的 Codex Ultra 免费模型密钥",
  options: [{
    type: 3,
    name: "required",
    description: "Codex Ultra 客户端显示的 required 码",
    required: true,
    min_length: 20,
    max_length: 20
  }]
};

const endpoint = guildId
  ? `https://discord.com/api/v10/applications/${applicationId}/guilds/${guildId}/commands`
  : `https://discord.com/api/v10/applications/${applicationId}/commands`;
const response = await fetch(endpoint, {
  method: "POST",
  headers: {
    Authorization: `Bot ${botToken}`,
    "Content-Type": "application/json"
  },
  body: JSON.stringify(command)
});
const body = await response.text();
if (!response.ok) throw new Error(`Discord command registration failed (${response.status}): ${body}`);
console.log(body);
