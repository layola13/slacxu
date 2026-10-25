export const MINI_SHORT_TASK_RULE = "Treat concise development tasks, feature names, and answers to your previous question as sufficient direction. Use the latest request together with relevant conversation context to infer reasonable details from the codebase; do not claim there is no requirement merely because the user omitted an implementation verb. Preserve explicit explanation-only requests and ask a targeted question only for a concrete ambiguity or blocker that cannot safely be resolved from context.";

const MINI_DIRECT_ANSWER_RE = /^(?:(?:你好|您好|嗨|谢谢|感谢|好的|收到|再见|hello|hi|hey|thanks|thank you|ok|okay|bye)[!！。,.，\s]*|(?:say|just say) (?:hi|hello)(?: briefly)?[.!\s]*|(?:什么是|解释一下|解释|介绍一下|what (?:is|are)\b|explain\b|define\b|(?:and now )?summarize\b)[\s\S]*|[\s\S]*(?:是什么|是做什么的)[?？。\s]*|[\s\S]*(?:你是谁|你是什么模型|你是哪个模型|who are you|which model are you|what model are you|what is your model)[?？。\s]*)$/i;
const MINI_ANALYSIS_ONLY_RE = /(?:^|[，,。;；\n])\s*(?:请(?:你)?\s*|please\s+|但\s*)?(?:(?:只|仅|只需|只要)(?:做)?(?:分析|解释|说明|评估|讨论|总结)|(?:不要|别|无需)(?:修改|改动|写入|写代码)|(?:analysis only|do not (?:edit|modify|write)|no code changes)\b|read[- ]only(?:\s+analysis|\s*[:.!]|\s*$))/i;
const MINI_CONSULTATION_RE = /(?:(?:^|\n)\s*#*\s*(?:致专家|请教|open\s*问题|问题汇总|技术咨询|架构评审|设计评审|性能攻坚)|(?:^|\n)\s*#*\s*(?:Q\d+|问题\d+)[.:、\s]|(?:追问|翻转条件|统一要求)\s*[:：]|(?:请(?:你)?(?:帮我)?(?:解答|回答|评估|诊断|分析|评审|探讨)|如何看待|怎么看|有何建议|给出建议))/i;
const MINI_EXPLICIT_WORKSPACE_WRITE_RE = /(?:请(?:直接)?(?:修改|写入|修复|实现并保存|改一下代码)|(?:修改|更新|写入)工作区文件)/i;
const MINI_TASK_EVASION_RE = /(?:暂无|当前无|没有|未提供|缺少)(?:明确的?)?(?:修改|变动|调整|开发)?(?:需求|目标)|如需(?:我)?(?:改动|修改)[^。\n]{0,60}请[^。\n]{0,20}(?:目标|需求)|请说明下一步|(?:需|需要)?(?:下一轮|下轮)(?:继续|再看|再查)|本轮已停止工具调用|未能进一步拉取|\bno (?:clear |explicit |specific |active )?(?:user |modification |implementation |development )?(?:request|requirement|task)\b|\b(?:please (?:specify|clarify) (?:the )?(?:task|requirement)|what (?:should (?:i|we)|would you like (?:me|us) to) do next|tool execution (?:paused|stopped|halted)|no further progress (?:possible|can be made)|blocker:\s*no active|continue (?:in )?next (?:round|turn))\b/i;
const MINI_CONCRETE_BLOCKER_RE = /(?:权限不足|权限被拒绝|只读沙箱|缺少[^。\n]{0,30}(?:密钥|凭据)|无法访问[^。\n]{1,60}|需要[^。\n]{0,30}(?:API.?key|凭据|密钥))|\b(?:permission denied|read-only sandbox|missing (?:credentials|api key)|cannot access\s+\S+)/i;

export const MAX_MINI_TASK_EVASION_STEERS = 2;
export const MAX_MINI_PLAN_STALL_STEERS = 1;
export const MAX_MINI_EMPTY_STEERS = 2;

export function miniIsDirectAnswerPrompt(prompt: string): boolean {
  return MINI_DIRECT_ANSWER_RE.test(prompt.trim());
}

export function miniIsAnalysisOnlyPrompt(prompt: string): boolean {
  if (MINI_ANALYSIS_ONLY_RE.test(prompt)) return true;
  if (MINI_CONSULTATION_RE.test(prompt) && !MINI_EXPLICIT_WORKSPACE_WRITE_RE.test(prompt)) {
    return true;
  }
  return false;
}

export function miniIsConciseDevelopmentFollowup(prompt: string, hasDevelopmentContext: boolean): boolean {
  const text = prompt.trim();
  return hasDevelopmentContext && text.length > 0 && text.length <= 160
    && !miniIsDirectAnswerPrompt(text) && !miniIsAnalysisOnlyPrompt(text)
    && !/[?？]|^(?:如何|怎么|为什么|为何|请问|how\b|why\b)/i.test(text);
}

export function miniHasDevelopmentContext(messages: unknown[], currentTurnId: string): boolean {
  const prior = messages.filter((message): message is Record<string, unknown> =>
    !!message && typeof message === "object" && String((message as Record<string, unknown>).turnId ?? "") !== currentTurnId);
  let lastUser = prior.length - 1;
  while (lastUser >= 0 && prior[lastUser]?.type !== "userMessage") lastUser--;
  if (lastUser < 0) return false;
  const recent = prior.slice(lastUser);
  const assistantText = recent.filter((message) => message.type === "agentMessage")
    .map((message) => String(message.text ?? "")).join("\n").slice(-8000);
  const discussesDevelopment = /项目|代码|功能|玩法|预览|组件|页面|workspace|codebase|implementation|feature|demo/i.test(assistantText);
  const asksNextTask = /下一步|如需|需求|目标|what[^\n]{0,40}(?:next|implement|change)|which[^\n]{0,40}(?:feature|fix)/i.test(assistantText);
  const inspectedWorkspace = recent.some((message) => message.type === "toolCall"
    && message.name === "sa_vm" && message.status === "completed");
  return discussesDevelopment && (asksNextTask || inspectedWorkspace);
}

export function miniPromptNeedsWorkspaceAction(prompt: string): boolean {
  return !!prompt.trim() && !miniIsDirectAnswerPrompt(prompt) && !miniIsAnalysisOnlyPrompt(prompt);
}

export function miniHasConcreteBlocker(text: string): boolean {
  return MINI_CONCRETE_BLOCKER_RE.test(text);
}

const MINI_ANALYSIS_EVASION_RE = /(?:tool execution (?:paused|stopped|halted)|no active (?:user )?task|no further progress (?:possible|can be made)|blocker:\s*no active|(?:需|需要)?(?:下一轮|下轮)(?:继续|再看|再查)|本轮已停止工具调用|未能进一步拉取|continue (?:in )?next (?:round|turn))/i;
export const MINI_GREETING_EVASION_RE = /^(?:(?:(?:I'm|I am|Hello,?\s+I'm|Hi,?\s+I'm)\s+[^.\n]{1,60}(?:ready to help|assistant|agent|coding|workspace))|(?:(?:你好|您好)[!！,，\s]*(?:我是|有人在)?[^。\n]{0,30}(?:有什么可以帮|随时为您|很高兴为你|为您服务|提供帮助|协助))|(?:(?:你好|您好|hello|hi)[!！。,\s]*(?:有什么可以帮(?:助)?(?:您|你)|how can I help you|what can I do for you))|^I'm\s+[^.\n]{1,60}(?:\(MiniAgent\)|\(agent\))?[^.\n]{0,60}ready to help\b)/i;

export function miniTaskEvasionCorrection(
  text: string,
  opts: {
    wantsWrite: boolean;
    hasPendingPlan: boolean;
    analysisOnly: boolean;
    hasWrite: boolean;
    hasToolCalls?: boolean;
    promptNeedsAction?: boolean;
  },
): string | null {
  if (opts.hasWrite) return null;
  if (miniHasConcreteBlocker(text)) return null;

  const trimmed = text.trim();
  if ((opts.promptNeedsAction || opts.hasToolCalls) && MINI_GREETING_EVASION_RE.test(trimmed)) {
    return "The active user request requires technical analysis or workspace action, but you only replied with a generic greeting or introduction. Do not output a greeting. Address the user's actual request directly using workspace evidence. If the required project files or code are not found in the current working directory, explicitly state that the target files were not found in this directory instead of falling back to a greeting.";
  }

  if (opts.analysisOnly) {
    if (opts.hasToolCalls && MINI_ANALYSIS_EVASION_RE.test(text)) {
      return "You have already gathered relevant results from tools in this turn. Formulate and deliver your final answer to the user directly using the existing tool results; do not claim there is no active task or that tool execution is paused.";
    }
    return null;
  }

  if (!opts.wantsWrite && !opts.hasPendingPlan && !opts.hasToolCalls) return null;
  if (!MINI_TASK_EVASION_RE.test(text)) return null;

  if (opts.hasToolCalls && !opts.wantsWrite) {
    return "You have already gathered relevant results from tools in this turn. Formulate and deliver your final answer to the user directly using the existing tool results; do not claim there is no active task or that tool execution is paused.";
  }
  return "The ACTIVE USER TASK is already a requirement, including a concise feature phrase or an answer to your previous question. Do not repeat the earlier claim that no requirement was provided. Resolve the request using relevant history and code, work the next unfinished step with sa_vm, and implement when permitted. Do not repeat unchanged reads. If genuinely blocked, identify the specific missing fact or denied action instead of asking for a new task.";
}

export function miniPlanStallCorrection(): string {
  return "The plan is unchanged after its previous reminder, but an unchanged fingerprint is not task completion. Take a different concrete action for the next unfinished step using the existing evidence, and update_plan as progress occurs. Do not repeat the workspace recap or claim the user supplied no requirement. If a real blocker prevents progress, report that specific blocker and leave unfinished steps truthful.";
}
