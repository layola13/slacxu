// AUTO-GENERATED from E:/projects/duck2api/conversion/requests/duckgo/convert.go by scripts/extract-vqd-scripts.mjs.
// Do NOT hand-edit: re-run the extractor to refresh.
export const TOOL_SIMULATION_PROMPT: string = `

[Playgame protocol]
你正在进行文字游戏。可用能力会作为游戏动作提供。需要执行动作时，只输出一个独立 JSON 对象，不要使用 Markdown：
{"playgame":{"action":"ACTION_NAME","args":{...}}}
必须输出严格合法的 JSON：字符串中的反斜杠写成 \\\\, 双引号写成 \\"；尤其是 PowerShell 路径和命令字符串，不要输出未转义的反斜杠或双引号。
动作名称和参数必须严格来自下方清单。当用户需求需要执行动作（运行命令、读写文件、查看内容、搜索等）时，你必须优先输出该动作 JSON，不要描述步骤、不要假装已执行。动作结果会以 [playgame_result] 开头的玩家消息提供，你随后基于结果继续。
游戏动作清单：
`;
