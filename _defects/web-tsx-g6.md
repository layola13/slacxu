apps/web/src/components/AuthScreens.tsx:1-87 | React hook (useState/useEffect/useRef/useMemo/useCallback…) | SAX: no behavior counterpart | state fields declared in <state>; hook bodies dropped to DEFECT/fn stubs
apps/web/src/components/AuthScreens.tsx:117-305 | JSX event handler prop (onClick/onChange/…) | SAX: no behavior counterpart | simple identifiers kept as onclick={^handler}; complex handlers as bind comment
apps/web/src/components/AuthScreens.tsx:20-311 | {expr} expression binding in JSX | SAX: no expression evaluation | replaced by <!-- bind: expr --> comment, structure preserved
apps/web/src/components/AuthScreens.tsx:174-302 | conditional rendering (&& / ternary) | SAX: no behavior counterpart | both branches kept in tree order with bind comment
apps/web/src/components/AuthScreens.tsx:43-138 | async/await, Promise, timer or fetch | SAX: no behavior counterpart | represented as fn stub only
apps/web/src/components/AuthScreens.tsx:117-291 | DOM / browser API access | SAX: no DOM counterpart | structure kept; DOM logic noted as DEFECT, not ported
apps/web/src/components/AuthScreens.tsx:1-3 | external package import (three/monaco/xterm/MUI/lucide/etc.) | external component/renderer has no SAX counterpart | imported component tags kept 1:1 as elements; renderer noted as DEFECT
apps/web/src/components/FreeModelAccessDialog.tsx:22-79 | React hook (useState/useEffect/useRef/useMemo/useCallback…) | SAX: no behavior counterpart | state fields declared in <state>; hook bodies dropped to DEFECT/fn stubs
apps/web/src/components/FreeModelAccessDialog.tsx:144-298 | JSX event handler prop (onClick/onChange/…) | SAX: no behavior counterpart | simple identifiers kept as onclick={^handler}; complex handlers as bind comment
apps/web/src/components/FreeModelAccessDialog.tsx:144-298 | {expr} expression binding in JSX | SAX: no expression evaluation | replaced by <!-- bind: expr --> comment, structure preserved
apps/web/src/components/FreeModelAccessDialog.tsx:147-298 | conditional rendering (&& / ternary) | SAX: no behavior counterpart | both branches kept in tree order with bind comment
apps/web/src/components/FreeModelAccessDialog.tsx:157 | list rendering via .map() | SAX: no behavior counterpart | single item template kept; repetition marked by bind comment
apps/web/src/components/FreeModelAccessDialog.tsx:41-134 | async/await, Promise, timer or fetch | SAX: no behavior counterpart | represented as fn stub only
apps/web/src/components/FreeModelAccessDialog.tsx:84-90 | DOM / browser API access | SAX: no DOM counterpart | structure kept; DOM logic noted as DEFECT, not ported
apps/web/src/components/FreeModelAccessDialog.tsx:1-23 | external package import (three/monaco/xterm/MUI/lucide/etc.) | external component/renderer has no SAX counterpart | imported component tags kept 1:1 as elements; renderer noted as DEFECT
apps/web/src/components/FreebuffModelSwitchDialog.tsx:55-237 | JSX event handler prop (onClick/onChange/…) | SAX: no behavior counterpart | simple identifiers kept as onclick={^handler}; complex handlers as bind comment
apps/web/src/components/FreebuffModelSwitchDialog.tsx:37-243 | {expr} expression binding in JSX | SAX: no expression evaluation | replaced by <!-- bind: expr --> comment, structure preserved
apps/web/src/components/FreebuffModelSwitchDialog.tsx:77-242 | conditional rendering (&& / ternary) | SAX: no behavior counterpart | both branches kept in tree order with bind comment
apps/web/src/components/FreebuffModelSwitchDialog.tsx:28 | async/await, Promise, timer or fetch | SAX: no behavior counterpart | represented as fn stub only
apps/web/src/components/FreebuffModelSwitchDialog.tsx:1-5 | external package import (three/monaco/xterm/MUI/lucide/etc.) | external component/renderer has no SAX counterpart | imported component tags kept 1:1 as elements; renderer noted as DEFECT
apps/web/src/components/GatewayCharts.tsx:2-57 | React hook (useState/useEffect/useRef/useMemo/useCallback…) | SAX: no behavior counterpart | state fields declared in <state>; hook bodies dropped to DEFECT/fn stubs
apps/web/src/components/GatewayCharts.tsx:26 | JSX event handler prop (onClick/onChange/…) | SAX: no behavior counterpart | simple identifiers kept as onclick={^handler}; complex handlers as bind comment
apps/web/src/components/GatewayCharts.tsx:6-229 | {expr} expression binding in JSX | SAX: no expression evaluation | replaced by <!-- bind: expr --> comment, structure preserved
apps/web/src/components/GatewayCharts.tsx:83-221 | conditional rendering (&& / ternary) | SAX: no behavior counterpart | both branches kept in tree order with bind comment
apps/web/src/components/GatewayCharts.tsx:27-219 | list rendering via .map() | SAX: no behavior counterpart | single item template kept; repetition marked by bind comment
apps/web/src/components/GatewayCharts.tsx:1-2 | external package import (three/monaco/xterm/MUI/lucide/etc.) | external component/renderer has no SAX counterpart | imported component tags kept 1:1 as elements; renderer noted as DEFECT
apps/web/src/components/CliPrerequisiteScreen.tsx:1-111 | React hook (useState/useEffect/useRef/useMemo/useCallback…) | SAX: no behavior counterpart | state fields declared in <state>; hook bodies dropped to DEFECT/fn stubs
apps/web/src/components/CliPrerequisiteScreen.tsx:136-192 | JSX event handler prop (onClick/onChange/…) | SAX: no behavior counterpart | simple identifiers kept as onclick={^handler}; complex handlers as bind comment
apps/web/src/components/CliPrerequisiteScreen.tsx:39-192 | {expr} expression binding in JSX | SAX: no expression evaluation | replaced by <!-- bind: expr --> comment, structure preserved
apps/web/src/components/CliPrerequisiteScreen.tsx:113-192 | conditional rendering (&& / ternary) | SAX: no behavior counterpart | both branches kept in tree order with bind comment
apps/web/src/components/CliPrerequisiteScreen.tsx:50-88 | async/await, Promise, timer or fetch | SAX: no behavior counterpart | represented as fn stub only
apps/web/src/components/CliPrerequisiteScreen.tsx:41-76 | DOM / browser API access | SAX: no DOM counterpart | structure kept; DOM logic noted as DEFECT, not ported
apps/web/src/components/CliPrerequisiteScreen.tsx:1-19 | external package import (three/monaco/xterm/MUI/lucide/etc.) | external component/renderer has no SAX counterpart | imported component tags kept 1:1 as elements; renderer noted as DEFECT
apps/web/src/components/ThemeBackgroundMedia.tsx:1-84 | React hook (useState/useEffect/useRef/useMemo/useCallback…) | SAX: no behavior counterpart | state fields declared in <state>; hook bodies dropped to DEFECT/fn stubs
apps/web/src/components/ThemeBackgroundMedia.tsx:130 | JSX event handler prop (onClick/onChange/…) | SAX: no behavior counterpart | simple identifiers kept as onclick={^handler}; complex handlers as bind comment
apps/web/src/components/ThemeBackgroundMedia.tsx:16-155 | {expr} expression binding in JSX | SAX: no expression evaluation | replaced by <!-- bind: expr --> comment, structure preserved
apps/web/src/components/ThemeBackgroundMedia.tsx:17-31 | conditional rendering (&& / ternary) | SAX: no behavior counterpart | both branches kept in tree order with bind comment
apps/web/src/components/ThemeBackgroundMedia.tsx:37-149 | DOM / browser API access | SAX: no DOM counterpart | structure kept; DOM logic noted as DEFECT, not ported
apps/web/src/components/ThemeBackgroundMedia.tsx:1-2 | external package import (three/monaco/xterm/MUI/lucide/etc.) | external component/renderer has no SAX counterpart | imported component tags kept 1:1 as elements; renderer noted as DEFECT
apps/web/src/components/AgentRosterEditor.tsx:92-162 | JSX event handler prop (onClick/onChange/…) | SAX: no behavior counterpart | simple identifiers kept as onclick={^handler}; complex handlers as bind comment
apps/web/src/components/AgentRosterEditor.tsx:31-162 | {expr} expression binding in JSX | SAX: no expression evaluation | replaced by <!-- bind: expr --> comment, structure preserved
apps/web/src/components/AgentRosterEditor.tsx:80-131 | conditional rendering (&& / ternary) | SAX: no behavior counterpart | both branches kept in tree order with bind comment
apps/web/src/components/AgentRosterEditor.tsx:45-153 | list rendering via .map() | SAX: no behavior counterpart | single item template kept; repetition marked by bind comment
apps/web/src/components/AgentRosterEditor.tsx:26 | external package import (three/monaco/xterm/MUI/lucide/etc.) | external component/renderer has no SAX counterpart | imported component tags kept 1:1 as elements; renderer noted as DEFECT
apps/web/src/components/LegalConsentScreen.tsx:1-61 | React hook (useState/useEffect/useRef/useMemo/useCallback…) | SAX: no behavior counterpart | state fields declared in <state>; hook bodies dropped to DEFECT/fn stubs
apps/web/src/components/LegalConsentScreen.tsx:103-144 | JSX event handler prop (onClick/onChange/…) | SAX: no behavior counterpart | simple identifiers kept as onclick={^handler}; complex handlers as bind comment
apps/web/src/components/LegalConsentScreen.tsx:92-144 | {expr} expression binding in JSX | SAX: no expression evaluation | replaced by <!-- bind: expr --> comment, structure preserved
apps/web/src/components/LegalConsentScreen.tsx:108-142 | conditional rendering (&& / ternary) | SAX: no behavior counterpart | both branches kept in tree order with bind comment
apps/web/src/components/LegalConsentScreen.tsx:26-69 | async/await, Promise, timer or fetch | SAX: no behavior counterpart | represented as fn stub only
apps/web/src/components/LegalConsentScreen.tsx:60-115 | DOM / browser API access | SAX: no DOM counterpart | structure kept; DOM logic noted as DEFECT, not ported
apps/web/src/components/LegalConsentScreen.tsx:1-20 | external package import (three/monaco/xterm/MUI/lucide/etc.) | external component/renderer has no SAX counterpart | imported component tags kept 1:1 as elements; renderer noted as DEFECT
apps/web/src/components/OfficialOpenAiLoginDialog.tsx:1-42 | React hook (useState/useEffect/useRef/useMemo/useCallback…) | SAX: no behavior counterpart | state fields declared in <state>; hook bodies dropped to DEFECT/fn stubs
apps/web/src/components/OfficialOpenAiLoginDialog.tsx:90-121 | JSX event handler prop (onClick/onChange/…) | SAX: no behavior counterpart | simple identifiers kept as onclick={^handler}; complex handlers as bind comment
apps/web/src/components/OfficialOpenAiLoginDialog.tsx:20-121 | {expr} expression binding in JSX | SAX: no expression evaluation | replaced by <!-- bind: expr --> comment, structure preserved
apps/web/src/components/OfficialOpenAiLoginDialog.tsx:99-121 | conditional rendering (&& / ternary) | SAX: no behavior counterpart | both branches kept in tree order with bind comment
apps/web/src/components/OfficialOpenAiLoginDialog.tsx:20-82 | async/await, Promise, timer or fetch | SAX: no behavior counterpart | represented as fn stub only
apps/web/src/components/OfficialOpenAiLoginDialog.tsx:39-78 | DOM / browser API access | SAX: no DOM counterpart | structure kept; DOM logic noted as DEFECT, not ported
apps/web/src/components/OfficialOpenAiLoginDialog.tsx:1-15 | external package import (three/monaco/xterm/MUI/lucide/etc.) | external component/renderer has no SAX counterpart | imported component tags kept 1:1 as elements; renderer noted as DEFECT
apps/web/src/components/AgentRosterManagerDialog.tsx:1-39 | React hook (useState/useEffect/useRef/useMemo/useCallback…) | SAX: no behavior counterpart | state fields declared in <state>; hook bodies dropped to DEFECT/fn stubs
apps/web/src/components/AgentRosterManagerDialog.tsx:77-113 | JSX event handler prop (onClick/onChange/…) | SAX: no behavior counterpart | simple identifiers kept as onclick={^handler}; complex handlers as bind comment
apps/web/src/components/AgentRosterManagerDialog.tsx:50-113 | {expr} expression binding in JSX | SAX: no expression evaluation | replaced by <!-- bind: expr --> comment, structure preserved
apps/web/src/components/AgentRosterManagerDialog.tsx:82-113 | conditional rendering (&& / ternary) | SAX: no behavior counterpart | both branches kept in tree order with bind comment
apps/web/src/components/AgentRosterManagerDialog.tsx:83-97 | list rendering via .map() | SAX: no behavior counterpart | single item template kept; repetition marked by bind comment
apps/web/src/components/AgentRosterManagerDialog.tsx:24-65 | async/await, Promise, timer or fetch | SAX: no behavior counterpart | represented as fn stub only
apps/web/src/components/AgentRosterManagerDialog.tsx:42-43 | DOM / browser API access | SAX: no DOM counterpart | structure kept; DOM logic noted as DEFECT, not ported
apps/web/src/components/AgentRosterManagerDialog.tsx:1-3 | external package import (three/monaco/xterm/MUI/lucide/etc.) | external component/renderer has no SAX counterpart | imported component tags kept 1:1 as elements; renderer noted as DEFECT
apps/web/src/components/ThreeBackgroundScene.tsx:1-10 | React hook (useState/useEffect/useRef/useMemo/useCallback…) | SAX: no behavior counterpart | state fields declared in <state>; hook bodies dropped to DEFECT/fn stubs
apps/web/src/components/ThreeBackgroundScene.tsx:80 | JSX event handler prop (onClick/onChange/…) | SAX: no behavior counterpart | simple identifiers kept as onclick={^handler}; complex handlers as bind comment
apps/web/src/components/ThreeBackgroundScene.tsx:14-111 | {expr} expression binding in JSX | SAX: no expression evaluation | replaced by <!-- bind: expr --> comment, structure preserved
apps/web/src/components/ThreeBackgroundScene.tsx:8-99 | DOM / browser API access | SAX: no DOM counterpart | structure kept; DOM logic noted as DEFECT, not ported
apps/web/src/components/ThreeBackgroundScene.tsx:1-3 | external package import (three/monaco/xterm/MUI/lucide/etc.) | external component/renderer has no SAX counterpart | imported component tags kept 1:1 as elements; renderer noted as DEFECT
apps/web/src/components/ThreePetDockScene.tsx:1-9 | React hook (useState/useEffect/useRef/useMemo/useCallback…) | SAX: no behavior counterpart | state fields declared in <state>; hook bodies dropped to DEFECT/fn stubs
apps/web/src/components/ThreePetDockScene.tsx:60 | JSX event handler prop (onClick/onChange/…) | SAX: no behavior counterpart | simple identifiers kept as onclick={^handler}; complex handlers as bind comment
apps/web/src/components/ThreePetDockScene.tsx:17-103 | {expr} expression binding in JSX | SAX: no expression evaluation | replaced by <!-- bind: expr --> comment, structure preserved
apps/web/src/components/ThreePetDockScene.tsx:7-89 | DOM / browser API access | SAX: no DOM counterpart | structure kept; DOM logic noted as DEFECT, not ported
apps/web/src/components/ThreePetDockScene.tsx:1-3 | external package import (three/monaco/xterm/MUI/lucide/etc.) | external component/renderer has no SAX counterpart | imported component tags kept 1:1 as elements; renderer noted as DEFECT
apps/web/src/components/WorkspaceCodeEditor.tsx:42 | JSX event handler prop (onClick/onChange/…) | SAX: no behavior counterpart | simple identifiers kept as onclick={^handler}; complex handlers as bind comment
apps/web/src/components/WorkspaceCodeEditor.tsx:19-59 | {expr} expression binding in JSX | SAX: no expression evaluation | replaced by <!-- bind: expr --> comment, structure preserved
apps/web/src/components/WorkspaceCodeEditor.tsx:57 | list rendering via .map() | SAX: no behavior counterpart | single item template kept; repetition marked by bind comment
apps/web/src/components/WorkspaceCodeEditor.tsx:1-3 | external package import (three/monaco/xterm/MUI/lucide/etc.) | external component/renderer has no SAX counterpart | imported component tags kept 1:1 as elements; renderer noted as DEFECT
apps/web/src/components/WindowsTerminalLauncher.tsx:1-39 | React hook (useState/useEffect/useRef/useMemo/useCallback…) | SAX: no behavior counterpart | state fields declared in <state>; hook bodies dropped to DEFECT/fn stubs
apps/web/src/components/WindowsTerminalLauncher.tsx:68-93 | JSX event handler prop (onClick/onChange/…) | SAX: no behavior counterpart | simple identifiers kept as onclick={^handler}; complex handlers as bind comment
apps/web/src/components/WindowsTerminalLauncher.tsx:8-98 | {expr} expression binding in JSX | SAX: no expression evaluation | replaced by <!-- bind: expr --> comment, structure preserved
apps/web/src/components/WindowsTerminalLauncher.tsx:78 | list rendering via .map() | SAX: no behavior counterpart | single item template kept; repetition marked by bind comment
apps/web/src/components/WindowsTerminalLauncher.tsx:19-72 | DOM / browser API access | SAX: no DOM counterpart | structure kept; DOM logic noted as DEFECT, not ported
apps/web/src/components/WindowsTerminalLauncher.tsx:1-4 | external package import (three/monaco/xterm/MUI/lucide/etc.) | external component/renderer has no SAX counterpart | imported component tags kept 1:1 as elements; renderer noted as DEFECT
apps/web/src/components/NewChatButton.tsx:1-48 | React hook (useState/useEffect/useRef/useMemo/useCallback…) | SAX: no behavior counterpart | state fields declared in <state>; hook bodies dropped to DEFECT/fn stubs
apps/web/src/components/NewChatButton.tsx:68-83 | JSX event handler prop (onClick/onChange/…) | SAX: no behavior counterpart | simple identifiers kept as onclick={^handler}; complex handlers as bind comment
apps/web/src/components/NewChatButton.tsx:47-86 | {expr} expression binding in JSX | SAX: no expression evaluation | replaced by <!-- bind: expr --> comment, structure preserved
apps/web/src/components/NewChatButton.tsx:82 | list rendering via .map() | SAX: no behavior counterpart | single item template kept; repetition marked by bind comment
apps/web/src/components/NewChatButton.tsx:48-52 | DOM / browser API access | SAX: no DOM counterpart | structure kept; DOM logic noted as DEFECT, not ported
apps/web/src/components/NewChatButton.tsx:1-8 | external package import (three/monaco/xterm/MUI/lucide/etc.) | external component/renderer has no SAX counterpart | imported component tags kept 1:1 as elements; renderer noted as DEFECT
apps/web/src/components/CliBackendToggle.tsx:1-19 | React hook (useState/useEffect/useRef/useMemo/useCallback…) | SAX: no behavior counterpart | state fields declared in <state>; hook bodies dropped to DEFECT/fn stubs
apps/web/src/components/CliBackendToggle.tsx:48-70 | JSX event handler prop (onClick/onChange/…) | SAX: no behavior counterpart | simple identifiers kept as onclick={^handler}; complex handlers as bind comment
apps/web/src/components/CliBackendToggle.tsx:22-70 | {expr} expression binding in JSX | SAX: no expression evaluation | replaced by <!-- bind: expr --> comment, structure preserved
apps/web/src/components/CliBackendToggle.tsx:1-2 | external package import (three/monaco/xterm/MUI/lucide/etc.) | external component/renderer has no SAX counterpart | imported component tags kept 1:1 as elements; renderer noted as DEFECT
apps/web/src/components/AgentRosterSetupControl.tsx:4-19 | React hook (useState/useEffect/useRef/useMemo/useCallback…) | SAX: no behavior counterpart | state fields declared in <state>; hook bodies dropped to DEFECT/fn stubs
apps/web/src/components/AgentRosterSetupControl.tsx:49-62 | JSX event handler prop (onClick/onChange/…) | SAX: no behavior counterpart | simple identifiers kept as onclick={^handler}; complex handlers as bind comment
apps/web/src/components/AgentRosterSetupControl.tsx:10-62 | {expr} expression binding in JSX | SAX: no expression evaluation | replaced by <!-- bind: expr --> comment, structure preserved
apps/web/src/components/AgentRosterSetupControl.tsx:46-60 | conditional rendering (&& / ternary) | SAX: no behavior counterpart | both branches kept in tree order with bind comment
apps/web/src/components/AgentRosterSetupControl.tsx:1-4 | external package import (three/monaco/xterm/MUI/lucide/etc.) | external component/renderer has no SAX counterpart | imported component tags kept 1:1 as elements; renderer noted as DEFECT
apps/web/src/components/CliBackendPicker.tsx:43 | JSX event handler prop (onClick/onChange/…) | SAX: no behavior counterpart | simple identifiers kept as onclick={^handler}; complex handlers as bind comment
apps/web/src/components/CliBackendPicker.tsx:23-59 | {expr} expression binding in JSX | SAX: no expression evaluation | replaced by <!-- bind: expr --> comment, structure preserved
apps/web/src/components/CliBackendPicker.tsx:56 | list rendering via .map() | SAX: no behavior counterpart | single item template kept; repetition marked by bind comment
apps/web/src/components/CliBackendPicker.tsx:1-2 | external package import (three/monaco/xterm/MUI/lucide/etc.) | external component/renderer has no SAX counterpart | imported component tags kept 1:1 as elements; renderer noted as DEFECT
apps/web/src/components/ThemeQuickSwitcher.tsx:1-19 | React hook (useState/useEffect/useRef/useMemo/useCallback…) | SAX: no behavior counterpart | state fields declared in <state>; hook bodies dropped to DEFECT/fn stubs
apps/web/src/components/ThemeQuickSwitcher.tsx:30-57 | JSX event handler prop (onClick/onChange/…) | SAX: no behavior counterpart | simple identifiers kept as onclick={^handler}; complex handlers as bind comment
apps/web/src/components/ThemeQuickSwitcher.tsx:29-57 | {expr} expression binding in JSX | SAX: no expression evaluation | replaced by <!-- bind: expr --> comment, structure preserved
apps/web/src/components/ThemeQuickSwitcher.tsx:50 | conditional rendering (&& / ternary) | SAX: no behavior counterpart | both branches kept in tree order with bind comment
apps/web/src/components/ThemeQuickSwitcher.tsx:45-50 | list rendering via .map() | SAX: no behavior counterpart | single item template kept; repetition marked by bind comment
apps/web/src/components/ThemeQuickSwitcher.tsx:19 | DOM / browser API access | SAX: no DOM counterpart | structure kept; DOM logic noted as DEFECT, not ported
apps/web/src/components/ThemeQuickSwitcher.tsx:1-5 | external package import (three/monaco/xterm/MUI/lucide/etc.) | external component/renderer has no SAX counterpart | imported component tags kept 1:1 as elements; renderer noted as DEFECT
apps/web/src/components/CliBackendSettingsPanel.tsx:48 | JSX event handler prop (onClick/onChange/…) | SAX: no behavior counterpart | simple identifiers kept as onclick={^handler}; complex handlers as bind comment
apps/web/src/components/CliBackendSettingsPanel.tsx:20-52 | {expr} expression binding in JSX | SAX: no expression evaluation | replaced by <!-- bind: expr --> comment, structure preserved
apps/web/src/components/CliBackendSettingsPanel.tsx:33 | conditional rendering (&& / ternary) | SAX: no behavior counterpart | both branches kept in tree order with bind comment
apps/web/src/components/CliBackendSettingsPanel.tsx:39 | list rendering via .map() | SAX: no behavior counterpart | single item template kept; repetition marked by bind comment
apps/web/src/components/CliBackendSettingsPanel.tsx:1-2 | external package import (three/monaco/xterm/MUI/lucide/etc.) | external component/renderer has no SAX counterpart | imported component tags kept 1:1 as elements; renderer noted as DEFECT
apps/web/src/components/VendorLogo.tsx:41-52 | {expr} expression binding in JSX | SAX: no expression evaluation | replaced by <!-- bind: expr --> comment, structure preserved
apps/web/src/components/ResizeHandle.tsx:9 | {expr} expression binding in JSX | SAX: no expression evaluation | replaced by <!-- bind: expr --> comment, structure preserved
apps/web/src/components/ResizeHandle.tsx:1-2 | external package import (three/monaco/xterm/MUI/lucide/etc.) | external component/renderer has no SAX counterpart | imported component tags kept 1:1 as elements; renderer noted as DEFECT
apps/web/src/components/CliBackendIcon.tsx:18-43 | {expr} expression binding in JSX | SAX: no expression evaluation | replaced by <!-- bind: expr --> comment, structure preserved
apps/web/src/components/CliBackendIcon.tsx:32-43 | conditional rendering (&& / ternary) | SAX: no behavior counterpart | both branches kept in tree order with bind comment
apps/web/src/components/CliBackendIcon.tsx:1-4 | external package import (three/monaco/xterm/MUI/lucide/etc.) | external component/renderer has no SAX counterpart | imported component tags kept 1:1 as elements; renderer noted as DEFECT
apps/web/src/components/ThreadStatusDot.tsx:10-18 | {expr} expression binding in JSX | SAX: no expression evaluation | replaced by <!-- bind: expr --> comment, structure preserved
apps/web/src/components/ThreadStatusDot.tsx:1 | external package import (three/monaco/xterm/MUI/lucide/etc.) | external component/renderer has no SAX counterpart | imported component tags kept 1:1 as elements; renderer noted as DEFECT
apps/web/src/components/PetDock.tsx:22-23 | {expr} expression binding in JSX | SAX: no expression evaluation | replaced by <!-- bind: expr --> comment, structure preserved
apps/web/src/components/PetDock.tsx:1 | external package import (three/monaco/xterm/MUI/lucide/etc.) | external component/renderer has no SAX counterpart | imported component tags kept 1:1 as elements; renderer noted as DEFECT
apps/web/src/components/MonacoEditor.tsx:7 | {expr} expression binding in JSX | SAX: no expression evaluation | replaced by <!-- bind: expr --> comment, structure preserved
apps/web/src/components/MonacoEditor.tsx:1-2 | external package import (three/monaco/xterm/MUI/lucide/etc.) | external component/renderer has no SAX counterpart | imported component tags kept 1:1 as elements; renderer noted as DEFECT
apps/web/src/components/PtyTerminalView.tsx:1-93 | React hook (useState/useEffect/useRef/useMemo/useCallback…) | SAX: no behavior counterpart | state fields declared in <state>; hook bodies dropped to DEFECT/fn stubs
apps/web/src/components/PtyTerminalView.tsx:230 | JSX event handler prop (onClick/onChange/…) | SAX: no behavior counterpart | simple identifiers kept as onclick={^handler}; complex handlers as bind comment
apps/web/src/components/PtyTerminalView.tsx:11-238 | {expr} expression binding in JSX | SAX: no expression evaluation | replaced by <!-- bind: expr --> comment, structure preserved
apps/web/src/components/PtyTerminalView.tsx:15-16 | conditional rendering (&& / ternary) | SAX: no behavior counterpart | both branches kept in tree order with bind comment
apps/web/src/components/PtyTerminalView.tsx:12-180 | async/await, Promise, timer or fetch | SAX: no behavior counterpart | represented as fn stub only
apps/web/src/components/PtyTerminalView.tsx:89-186 | DOM / browser API access | SAX: no DOM counterpart | structure kept; DOM logic noted as DEFECT, not ported
apps/web/src/components/PtyTerminalView.tsx:1-2 | external package import (three/monaco/xterm/MUI/lucide/etc.) | external component/renderer has no SAX counterpart | imported component tags kept 1:1 as elements; renderer noted as DEFECT
apps/web/src/components/RecentWorkspacesControl.tsx:1-57 | React hook (useState/useEffect/useRef/useMemo/useCallback…) | SAX: no behavior counterpart | state fields declared in <state>; hook bodies dropped to DEFECT/fn stubs
apps/web/src/components/RecentWorkspacesControl.tsx:105-214 | JSX event handler prop (onClick/onChange/…) | SAX: no behavior counterpart | simple identifiers kept as onclick={^handler}; complex handlers as bind comment
apps/web/src/components/RecentWorkspacesControl.tsx:97-218 | {expr} expression binding in JSX | SAX: no expression evaluation | replaced by <!-- bind: expr --> comment, structure preserved
apps/web/src/components/RecentWorkspacesControl.tsx:127-198 | conditional rendering (&& / ternary) | SAX: no behavior counterpart | both branches kept in tree order with bind comment
apps/web/src/components/RecentWorkspacesControl.tsx:120-175 | list rendering via .map() | SAX: no behavior counterpart | single item template kept; repetition marked by bind comment
apps/web/src/components/RecentWorkspacesControl.tsx:50-63 | DOM / browser API access | SAX: no DOM counterpart | structure kept; DOM logic noted as DEFECT, not ported
apps/web/src/components/RecentWorkspacesControl.tsx:1-20 | external package import (three/monaco/xterm/MUI/lucide/etc.) | external component/renderer has no SAX counterpart | imported component tags kept 1:1 as elements; renderer noted as DEFECT
apps/web/src/components/RightWorkspacePanel.tsx:1-236 | React hook (useState/useEffect/useRef/useMemo/useCallback…) | SAX: no behavior counterpart | state fields declared in <state>; hook bodies dropped to DEFECT/fn stubs
apps/web/src/components/RightWorkspacePanel.tsx:142-375 | JSX event handler prop (onClick/onChange/…) | SAX: no behavior counterpart | simple identifiers kept as onclick={^handler}; complex handlers as bind comment
apps/web/src/components/RightWorkspacePanel.tsx:48-375 | {expr} expression binding in JSX | SAX: no expression evaluation | replaced by <!-- bind: expr --> comment, structure preserved
apps/web/src/components/RightWorkspacePanel.tsx:151-295 | conditional rendering (&& / ternary) | SAX: no behavior counterpart | both branches kept in tree order with bind comment
apps/web/src/components/RightWorkspacePanel.tsx:42-61 | async/await, Promise, timer or fetch | SAX: no behavior counterpart | represented as fn stub only
apps/web/src/components/RightWorkspacePanel.tsx:354 | DOM / browser API access | SAX: no DOM counterpart | structure kept; DOM logic noted as DEFECT, not ported
apps/web/src/components/RightWorkspacePanel.tsx:1-8 | external package import (three/monaco/xterm/MUI/lucide/etc.) | external component/renderer has no SAX counterpart | imported component tags kept 1:1 as elements; renderer noted as DEFECT
apps/web/src/components/SecuritySettingsPanel.tsx:18-173 | React hook (useState/useEffect/useRef/useMemo/useCallback…) | SAX: no behavior counterpart | state fields declared in <state>; hook bodies dropped to DEFECT/fn stubs
apps/web/src/components/SecuritySettingsPanel.tsx:232-469 | JSX event handler prop (onClick/onChange/…) | SAX: no behavior counterpart | simple identifiers kept as onclick={^handler}; complex handlers as bind comment
apps/web/src/components/SecuritySettingsPanel.tsx:52-469 | {expr} expression binding in JSX | SAX: no expression evaluation | replaced by <!-- bind: expr --> comment, structure preserved
apps/web/src/components/SecuritySettingsPanel.tsx:225-446 | conditional rendering (&& / ternary) | SAX: no behavior counterpart | both branches kept in tree order with bind comment
apps/web/src/components/SecuritySettingsPanel.tsx:67-207 | async/await, Promise, timer or fetch | SAX: no behavior counterpart | represented as fn stub only
apps/web/src/components/SecuritySettingsPanel.tsx:14-19 | external package import (three/monaco/xterm/MUI/lucide/etc.) | external component/renderer has no SAX counterpart | imported component tags kept 1:1 as elements; renderer noted as DEFECT
apps/web/src/components/TopBarRelayTreeSelector.tsx:1-123 | React hook (useState/useEffect/useRef/useMemo/useCallback…) | SAX: no behavior counterpart | state fields declared in <state>; hook bodies dropped to DEFECT/fn stubs
apps/web/src/components/TopBarRelayTreeSelector.tsx:173-469 | JSX event handler prop (onClick/onChange/…) | SAX: no behavior counterpart | simple identifiers kept as onclick={^handler}; complex handlers as bind comment
apps/web/src/components/TopBarRelayTreeSelector.tsx:164-537 | {expr} expression binding in JSX | SAX: no expression evaluation | replaced by <!-- bind: expr --> comment, structure preserved
apps/web/src/components/TopBarRelayTreeSelector.tsx:139-495 | conditional rendering (&& / ternary) | SAX: no behavior counterpart | both branches kept in tree order with bind comment
apps/web/src/components/TopBarRelayTreeSelector.tsx:369-462 | list rendering via .map() | SAX: no behavior counterpart | single item template kept; repetition marked by bind comment
apps/web/src/components/TopBarRelayTreeSelector.tsx:45-469 | async/await, Promise, timer or fetch | SAX: no behavior counterpart | represented as fn stub only
apps/web/src/components/TopBarRelayTreeSelector.tsx:70-84 | DOM / browser API access | SAX: no DOM counterpart | structure kept; DOM logic noted as DEFECT, not ported
apps/web/src/components/TopBarRelayTreeSelector.tsx:1-28 | external package import (three/monaco/xterm/MUI/lucide/etc.) | external component/renderer has no SAX counterpart | imported component tags kept 1:1 as elements; renderer noted as DEFECT
apps/web/src/components/UsageBillingPanel.tsx:27-84 | React hook (useState/useEffect/useRef/useMemo/useCallback…) | SAX: no behavior counterpart | state fields declared in <state>; hook bodies dropped to DEFECT/fn stubs
apps/web/src/components/UsageBillingPanel.tsx:135-247 | JSX event handler prop (onClick/onChange/…) | SAX: no behavior counterpart | simple identifiers kept as onclick={^handler}; complex handlers as bind comment
apps/web/src/components/UsageBillingPanel.tsx:45-449 | {expr} expression binding in JSX | SAX: no expression evaluation | replaced by <!-- bind: expr --> comment, structure preserved
apps/web/src/components/UsageBillingPanel.tsx:129-452 | conditional rendering (&& / ternary) | SAX: no behavior counterpart | both branches kept in tree order with bind comment
apps/web/src/components/UsageBillingPanel.tsx:86-383 | list rendering via .map() | SAX: no behavior counterpart | single item template kept; repetition marked by bind comment
apps/web/src/components/UsageBillingPanel.tsx:62-108 | async/await, Promise, timer or fetch | SAX: no behavior counterpart | represented as fn stub only
apps/web/src/components/UsageBillingPanel.tsx:21-28 | external package import (three/monaco/xterm/MUI/lucide/etc.) | external component/renderer has no SAX counterpart | imported component tags kept 1:1 as elements; renderer noted as DEFECT
apps/web/src/components/WorkspaceFilesSettingsPanel.tsx:1-58 | React hook (useState/useEffect/useRef/useMemo/useCallback…) | SAX: no behavior counterpart | state fields declared in <state>; hook bodies dropped to DEFECT/fn stubs
apps/web/src/components/WorkspaceFilesSettingsPanel.tsx:68-172 | JSX event handler prop (onClick/onChange/…) | SAX: no behavior counterpart | simple identifiers kept as onclick={^handler}; complex handlers as bind comment
apps/web/src/components/WorkspaceFilesSettingsPanel.tsx:51-190 | {expr} expression binding in JSX | SAX: no expression evaluation | replaced by <!-- bind: expr --> comment, structure preserved
apps/web/src/components/WorkspaceFilesSettingsPanel.tsx:102-190 | conditional rendering (&& / ternary) | SAX: no behavior counterpart | both branches kept in tree order with bind comment
apps/web/src/components/WorkspaceFilesSettingsPanel.tsx:167 | list rendering via .map() | SAX: no behavior counterpart | single item template kept; repetition marked by bind comment
apps/web/src/components/WorkspaceFilesSettingsPanel.tsx:12-13 | async/await, Promise, timer or fetch | SAX: no behavior counterpart | represented as fn stub only
apps/web/src/components/WorkspaceFilesSettingsPanel.tsx:1-7 | external package import (three/monaco/xterm/MUI/lucide/etc.) | external component/renderer has no SAX counterpart | imported component tags kept 1:1 as elements; renderer noted as DEFECT
apps/web/src/components/chatgpt-shell/ChatGptDesktopShell.tsx:1-42 | React hook (useState/useEffect/useRef/useMemo/useCallback…) | SAX: no behavior counterpart | state fields declared in <state>; hook bodies dropped to DEFECT/fn stubs
apps/web/src/components/chatgpt-shell/ChatGptDesktopShell.tsx:57-82 | JSX event handler prop (onClick/onChange/…) | SAX: no behavior counterpart | simple identifiers kept as onclick={^handler}; complex handlers as bind comment
apps/web/src/components/chatgpt-shell/ChatGptDesktopShell.tsx:26-82 | {expr} expression binding in JSX | SAX: no expression evaluation | replaced by <!-- bind: expr --> comment, structure preserved
apps/web/src/components/chatgpt-shell/ChatGptDesktopShell.tsx:65-82 | conditional rendering (&& / ternary) | SAX: no behavior counterpart | both branches kept in tree order with bind comment
apps/web/src/components/chatgpt-shell/ChatGptDesktopShell.tsx:61 | list rendering via .map() | SAX: no behavior counterpart | single item template kept; repetition marked by bind comment
apps/web/src/components/chatgpt-shell/ChatGptDesktopShell.tsx:1-11 | external package import (three/monaco/xterm/MUI/lucide/etc.) | external component/renderer has no SAX counterpart | imported component tags kept 1:1 as elements; renderer noted as DEFECT
apps/web/src/components/chatgpt-shell/ChatGptShell.tsx:1-39 | React hook (useState/useEffect/useRef/useMemo/useCallback…) | SAX: no behavior counterpart | state fields declared in <state>; hook bodies dropped to DEFECT/fn stubs
apps/web/src/components/chatgpt-shell/ChatGptShell.tsx:67-90 | JSX event handler prop (onClick/onChange/…) | SAX: no behavior counterpart | simple identifiers kept as onclick={^handler}; complex handlers as bind comment
apps/web/src/components/chatgpt-shell/ChatGptShell.tsx:47-90 | {expr} expression binding in JSX | SAX: no expression evaluation | replaced by <!-- bind: expr --> comment, structure preserved
apps/web/src/components/chatgpt-shell/ChatGptShell.tsx:63-88 | conditional rendering (&& / ternary) | SAX: no behavior counterpart | both branches kept in tree order with bind comment
apps/web/src/components/chatgpt-shell/ChatGptShell.tsx:75 | list rendering via .map() | SAX: no behavior counterpart | single item template kept; repetition marked by bind comment
apps/web/src/components/chatgpt-shell/ChatGptShell.tsx:1-4 | external package import (three/monaco/xterm/MUI/lucide/etc.) | external component/renderer has no SAX counterpart | imported component tags kept 1:1 as elements; renderer noted as DEFECT
apps/web/src/components/icons/DiscordIcon.tsx:5 | {expr} expression binding in JSX | SAX: no expression evaluation | replaced by <!-- bind: expr --> comment, structure preserved
apps/web/src/components/icons/DiscordIcon.tsx:1 | external package import (three/monaco/xterm/MUI/lucide/etc.) | external component/renderer has no SAX counterpart | imported component tags kept 1:1 as elements; renderer noted as DEFECT
