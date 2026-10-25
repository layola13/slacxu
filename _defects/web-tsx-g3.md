# web-tsx-g3 缺陷日志（ChatPanel.tsx / Composer.tsx）
src/components/ChatPanel.tsx:1-61 | [dynamic-type] imports/Props 类型含 Map/Record/回调/store | SAX 无类型/导入对应 | 注释保留全部类型与字段名
src/components/ChatPanel.tsx:236-262 | [expr-binding] {progress.title/label/progress} 与 sx 函数式主题值 | SAX: no behavior counterpart | bind 注释 + 属性名保留
src/components/ChatPanel.tsx:264-332 | [hooks] useState/useRef x6 (ChatPanelImpl) | SAX: no behavior counterpart | <state> 字段近似
src/components/ChatPanel.tsx:333-537 | [hooks] useEffect/useMemo/useCallback 派生链 (turns/agentSessions/rows/taskPlan) | SAX: no behavior counterpart | bind 注释列出派生名
src/components/ChatPanel.tsx:489-520 | [async-browser] useEffect + window.requestAnimationFrame/cancelAnimationFrame 回调链 | SAX: no behavior counterpart | 结构保留 + fn 桩
src/components/ChatPanel.tsx:522-537 | [event-handler] selectAgent/closeAgent/openAgentFromOverview useCallback | SAX: no behavior counterpart | onclick={^handler} 占位
src/components/ChatPanel.tsx:538-596 | [expr-binding] 条件渲染 threadLoadProgress&& 与进度 {expr} | SAX: no behavior counterpart | 元素保留 + bind 注释
src/components/ChatPanel.tsx:597-621 | [expr-binding] 条件渲染 hasParallelAgents&& / goal&& | SAX: no behavior counterpart | 元素保留 + bind 注释
src/components/ChatPanel.tsx:643-719 | [expr-binding] 三元 allAgentsSelected?/selectedAgent&& 与 ChatWaterfall 大量回调 props | SAX: no behavior counterpart | 元素树保留 + bind 注释
src/components/ChatPanel.tsx:720-756 | [list-render] errors.map / slashNotice&& / requestMonitor.length>0 / modes 条件 Chip | SAX: no behavior counterpart | 单实例元素保留 + bind 注释
src/components/ChatPanel.tsx:757-782 | [expr-binding] showEmptyConversation&& EmptyConversation props 透传 | SAX: no behavior counterpart | 组件元素保留
src/components/ChatPanel.tsx:784-822 | [event-handler] Dialog open/onClose、IconButton onClick 关闭 | SAX: no behavior counterpart | onclick 占位 + open 属性保留
src/components/ChatPanel.tsx:806-822 | [expr-binding] statsOpen&&stats&& 条件 StatsPanel | SAX: no behavior counterpart | 元素保留
src/components/ChatPanel.tsx:823-910 | [event-handler] GoalBanner onEdit/onStatusChange/onClear/onCancel 与 disabled 条件 | SAX: no behavior counterpart | onclick={^...} 占位
src/components/ChatPanel.tsx:823-910 | [expr-binding] GoalBanner 条件 Chip (tokensUsed/tokenBudget/timeUsed) 与三元图标 | SAX: no behavior counterpart | Chip 元素全保留 + bind 注释
src/components/ChatPanel.tsx:911-969 | [sx-theme] StatsPanel sx alpha(theme.palette...) 函数式样式 | SAX 无 sx/主题对应 | sx 属性名保留、值省略为 ""
src/components/ChatPanel.tsx:970-1042 | [dynamic-type] StatsMetric 与 format* 助手 (Intl.NumberFormat) | SAX: no behavior counterpart | 组件保留、助手记为注释
src/components/ChatPanel.tsx:1043-1138 | [list-render] ParallelAgentsRail agents.map + Tooltip/IconButton onClick | SAX: no behavior counterpart | 单实例保留 + bind 注释
src/components/ChatPanel.tsx:1139-1178 | [expr-binding] AgentConversationHeader agent.role&& 条件与状态 Chip | SAX: no behavior counterpart | 元素保留
src/components/ChatPanel.tsx:1179-1259 | [hooks] AllAgentsOverviewPage useAgentTranscriptOverview/useRef/useMemo + 条件 Chip x3 | SAX: no behavior counterpart | 组件元素保留 + bind 注释
src/components/ChatPanel.tsx:1260-1330 | [expr-binding] EmptyConversation !selectedAgent 三元分支 | SAX: no behavior counterpart | 两分支元素均保留
src/components/ChatPanel.tsx:1330-1538 | [sx-theme] DefaultWorkbenchEmpty heroImage 背景渐变函数/safeThemeAssetUrl/themeVisualTuning | SAX 无主题对应 | sx 属性名保留 + bind 注释
src/components/ChatPanel.tsx:1330-1538 | [event-handler] Discord/免费模型/Copy 按钮 onClick (含 void Promise) | SAX: no behavior counterpart | onclick 占位
src/components/ChatPanel.tsx:1452-1511 | [expr-binding] cliRecovery.required&& / !hasConfiguredRelays&& / hasConfiguredRelays 三元 | SAX: no behavior counterpart | Alert/子组件元素全保留
src/components/ChatPanel.tsx:1539-1581 | [dynamic-type] onboardingSteps 返回含 JSX 图标的步骤数组 + filter | SAX: no behavior counterpart | 注释登记函数名与步骤 id
src/components/ChatPanel.tsx:1582-1665 | [hooks] ChatPanel useRef latest/useMemo callbacks/memo 与 interactive 分支展开 props | SAX: no behavior counterpart | MemoizedChatPanel 元素 + 属性名全保留
src/components/ChatPanel.tsx:1667-1773 | [dynamic-type] isSameChatPanelProps 等比较助手与泛型 shallowArrayEqual<T> | SAX 无泛型/ memo 比较对应 | 注释逐名登记
src/components/ChatPanel.tsx:1775-1861 | [list-render] ConfiguredQuickActions actions 数组 .map Button | SAX: no behavior counterpart | 单实例 Button 保留
src/components/ChatPanel.tsx:1862-1876 | [async-browser] copyTextToClipboard async navigator.clipboard/document.execCommand | SAX: no behavior counterpart | 注释登记
src/components/ChatPanel.tsx:1877-1962 | [list-render] OnboardingGuide steps.map + onClick 分支 (official/prompt/section) | SAX: no behavior counterpart | 单实例保留 + onclick 占位
src/components/ChatPanel.tsx:1963-2040 | [list-render] PendingServerRequestsPanel pendingRequests.map 三分支 (userInput/approval/unsupported) | SAX: no behavior counterpart | 三分支元素全保留
src/components/ChatPanel.tsx:2001-2040 | [event-handler] Allow/Allow session/Decline/Cancel 按钮 onAnswerServerRequest 决策构造 | SAX: no behavior counterpart | Button 全保留 + bind 注释
src/components/ChatPanel.tsx:2041-2220 | [hooks] RequestUserInputCard useState x3 + ready 计算 + toggleMulti 闭包 | SAX: no behavior counterpart | <state> 字段 + fn 桩
src/components/ChatPanel.tsx:2081-2219 | [list-render] questions.map / options.map / isOther 与 showFreeform 三元 TextField/textarea | SAX: no behavior counterpart | 单实例全保留
src/components/ChatPanel.tsx:2221-2322 | [dynamic-type] buildUserInputResponse/requestQuestions flatMap 动态 params/RequestQuestion 类型 | SAX 无动态 JSON 对应 | 注释逐名登记
src/components/ChatPanel.tsx:2323-2428 | [list-render] RequestMonitorTable entries.map 表格行 + entries.length 三元空态 | SAX: no behavior counterpart | thead/tbody 结构全保留
src/components/ChatPanel.tsx:2429-2452 | [expr-binding] formatUsageCell / VisibleStatusChip 提前 return null | SAX: no behavior counterpart | Chip 保留 + 注释
src/components/ChatPanel.tsx:2453-2655 | [dynamic-type] useStableTurnsByThreadId (Map 身份复用) / buildAgentSessions 遍历 + union-find | SAX: no behavior counterpart | 注释逐名登记逻辑
src/components/ChatPanel.tsx:2656-2850 | [dynamic-type] agent 会话助手群 (merge/status/rows/itemReferences 等 20+ 函数) | SAX: no behavior counterpart | 注释逐名登记
src/components/ChatPanel.tsx:2851-2905 | [expr-binding] renderMcpToolCall 条件 Chip/args/error/result 与 prettyJson | SAX: no behavior counterpart | 元素全保留 + bind 注释
src/components/ChatPanel.tsx:2906-2960 | [dynamic-type] isRecord/asRecord/prettyJson/formatErrorText/safeThemeAssetUrl 动态 Record/JSON.stringify | SAX 无动态 JSON 对应 | 注释逐名登记
src/composer/Composer.tsx:1-87 | [dynamic-type] imports/Props 含 ReactNode/Promise 回调/SaVmPolicyConfig/JEV 类型 | SAX 无类型/导入对应 | 注释保留全部类型与字段名
src/composer/Composer.tsx:88-218 | [dynamic-type] VM_GIT_COMMAND_OPTIONS as const / Set / 常量与 trailingSkillQuery 正则 | SAX: no behavior counterpart | 注释逐项登记
src/composer/Composer.tsx:194-211 | [list-render] SkillMenuSection skills.map MenuItem + onSelect | SAX: no behavior counterpart | 单实例保留
src/composer/Composer.tsx:219-330 | [hooks] Composer useState x~35 / useRef x~8 | SAX: no behavior counterpart | <state> 字段全量近似
src/composer/Composer.tsx:330-470 | [hooks] useEffect JEV 清理/自动评审监听 (window 事件/CustomEvent/定时器) 与 jev 派生值 | SAX: no behavior counterpart | bind 注释 + 注释登记
src/composer/Composer.tsx:360-380 | [event-handler] handleJevNudge / showJevToast (Promise.resolve(onSend)) | SAX: no behavior counterpart | onclick 占位
src/composer/Composer.tsx:471-620 | [hooks] useEffect vmPolicy 同步/vmDialog 初始化/vm 默认策略构造 (展开合并 entries) | SAX: no behavior counterpart | 注释登记
src/composer/Composer.tsx:620-748 | [event-handler] updateVmEntries/addVmPath/browseVmPath(async 桌面 picker)/addVmHttpRule/addVmProcessRule/git 开关/saveVmPolicy(async) | SAX: no behavior counterpart | fn 名注释 + onclick 占位
src/composer/Composer.tsx:748-823 | [sx-theme] permissionControl Select renderValue/sx 圆形样式/permissionOptions.map | SAX 无 Select 渲染函数对应 | 在工具条使用处 bind 注释登记
src/composer/Composer.tsx:826-894 | [event-handler] 根 Box onDragEnter/Over/Leave/Drop (DataTransfer/拖放深度 ref) | SAX: no behavior counterpart | 属性名保留 + bind 注释
src/composer/Composer.tsx:895-957 | [expr-binding] jevToastOpen&&(verdict||error) JEV toast 条件子树与 jevCanNudge 条件按钮 | SAX: no behavior counterpart | 元素全保留
src/composer/Composer.tsx:958-1064 | [list-render] 状态条 additionalRoots.map Chip/Collapse + 条件工作指示/帮助 Tooltip 标题 JSX | SAX: no behavior counterpart | 元素全保留 + bind 注释
src/composer/Composer.tsx:1065-1079 | [expr-binding] imageError&& Alert / modeBadges 条件 Chip x3 | SAX: no behavior counterpart | 元素保留
src/composer/Composer.tsx:1080-1150 | [event-handler] TextField onChange (中转检测/菜单开合/技能查询) / onPaste / onKeyDown 与 compact 切换/状态指示条件 | SAX: no behavior counterpart | TextField 属性保留 + bind 注释
src/composer/Composer.tsx:1151-1360 | [expr-binding] 移动/桌面工具条三元分支 (mobileLayout ? Popover 按钮 : 命令按钮 / Skills / permissionControl / waterfall) | SAX: no behavior counterpart | 两分支元素均保留
src/composer/Composer.tsx:1361-1550 | [list-render] 移动工具 Popover 分组菜单 (命令/技能/VM/增强/JEV/瀑布/会话/权限) + waterfall Menu 模式 .map | SAX: no behavior counterpart | 分组结构全保留
src/composer/Composer.tsx:1551-1760 | [event-handler] VM/增强/JEV 按钮、发送/Steer/Stop IconButton onClick 与 disabled 条件、jevDotColor&& 状态点 | SAX: no behavior counterpart | onclick 占位 + 元素保留
src/composer/Composer.tsx:1760-1865 | [list-render] images.map 附件卡片 (kind 三元 img/图标 + 删除) / workspaceMentions.map 引用卡片 | SAX: no behavior counterpart | 单实例全保留
src/composer/Composer.tsx:1866-1885 | [async-browser] 隐藏 file input x2 onChange addAttachments (FileList) | SAX: no behavior counterpart | input 属性保留 + bind 注释
src/composer/Composer.tsx:1886-2060 | [list-render] 添加菜单 imageChannels.map/threads.slice(0,8).map/技能菜单 personal/system 条件段 | SAX: no behavior counterpart | Menu 结构全保留
src/composer/Composer.tsx:2061-2100 | [event-handler] 命令菜单 ComposerMenuItem x9 (slash 快捷/setSlashTemplate) | SAX: no behavior counterpart | 9 项逐项保留
src/composer/Composer.tsx:2101-2242 | [sx-theme] VM Dialog Tabs 与 execution 页 (VmToolsSettingsTab/git 开关 .map/自定义进程环境) | SAX: no behavior counterpart | Dialog/Tabs 结构保留 + bind 注释
src/composer/Composer.tsx:2001-2075 | [list-render] VM git safe/danger 分组 .filter/.map Switch + process exec .filter/.map 行 | SAX: no behavior counterpart | 单实例保留
src/composer/Composer.tsx:2076-2145 | [list-render] filesystem 页 access .map 输入行 / vmEntries.map 行 / Sala 路径 TextField | SAX: no behavior counterpart | 元素全保留
src/composer/Composer.tsx:2146-2242 | [expr-binding] network/preview 页条件片段 + http allow .map + vmPolicyPreview (JSON.stringify) | SAX: no behavior counterpart | 元素保留 + bind 注释
src/composer/Composer.tsx:2243-2413 | [event-handler] Composer 内嵌函数群 (runSlashCommandShortcut/append*/selectSkill/submitComposer/handleTextFieldKeyDown/navigateComposerHistory/handleComposerPaste) | SAX: no behavior counterpart | fn 桩逐名保留
src/composer/Composer.tsx:2283-2340 | [async-browser] submitComposer async submitComposerWhenAccepted / 1200ms 去重 ref / rememberComposerInput localStorage 保存 | SAX: no behavior counterpart | fn 桩 + 注释
src/composer/Composer.tsx:2420-2500 | [async-browser] addAttachments async (Promise.allSettled/File 校验/大小上限) / addWorkspaceMention/removeWorkspaceMention | SAX: no behavior counterpart | fn 桩 + 注释
src/composer/Composer.tsx:2414-2531 | [hooks] ComposerWorkingIndicator useState/useEffect 1s 定时器+visibility/focus 监听 + formatElapsed/formatCompactTokenCount | SAX: no behavior counterpart | 组件保留 + 注释
src/composer/Composer.tsx:2532-2559 | [dynamic-type] ComposerMenuItem ReactNode icon 槽位 | SAX 无 ReactNode 槽位对应 | 元素保留 + bind 注释
src/composer/Composer.tsx:2560-2675 | [async-browser] readAttachmentFile/readImageFile/uploadAttachmentFile (FormData/fetch/URL.createObjectURL/crypto) / revokeAttachmentPreview / hasSupportedDropData | SAX: no behavior counterpart | 注释逐名登记
src/composer/Composer.tsx:2676-2730 | [hooks] MobileContextRingButton useState Popover + contextUsageMetrics SVG 环计算 | SAX: no behavior counterpart | svg/circle 元素保留 + bind 注释
src/composer/Composer.tsx:2730-2787 | [hooks] MobileGitBranchButton useState Popover + !branch 提前 return null + dirty 点条件 | SAX: no behavior counterpart | 元素全保留
src/composer/Composer.tsx:2788-2847 | [event-handler] GitBranchIndicator onClick/onKeyDown (Enter/Space) 可点击 Stack | SAX: no behavior counterpart | 属性保留 + bind 注释
src/composer/Composer.tsx:2829-2931 | [sx-theme] ContextUsageIndicator/CompactContextStatusIndicator SVG 环/状态点颜色与 pulse 动画 sx | SAX 无动画/主题对应 | 元素保留 + 注释
src/composer/Composer.tsx:2932-3141 | [dynamic-type] 助手群 (clipboard/File/localStorage history/RegExp/mediaType/formatBytes/safeThemeAssetUrl 等 20+ 函数) | SAX: no behavior counterpart | 注释逐名登记
