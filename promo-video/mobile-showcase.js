/**
 * AGENT BOARD — Mobile Remote Control, Multi-Session Switching, Work Anywhere & Voice Input Showcase
 * 1920x1080 · 60 FPS · 15.0s · 4 Languages (zh-CN / zh-TW / en-US / ja-JP)
 * Matches actual Agent Board desktop & mobile responsive UI (src/App.tsx, src/SessionCard.tsx, src/InteractionPanel.tsx, src/ChatComposer.tsx)
 */

const I18N = {
  'zh-CN': {
    pageTitle: 'Agent Board - 手机扫码连接 · 多会话切换 · 随处移动办公 · 语音输入演示',
    brandTitle: 'AGENT BOARD // 手机远程 · 多会话切换 · 语音输入演示',
    brandBadge: '竖屏手机原生体验 · 多会话切换 · 语音直达',
    switchDesktop: '🖥️ 桌面看板演示',
    switchMobile: '📱 手机远程与语音',
    statusReady: (fps, dur) => `状态: 就绪 [${dur}s · ${fps} FPS]`,
    statusRecording: '状态: 正在录制 1080p 视频...',
    statusComplete: '状态: 导出完毕！',
    play: '▶ 播放',
    pause: '⏸ 暂停',
    restart: '↺ 重播',
    soundOn: '🔊 音效: 开',
    soundOff: '🔇 音效: 关',
    snapshot: '📸 截屏 (1080p PNG)',
    exportVideo: '📥 导出 1080p 视频',
    exportingVideo: '⏳ 正在录制 1080p 视频...',
    chapters: [
      { t: 0, label: '① 手机扫码极速连接' },
      { t: 3.0, label: '② 多会话切换与随处办公' },
      { t: 6.8, label: '③ 语音输入 (多语言识别)' },
      { t: 10.6, label: '④ 手机审批与双向同步' },
      { t: 13.2, label: '⑤ 移动办公全开源' }
    ],

    // Exact App Topbar & Toolbar strings (from src/i18n/locales/zh-CN.ts)
    topbarSub: '原生会话 · 同屏掌握',
    connected: '本机已连接',
    remoteBtn: '📱 手机远程',
    tabActive: '会话看板',
    tabArchived: '已收纳会话',
    filterSource: '来源: 全部来源 ▾',
    filterStatus: '状态: 全部状态 ▾',
    totalSessions: '3 个会话',
    refreshBtn: '↻ 刷新',
    boardHeading: '你的 AI 工作现场',
    boardSubheading: '自动读取原生记录 · 随日志落盘更新',
    markRead: '✓ 标记已读',
    archive: '收纳',
    interact: '交互',
    interactUrgent: '⚡ 交互',
    backToBoard: '← 返回列表',
    newUnread: '新增未读',
    completedUnread: '完成未读',
    stateRunning: '执行中',
    stateWaiting: '待确认',
    stateCompleted: '已完成',
    phoneSyncTag: '📱 手机端当前打开',

    // PWA Banner on Mobile
    pwaTitle: '📲 保存为手机桌面 App',
    pwaDesc: '添加到主屏幕即可全屏秒开，免重复扫码',
    pwaInstall: '立即安装',

    // RemoteControlModal
    qrModalTitle: '通过其他设备远程控制',
    qrModalSub: '使用手机扫描二维码打开此界面，远程启动与管理当前电脑上的所有会话。',
    modeLan: '局域网 / Tailscale',
    modeTunnel: '公网 HTTPS 隧道',
    modeCustom: '自定义域名',
    deviceBadge: '💻 Dev-Workstation · 一次扫码永久免密',
    netInterface: '[Tailscale] 100.101.42.18 (跨网固定 IP 直连) ▾',
    tunnelReady: '● 已连通 Cloudflare 公网 HTTPS 隧道 (5G 异地直连)',
    scanPrompt: '📱 手机相机对准二维码 · 1秒自动配对',
    scanSuccess: '✓ 配对成功！已同步本机 3 个活跃会话',

    // Anywhere Scenes Banner
    anywhereHeader: '🌍 任何地方都能方便工作 · 手机端随时切换并掌控所有 AI 会话',
    scenes: [
      { icon: '🏠', title: '室内同 Wi-Fi', desc: '局域网零配置扫码即连 · 延迟 < 5ms', tag: 'LAN Direct' },
      { icon: '🚄', title: '通勤 / 差旅高铁', desc: 'Tailscale 虚拟专网固定 IP · 永久免重扫', tag: 'Tailscale P2P' },
      { icon: '☕', title: '咖啡厅 / 户外 5G', desc: '一键开启公网 HTTPS 加密隧道 · 零安装访问', tag: 'HTTPS Tunnel' }
    ],

    // 3 Sessions Data (matching Desktop & Mobile)
    s1Title: '修复 Stripe Webhook 幂等性校验',
    s1Project: '📁 payment-api',
    s1User: '排查偶发重复扣款问题，补齐 Redis 幂等锁与重试测试。',
    s1Tool: '运行命令 npm test -- test/webhook.spec.ts',
    s1Ai: '已定位并发竞争条件，正在执行 12 组幂等回归测试 (PASS 12/12)…',

    s2Title: '重构认证中间件与 JWT 鉴权',
    s2Project: '📁 agent-board',
    s2User: '请重构 src/auth/jwt.ts，切换为异步 RS256 签名校验。',
    s2Tool: '修改文件 src/auth/jwt.ts (+42 -18)',
    s2AiWait: '已完成 RS256 异步验签改造，等待确认写入并运行测试。',

    s3Title: '适配移动端响应式布局与语音输入',
    s3Project: '📁 mobile-pwa',
    s3User: '优化竖屏手机全屏会话弹层与 Web Speech 语音听写体验。',
    s3Tool: '修改文件 src/ChatComposer.tsx (+68 -12)',
    s3Ai: '已完成移动端 100dvh 响应式会话视图与多语言语音输入适配。',

    // InteractionPanel & ChatComposer on Phone
    phaseWaiting: '等待确认',
    phaseRunning: '执行中',
    phaseCompleted: '本次执行已完成',
    keepOpenHint: '原客户端保持打开即可',
    approvalTitle: '⚡ 请求执行测试并写入 src/auth/jwt.ts',
    btnDeny: '拒绝本次',
    btnAllow: '✓ 允许本次',
    approvedBanner: '✓ 已允许本次操作 · 原会话已继续执行',
    composerLabel: '继续此会话',
    composerPlaceholder: '输入你的下一步要求…',
    composerHint: 'Enter 发送 · Shift+Enter 换行',
    attachBtn: '📎 添加附件',
    voiceBtnIdle: '🎙️ 语音输入',
    voiceBtnActive: '🎙️ 停止识别',
    voiceListening: '● 正在聆听，请说话…',
    voiceLangPills: ['中文', 'EN', '日本語', '繁體'],
    voiceTranscript: '请补充过期 Token 与无效签名的边界单元测试，并运行全量测试验证。',
    btnSend: '发送',
    aiReplyAfterVoice: '✅ 已补充 6 组 RS256 边界单元测试，18 项测试全部通过 (exit 0)。',

    subtitles: [
      {
        tEnd: 3.0,
        text: '① 手机扫码极速连接：点击右上角【📱 手机远程】扫码即连，支持保存为手机主屏幕 App (PWA)',
        sub: '一次扫码永久免密登录 · 手机竖屏原生展示当前电脑上的全部活跃 AI 会话'
      },
      {
        tEnd: 6.8,
        text: '② 多会话自由切换 & 随处办公：在手机列表点击【交互】查看详情，点击【← 返回列表】秒切其他会话',
        sub: '支持室内 Wi-Fi 局域网、通勤 Tailscale 固定 IP 与户外 5G 公网 HTTPS 隧道，随时随地切换掌控所有任务'
      },
      {
        tEnd: 10.6,
        text: '③ 支持语音输入与多语言识别：点击【🎙️ 语音输入】直接说话，实时精准转为指令文字',
        sub: '原生支持中文、English、日本語等多语言语音听写，出门在外单手也能轻松下达复杂研发指令'
      },
      {
        tEnd: 13.2,
        text: '④ 掌上远程审批与双向实时同步：手机端发送语音指令并点击【✓ 允许本次】，电脑端毫秒级同步',
        sub: '手机端操作与左侧电脑端 Codex / Claude / Antigravity 卡片实时双向联动，毫无延迟'
      },
      {
        tEnd: 15.0,
        text: '⚡ 扫码即连 · 多会话切换 · 随处办公 · 语音直达 —— 把 AI 工作台装进口袋',
        sub: 'npm install && npm run build && npm start  |  100% 开源 · 本地优先 · 安全可控'
      }
    ],

    outroTitle: '扫码即连 · 多会话切换 · 语音直达',
    outroSubtitle: 'Agent Board Mobile —— 竖屏原生体验，随时随地用语音掌控所有本地 AI 智能体',
    outroBadge: '📱 竖屏多会话秒切 · 🌍 Wi-Fi / Tailscale / 5G 随行 · 🎙️ 多语言实时语音输入',
    outroCommand: '> npm install && npm run build && npm start',
    outroFootnote: '支持 iOS / Android 全屏桌面 App (PWA) · 与电脑端 Codex / Claude / Antigravity 实时双向同步'
  },

  'en-US': {
    pageTitle: 'Agent Board - Mobile Connect, Multi-Session Switch, Work Anywhere & Voice Input',
    brandTitle: 'AGENT BOARD // Mobile Connect · Multi-Session · Voice Input',
    brandBadge: 'PORTRAIT MOBILE UI · MULTI-SESSION · VOICE INPUT',
    switchDesktop: '🖥️ Desktop Board',
    switchMobile: '📱 Mobile & Voice',
    statusReady: (fps, dur) => `STATUS: READY [${dur}s · ${fps} FPS]`,
    statusRecording: 'STATUS: RECORDING 1080p VIDEO...',
    statusComplete: 'STATUS: EXPORT COMPLETE!',
    play: '▶ Play',
    pause: '⏸ Pause',
    restart: '↺ Restart',
    soundOn: '🔊 Sound: On',
    soundOff: '🔇 Sound: Off',
    snapshot: '📸 Snapshot (1080p PNG)',
    exportVideo: '📥 Export 1080p Video',
    exportingVideo: '⏳ Recording 1080p Video...',
    chapters: [
      { t: 0, label: '① Instant QR Connect' },
      { t: 3.0, label: '② Multi-Session & Anywhere' },
      { t: 6.8, label: '③ Multilingual Voice Input' },
      { t: 10.6, label: '④ Mobile Approve & Sync' },
      { t: 13.2, label: '⑤ Open-Source PWA' }
    ],

    topbarSub: 'Native Sessions · All in One View',
    connected: 'Connected locally',
    remoteBtn: '📱 Mobile Remote',
    tabActive: 'Active Board',
    tabArchived: 'Stowed Sessions',
    filterSource: 'Source: All Sources ▾',
    filterStatus: 'Status: All Statuses ▾',
    totalSessions: '3 sessions',
    refreshBtn: '↻ Refresh',
    boardHeading: 'Your AI Workspace',
    boardSubheading: 'Auto-reading native records · Live disk updates',
    markRead: '✓ Mark as Read',
    archive: 'Stow',
    interact: 'Interact',
    interactUrgent: '⚡ Interact',
    backToBoard: '← Sessions',
    newUnread: 'New Unread',
    completedUnread: 'Completed Unread',
    stateRunning: 'Running',
    stateWaiting: 'Waiting Approval',
    stateCompleted: 'Completed',
    phoneSyncTag: '📱 Active on Phone',

    pwaTitle: '📲 Save as Mobile Desktop App',
    pwaDesc: 'Add to Home Screen for full-screen launch without re-scanning',
    pwaInstall: 'Install',

    qrModalTitle: 'Remote Control from Another Device',
    qrModalSub: 'Scan QR code with your phone to view, switch, and control all sessions on this PC.',
    modeLan: 'LAN / Tailscale',
    modeTunnel: 'Public HTTPS Tunnel',
    modeCustom: 'Custom Domain',
    deviceBadge: '💻 Dev-Workstation · Scan Once Forever',
    netInterface: '[Tailscale] 100.101.42.18 (Permanent Mesh IP) ▾',
    tunnelReady: '● Connected via Cloudflare HTTPS Tunnel (5G Anywhere)',
    scanPrompt: '📱 Point Phone Camera at QR Code · 1s Pairing',
    scanSuccess: '✓ Paired! All 3 Active Sessions Synced to Phone',

    anywhereHeader: '🌍 Work From Anywhere — Switch & Control All AI Sessions on Your Portrait Phone',
    scenes: [
      { icon: '🏠', title: 'Indoor Wi-Fi', desc: 'Zero-config LAN direct · < 5ms latency', tag: 'LAN Direct' },
      { icon: '🚄', title: 'Commute / Train', desc: 'Tailscale permanent IP · Never re-scan QR', tag: 'Tailscale P2P' },
      { icon: '☕', title: 'Cafe / Outdoor 5G', desc: '1-click Public HTTPS Tunnel · Zero install', tag: 'HTTPS Tunnel' }
    ],

    s1Title: 'Fix Stripe Webhook Idempotency Lock',
    s1Project: '📁 payment-api',
    s1User: 'Investigate duplicate charge race condition and add Redis lock tests.',
    s1Tool: 'Run command npm test -- test/webhook.spec.ts',
    s1Ai: 'Race condition fixed. Running 12 idempotency regression tests (PASS 12/12)…',

    s2Title: 'Refactor Auth Middleware & JWT',
    s2Project: '📁 agent-board',
    s2User: 'Refactor src/auth/jwt.ts to use async RS256 signature verification.',
    s2Tool: 'Modify file src/auth/jwt.ts (+42 -18)',
    s2AiWait: 'Async RS256 verification ready. Waiting approval to write & run tests.',

    s3Title: 'Mobile Responsive Layout & Voice Input',
    s3Project: '📁 mobile-pwa',
    s3User: 'Polish portrait phone full-screen dialog and Web Speech voice dictation.',
    s3Tool: 'Modify file src/ChatComposer.tsx (+68 -12)',
    s3Ai: 'Completed 100dvh mobile session dialog and multilingual voice dictation.',

    phaseWaiting: 'Waiting Approval',
    phaseRunning: 'Running',
    phaseCompleted: 'Completed',
    keepOpenHint: 'Keep original client open',
    approvalTitle: '⚡ Run auth tests & write src/auth/jwt.ts',
    btnDeny: 'Deny',
    btnAllow: '✓ Allow',
    approvedBanner: '✓ Approved on phone · Host session resumed',
    composerLabel: 'Continue this session',
    composerPlaceholder: 'Type your next instruction…',
    composerHint: 'Enter to send · Shift+Enter for newline',
    attachBtn: '📎 Attach files',
    voiceBtnIdle: '🎙️ Voice input',
    voiceBtnActive: '🎙️ Stop listening',
    voiceListening: '● Listening, please speak…',
    voiceLangPills: ['EN', '中文', '日本語', '繁體'],
    voiceTranscript: 'Add unit tests for expired RS256 tokens and invalid signatures, then run all tests.',
    btnSend: 'Send',
    aiReplyAfterVoice: '✅ Added 6 RS256 edge-case unit tests; all 18 tests pass (exit 0).',

    subtitles: [
      {
        tEnd: 3.0,
        text: '① Easy Mobile Connection: Click [📱 Mobile Remote] and scan QR code to open the mobile board',
        sub: 'Save to Home Screen as a full-screen PWA · View all active PC sessions on your portrait phone'
      },
      {
        tEnd: 6.8,
        text: '② Multi-Session Switching & Work Anywhere: Tap [Interact] to inspect a session, or [← Sessions] to switch',
        sub: 'Seamlessly switch between Claude, Codex, and Antigravity over Wi-Fi, Tailscale, or 5G HTTPS Tunnel'
      },
      {
        tEnd: 10.6,
        text: '③ Multilingual Voice Input: Tap [🎙️ Voice input] to dictate prompts hands-free with live speech-to-text',
        sub: 'Supports English, Chinese, and Japanese voice recognition right inside the mobile session composer'
      },
      {
        tEnd: 13.2,
        text: '④ Mobile Approval & Live 2-Way Sync: Send voice prompt and tap [✓ Allow] — PC card updates instantly',
        sub: 'Every action on your phone syncs in real time with the corresponding session card on your desktop'
      },
      {
        tEnd: 15.0,
        text: '⚡ Scan to Connect · Multi-Session Switch · Work Anywhere · Voice Input',
        sub: 'npm install && npm run build && npm start  |  100% Open Source · Local-First · Privacy-Safe'
      }
    ],

    outroTitle: 'Scan to Connect · Multi-Session · Voice Input',
    outroSubtitle: 'Agent Board Mobile — Switch & Control All Local Coding Agents From Your Portrait Phone',
    outroBadge: '📱 Portrait Multi-Session UI · 🌍 Wi-Fi / Tailscale / 5G · 🎙️ Multilingual Voice Input',
    outroCommand: '> npm install && npm run build && npm start',
    outroFootnote: 'Full-Screen iOS & Android PWA · Real-time 2-way sync with Codex / Claude / Antigravity'
  },

  'zh-TW': {
    pageTitle: 'Agent Board - 手機掃碼連線 · 多工作階段切換 · 隨處辦公 · 語音輸入展示',
    brandTitle: 'AGENT BOARD // 手機遠端 · 多工作階段切換 · 語音輸入展示',
    brandBadge: '直向手機原生體驗 · 多工作階段切換 · 語音直達',
    switchDesktop: '🖥️ 桌面看板展示',
    switchMobile: '📱 手機遠端與語音',
    statusReady: (fps, dur) => `狀態: 就緒 [${dur}s · ${fps} FPS]`,
    statusRecording: '狀態: 正在錄製 1080p 影片...',
    statusComplete: '狀態: 匯出完畢！',
    play: '▶ 播放',
    pause: '⏸ 暫停',
    restart: '↺ 重播',
    soundOn: '🔊 音效: 開',
    soundOff: '🔇 音效: 關',
    snapshot: '📸 截圖 (1080p PNG)',
    exportVideo: '📥 匯出 1080p 影片',
    exportingVideo: '⏳ 正在錄製 1080p 影片...',
    chapters: [
      { t: 0, label: '① 手機掃碼極速連線' },
      { t: 3.0, label: '② 多工作階段切換與隨處辦公' },
      { t: 6.8, label: '③ 語音輸入 (多語言辨識)' },
      { t: 10.6, label: '④ 手機審批與雙向同步' },
      { t: 13.2, label: '⑤ 行動辦公全開源' }
    ],

    topbarSub: '原生工作階段 · 同螢幕掌握',
    connected: '本機已連線',
    remoteBtn: '📱 手機遠端',
    tabActive: '工作階段看板',
    tabArchived: '已收納工作階段',
    filterSource: '來源: 全部來源 ▾',
    filterStatus: '狀態: 全部狀態 ▾',
    totalSessions: '3 個工作階段',
    refreshBtn: '↻ 重新整理',
    boardHeading: '你的 AI 工作現場',
    boardSubheading: '自動讀取原生記錄 · 隨日誌落盤更新',
    markRead: '✓ 標記已讀',
    archive: '收納',
    interact: '互動',
    interactUrgent: '⚡ 互動',
    backToBoard: '← 返回列表',
    newUnread: '新增未讀',
    completedUnread: '完成未讀',
    stateRunning: '執行中',
    stateWaiting: '待確認',
    stateCompleted: '已完成',
    phoneSyncTag: '📱 手機端目前開啟',

    pwaTitle: '📲 儲存為手機桌面 App',
    pwaDesc: '加入主畫面即可全螢幕秒開，免重複掃碼',
    pwaInstall: '立即安裝',

    qrModalTitle: '透過其他裝置遠端控制',
    qrModalSub: '使用手機掃描 QR Code 開啟此介面，遠端啟動與管理目前電腦上的所有工作階段。',
    modeLan: '區域網路 / Tailscale',
    modeTunnel: '公網 HTTPS 通道',
    modeCustom: '自訂網域',
    deviceBadge: '💻 Dev-Workstation · 一次掃碼永久免密',
    netInterface: '[Tailscale] 100.101.42.18 (跨網固定 IP 直連) ▾',
    tunnelReady: '● 已連通 Cloudflare 公網 HTTPS 通道 (5G 異地直連)',
    scanPrompt: '📱 手機相機對準 QR Code · 1秒自動配對',
    scanSuccess: '✓ 配對成功！已同步本機 3 個活躍工作階段',

    anywhereHeader: '🌍 任何地方都能方便工作 · 手機端隨時切換並掌控所有 AI 工作階段',
    scenes: [
      { icon: '🏠', title: '室內同 Wi-Fi', desc: '區域網路零設定掃碼即連 · 延遲 < 5ms', tag: 'LAN Direct' },
      { icon: '🚄', title: '通勤 / 差旅高鐵', desc: 'Tailscale 虛擬專網固定 IP · 永久免重掃', tag: 'Tailscale P2P' },
      { icon: '☕', title: '咖啡廳 / 戶外 5G', desc: '一鍵開啟公網 HTTPS 加密通道 · 零安裝存取', tag: 'HTTPS Tunnel' }
    ],

    s1Title: '修復 Stripe Webhook 冪等性校驗',
    s1Project: '📁 payment-api',
    s1User: '排查偶發重複扣款問題，補齊 Redis 冪等鎖與重試測試。',
    s1Tool: '執行命令 npm test -- test/webhook.spec.ts',
    s1Ai: '已定位並發競爭條件，正在執行 12 組冪等回歸測試 (PASS 12/12)…',

    s2Title: '重構認證中介軟體與 JWT 鑑權',
    s2Project: '📁 agent-board',
    s2User: '請重構 src/auth/jwt.ts，切換為非同步 RS256 簽章校驗。',
    s2Tool: '修改檔案 src/auth/jwt.ts (+42 -18)',
    s2AiWait: '已完成 RS256 非同步驗簽改造，等待確認寫入並執行測試。',

    s3Title: '適配行動端響應式佈局與語音輸入',
    s3Project: '📁 mobile-pwa',
    s3User: '最佳化直向手機全螢幕工作階段彈層與 Web Speech 語音聽寫體驗。',
    s3Tool: '修改檔案 src/ChatComposer.tsx (+68 -12)',
    s3Ai: '已完成行動端 100dvh 響應式工作階段視圖與多語言語音輸入適配。',

    phaseWaiting: '等待確認',
    phaseRunning: '執行中',
    phaseCompleted: '本次執行已完成',
    keepOpenHint: '原用戶端保持開啟即可',
    approvalTitle: '⚡ 請求執行測試並寫入 src/auth/jwt.ts',
    btnDeny: '拒絕本次',
    btnAllow: '✓ 允許本次',
    approvedBanner: '✓ 已允許本次操作 · 原工作階段已繼續執行',
    composerLabel: '繼續此工作階段',
    composerPlaceholder: '輸入你的下一步要求…',
    composerHint: 'Enter 傳送 · Shift+Enter 換行',
    attachBtn: '📎 新增附件',
    voiceBtnIdle: '🎙️ 語音輸入',
    voiceBtnActive: '🎙️ 停止辨識',
    voiceListening: '● 正在聆聽，請說話…',
    voiceLangPills: ['繁體', '簡中', 'EN', '日本語'],
    voiceTranscript: '請補充過期 Token 與無效簽章的邊界單元測試，並執行全量測試驗證。',
    btnSend: '傳送',
    aiReplyAfterVoice: '✅ 已補充 6 組 RS256 邊界單元測試，18 項測試全部通過 (exit 0)。',

    subtitles: [
      {
        tEnd: 3.0,
        text: '① 手機掃碼極速連線：點擊右上角【📱 手機遠端】掃碼即連，支援儲存為手機主畫面 App (PWA)',
        sub: '一次掃碼永久免密登入 · 手機直向原生展示目前電腦上的全部活躍 AI 工作階段'
      },
      {
        tEnd: 6.8,
        text: '② 多工作階段自由切換 & 隨處辦公：在手機列表點擊【互動】查看詳情，點擊【← 返回列表】秒切其他任務',
        sub: '支援室內 Wi-Fi 區域網路、通勤 Tailscale 固定 IP 與戶外 5G 公網 HTTPS 通道，隨時隨地切換掌控所有任務'
      },
      {
        tEnd: 10.6,
        text: '③ 支援語音輸入與多語言辨識：點擊【🎙️ 語音輸入】直接說話，即時精準轉為指令文字',
        sub: '原生支援繁中、簡中、English、日本語等多語言語音聽寫，出門在外單手也能輕鬆下達複雜研發指令'
      },
      {
        tEnd: 13.2,
        text: '④ 掌上遠端審批與雙向即時同步：手機端傳送語音指令並點擊【✓ 允許本次】，電腦端毫秒級同步',
        sub: '手機端操作與左側電腦端 Codex / Claude / Antigravity 卡片即時雙向連動，毫無延遲'
      },
      {
        tEnd: 15.0,
        text: '⚡ 掃碼即連 · 多工作階段切換 · 隨處辦公 · 語音直達 —— 把 AI 工作台裝進口袋',
        sub: 'npm install && npm run build && npm start  |  100% 開源 · 本機優先 · 安全可控'
      }
    ],

    outroTitle: '掃碼即連 · 多工作階段切換 · 語音直達',
    outroSubtitle: 'Agent Board Mobile —— 直向原生體驗，隨時隨地用語音掌控所有本機 AI 智能體',
    outroBadge: '📱 直向多工作階段秒切 · 🌍 Wi-Fi / Tailscale / 5G 隨行 · 🎙️ 多語言即時語音輸入',
    outroCommand: '> npm install && npm run build && npm start',
    outroFootnote: '支援 iOS / Android 全螢幕桌面 App (PWA) · 與電腦端 Codex / Claude / Antigravity 即時雙向同步'
  },

  'ja-JP': {
    pageTitle: 'Agent Board - スマホ QR 接続・複数セッション切替・どこでも作業・音声入力',
    brandTitle: 'AGENT BOARD // スマホ遠隔・複数セッション切替・音声入力',
    brandBadge: '縦画面スマホ UI · 複数セッション切替 · 音声入力',
    switchDesktop: '🖥️ デスクトップ版',
    switchMobile: '📱 モバイル＆音声',
    statusReady: (fps, dur) => `状態: 準備完了 [${dur}s · ${fps} FPS]`,
    statusRecording: '状態: 1080p 動画を録画中...',
    statusComplete: '状態: エクスポート完了！',
    play: '▶ 再生',
    pause: '⏸ 一時停止',
    restart: '↺ リスタート',
    soundOn: '🔊 音声: ON',
    soundOff: '🔇 音声: OFF',
    snapshot: '📸 スナップショット (1080p PNG)',
    exportVideo: '📥 1080p 動画を書き出す',
    exportingVideo: '⏳ 1080p 動画を録画中...',
    chapters: [
      { t: 0, label: '① QR スキャン即時接続' },
      { t: 3.0, label: '② 複数セッション切替＆外出先作業' },
      { t: 6.8, label: '③ 多言語・音声入力' },
      { t: 10.6, label: '④ スマホ承認＆双方向同期' },
      { t: 13.2, label: '⑤ オープンソース PWA' }
    ],

    topbarSub: 'ネイティブセッション · 一画面で把握',
    connected: 'ローカル接続済み',
    remoteBtn: '📱 モバイル遠隔',
    tabActive: 'セッション看板',
    tabArchived: '保管済みセッション',
    filterSource: 'ソース: すべて ▾',
    filterStatus: 'ステータス: すべて ▾',
    totalSessions: '3 件のセッション',
    refreshBtn: '↻ 更新',
    boardHeading: 'あなたの AI ワークスペース',
    boardSubheading: 'ネイティブログを自動取得 · リアルタイム反映',
    markRead: '✓ 既読にする',
    archive: '保管',
    interact: '対話',
    interactUrgent: '⚡ 対話',
    backToBoard: '← 一覧へ戻る',
    newUnread: '新規未読',
    completedUnread: '完了未読',
    stateRunning: '実行中',
    stateWaiting: '承認待ち',
    stateCompleted: '完了',
    phoneSyncTag: '📱 スマホで表示中',

    pwaTitle: '📲 ホーム画面アプリ (PWA) として保存',
    pwaDesc: 'ホーム画面に追加すると再スキャン不要でフルスクリーン起動',
    pwaInstall: '追加する',

    qrModalTitle: '他のデバイスからリモート操作',
    qrModalSub: 'スマホで QR コードを読み取り、この PC 上の全セッションを外出先から確認・操作できます。',
    modeLan: 'LAN / Tailscale',
    modeTunnel: '公開 HTTPS トンネル',
    modeCustom: 'カスタムドメイン',
    deviceBadge: '💻 Dev-Workstation · 再スキャン不要',
    netInterface: '[Tailscale] 100.101.42.18 (固定 IP 直結) ▾',
    tunnelReady: '● Cloudflare 公開 HTTPS トンネル接続済み (5G 外出先対応)',
    scanPrompt: '📱 スマホカメラで QR コードをスキャン · 1秒で接続',
    scanSuccess: '✓ 接続完了！3 件のアクティブセッションを同期',

    anywhereHeader: '🌍 どこでも快適に作業 —— 縦画面スマホで複数の AI セッションを自在に切り替え',
    scenes: [
      { icon: '🏠', title: '室内 Wi-Fi', desc: '設定ゼロで LAN 高速直結 · 遅延 < 5ms', tag: 'LAN Direct' },
      { icon: '🚄', title: '通勤・移動中', desc: 'Tailscale 固定 IP で再スキャン不要・常時接続', tag: 'Tailscale P2P' },
      { icon: '☕', title: 'カフェ・外出先 5G', desc: 'ワンクリック公開 HTTPS トンネル · アプリ不要', tag: 'HTTPS Tunnel' }
    ],

    s1Title: 'Stripe Webhook べき等性チェックの修正',
    s1Project: '📁 payment-api',
    s1User: '重複決済の競合状態を調査し、Redis ロックのテストを追加。',
    s1Tool: 'コマンド実行 npm test -- test/webhook.spec.ts',
    s1Ai: '競合箇所を特定・修正し、12 件の回帰テストを実行中 (PASS 12/12)…',

    s2Title: '認証ミドルウェアと JWT 認可の改修',
    s2Project: '📁 agent-board',
    s2User: 'src/auth/jwt.ts を非同期 RS256 署名検証へ改修してください。',
    s2Tool: 'ファイルを変更 src/auth/jwt.ts (+42 -18)',
    s2AiWait: '非同期 RS256 検証への改修完了。書き込みとテスト実行の承認待ち。',

    s3Title: 'モバイル縦画面レイアウトと音声入力対応',
    s3Project: '📁 mobile-pwa',
    s3User: '縦画面スマホのフルスクリーン対話画面と音声入力 UI を最適化。',
    s3Tool: 'ファイルを変更 src/ChatComposer.tsx (+68 -12)',
    s3Ai: 'モバイル 100dvh レスポンシブ画面と多言語音声入力の実装が完了。',

    phaseWaiting: '承認待ち',
    phaseRunning: '実行中',
    phaseCompleted: '実行完了',
    keepOpenHint: '元のクライアントを開いたままにしてください',
    approvalTitle: '⚡ テスト実行と src/auth/jwt.ts への書き込み',
    btnDeny: '拒否',
    btnAllow: '✓ 許可',
    approvedBanner: '✓ スマホから承認完了 · セッション再開',
    composerLabel: 'このセッションを続行',
    composerPlaceholder: '次の指示を入力…',
    composerHint: 'Enterで送信 · Shift+Enterで改行',
    attachBtn: '📎 ファイルを添付',
    voiceBtnIdle: '🎙️ 音声入力',
    voiceBtnActive: '🎙️ 音声入力を停止',
    voiceListening: '● 聞き取り中、話してください…',
    voiceLangPills: ['日本語', 'EN', '中国語', '繁體'],
    voiceTranscript: '期限切れトークンと不正署名の単体テストを追加し、全テストを実行してください。',
    btnSend: '送信',
    aiReplyAfterVoice: '✅ RS256 境界テスト 6 件を追加し、全 18 テストが通過しました (exit 0)。',

    subtitles: [
      {
        tEnd: 3.0,
        text: '① スマホで簡単接続：右上の【📱 モバイル遠隔】から QR スキャンでスマホ版ボードを即座に表示',
        sub: 'ホーム画面アプリ (PWA) として保存可能 · PC 上の全セッションを縦画面スマホで一覧把握'
      },
      {
        tEnd: 6.8,
        text: '② 複数セッション切替＆どこでも作業：【対話】で詳細を開き、【← 一覧へ戻る】で別セッションへ即切替',
        sub: '室内 Wi-Fi・通勤中の Tailscale・外出先 5G の公開 HTTPS トンネルで、どこからでも全タスクを操作'
      },
      {
        tEnd: 10.6,
        text: '③ 音声入力＆多言語認識：【🎙️ 音声入力】をタップして話すだけでリアルタイムにテキスト化',
        sub: '日本語・英語・中国語の音声認識に対応し、移動中でも片手で素早く的確な指示を送れます'
      },
      {
        tEnd: 13.2,
        text: '④ スマホ承認＆双方向リアルタイム同期：音声指示の送信や【✓ 許可】が PC 側カードへ即座に反映',
        sub: 'スマホでの操作は左側の PC デスクトップ上の Codex / Claude / Antigravity とミリ秒単位で同期'
      },
      {
        tEnd: 15.0,
        text: '⚡ QR 即時接続 · 複数セッション切替 · どこでも作業 · 音声入力',
        sub: 'npm install && npm run build && npm start  |  100% オープンソース · ローカル優先'
      }
    ],

    outroTitle: 'QR 即時接続 · 複数セッション切替 · 音声入力',
    outroSubtitle: 'Agent Board Mobile —— 縦画面スマホでローカル AI エージェントをどこからでも自在に操作',
    outroBadge: '📱 縦画面・複数セッション切替 · 🌍 Wi-Fi / Tailscale / 5G · 🎙️ 多言語リアルタイム音声入力',
    outroCommand: '> npm install && npm run build && npm start',
    outroFootnote: 'iOS / Android フルスクリーン PWA 対応 · PC の Codex / Claude / Antigravity とリアルタイム双方向同期'
  }
};

I18N['en'] = I18N['en-US'];
I18N['zh'] = I18N['zh-CN'];
I18N['zh-tw'] = I18N['zh-TW'];
I18N['ja'] = I18N['ja-JP'];

function detectInitialLocale() {
  const urlParams = new URLSearchParams(window.location.search);
  const qLang = urlParams.get('lang');
  if (qLang) {
    const key = qLang.toLowerCase();
    if (I18N[key]) return key === 'en' ? 'en-US' : key === 'zh' ? 'zh-CN' : key === 'zh-tw' ? 'zh-TW' : key === 'ja' ? 'ja-JP' : key;
    if (I18N[qLang]) return qLang;
  }
  const saved = localStorage.getItem('agent_board_promo_lang');
  if (saved && I18N[saved]) return saved;
  const browserLang = navigator.language || navigator.userLanguage || '';
  if (/^ja/i.test(browserLang)) return 'ja-JP';
  if (/^zh-TW|^zh-HK|^zh-MO/i.test(browserLang)) return 'zh-TW';
  if (/^zh/i.test(browserLang)) return 'zh-CN';
  return 'zh-CN';
}

let currentLocale = detectInitialLocale();
function getStrings() {
  return I18N[currentLocale] || I18N['zh-CN'];
}

const CODEX_SVG_PATH = new Path2D("M9.205 8.658v-2.26c0-.19.072-.333.238-.428l4.543-2.616c.619-.357 1.356-.523 2.117-.523 2.854 0 4.662 2.212 4.662 4.566 0 .167 0 .357-.024.547l-4.71-2.759a.797.797 0 00-.856 0l-5.97 3.473zm10.609 8.8V12.06c0-.333-.143-.57-.429-.737l-5.97-3.473 1.95-1.118a.433.433 0 01.476 0l4.543 2.617c1.309.76 2.189 2.378 2.189 3.948 0 1.808-1.07 3.473-2.76 4.163zM7.802 12.703l-1.95-1.142c-.167-.095-.239-.238-.239-.428V5.899c0-2.545 1.95-4.472 4.591-4.472 1 0 1.927.333 2.712.928L8.23 5.067c-.285.166-.428.404-.428.737v6.898zM12 15.128l-2.795-1.57v-3.33L12 8.658l2.795 1.57v3.33L12 15.128zm1.796 7.23c-1 0-1.927-.332-2.712-.927l4.686-2.712c.285-.166.428-.404.428-.737v-6.898l1.974 1.142c.167.095.238.238.238.428v5.233c0 2.545-1.974 4.472-4.614 4.472zm-5.637-5.303l-4.544-2.617c-1.308-.761-2.188-2.378-2.188-3.948A4.482 4.482 0 014.21 6.327v5.423c0 .333.143.571.428.738l5.947 3.449-1.95 1.118a.432.432 0 01-.476 0zm-.262 3.9c-2.688 0-4.662-2.021-4.662-4.519 0-.19.024-.38.047-.57l4.686 2.71c.286.167.571.167.856 0l5.97-3.448v2.26c0 .19-.07.333-.237.428l-4.543 2.616c-.619.357-1.356.523-2.117.523zm5.899 2.83a5.947 5.947 0 005.827-4.756C22.287 18.339 24 15.84 24 13.296c0-1.665-.713-3.282-1.998-4.448.119-.5.19-.999.19-1.498 0-3.401-2.759-5.947-5.946-5.946-.642 0-1.26.095-1.88.31A5.962 5.962 0 0010.205 0a5.947 5.947 0 00-5.827 4.757C1.713 5.447 0 7.945 0 10.49c0 1.666.713 3.283 1.998 4.448-.119.5-.19 1-.19 1.499 0 3.401 2.759 5.946 5.946 5.946.642 0 1.26-.095 1.88-.309a5.96 5.96 0 004.162 1.713z");
const CLAUDE_SVG_PATH = new Path2D("M4.709 15.955l4.72-2.647.08-.23-.08-.128H9.2l-.79-.048-2.698-.073-2.339-.097-2.266-.122-.571-.121L0 11.784l.055-.352.48-.321.686.06 1.52.103 2.278.158 1.652.097 2.449.255h.389l.055-.157-.134-.098-.103-.097-2.358-1.596-2.552-1.688-1.336-.972-.724-.491-.364-.462-.158-1.008.656-.722.881.06.225.061.893.686 1.908 1.476 2.491 1.833.365.304.145-.103.019-.073-.164-.274-1.355-2.446-1.446-2.49-.644-1.032-.17-.619a2.97 2.97 0 01-.104-.729L6.283.134 6.696 0l.996.134.42.364.62 1.414 1.002 2.229 1.555 3.03.456.898.243.832.091.255h.158V9.01l.128-1.706.237-2.095.23-2.695.08-.76.376-.91.747-.492.584.28.48.685-.067.444-.286 1.851-.559 2.903-.364 1.942h.212l.243-.242.985-1.306 1.652-2.064.73-.82.85-.904.547-.431h1.033l.76 1.129-.34 1.166-1.064 1.347-.881 1.142-1.264 1.7-.79 1.36.073.11.188-.02 2.856-.606 1.543-.28 1.841-.315.833.388.091.395-.328.807-1.969.486-2.309.462-3.439.813-.042.03.049.061 1.549.146.662.036h1.622l3.02.225.79.522.474.638-.079.485-1.215.62-1.64-.389-3.829-.91-1.312-.329h-.182v.11l1.093 1.068 2.006 1.81 2.509 2.33.127.578-.322.455-.34-.049-2.205-1.657-.851-.747-1.926-1.62h-.128v.17l.444.649 2.345 3.521.122 1.08-.17.353-.608.213-.668-.122-1.374-1.925-1.415-2.167-1.143-1.943-.14.08-.674 7.254-.316.37-.729.28-.607-.461-.322-.747.322-1.476.389-1.924.315-1.53.286-1.9.17-.632-.012-.042-.14.018-1.434 1.967-2.18 2.945-1.726 1.845-.414.164-.717-.37.067-.662.401-.589 2.388-3.036 1.44-1.882.93-1.086-.006-.158h-.055L4.132 18.56l-1.13.146-.487-.456.061-.746.231-.243 1.908-1.312-.006.006z");
const ANTIGRAVITY_SVG_PATH = new Path2D("M21.751 22.607c1.34 1.005 3.35.335 1.508-1.508C17.73 15.74 18.904 1 12.037 1 5.17 1 6.342 15.74.815 21.1c-2.01 2.009.167 2.511 1.507 1.506 5.192-3.517 4.857-9.714 9.715-9.714 4.857 0 4.522 6.197 9.714 9.715z");

function drawAgentProviderBadge(ctx, provider, x, y, size = 32, withBg = true) {
  let bg = '#e6eeea';
  let color = '#386550';
  let path = CODEX_SVG_PATH;
  if (provider === 'claude') {
    bg = '#f6e9df';
    color = '#a16c4d';
    path = CLAUDE_SVG_PATH;
  } else if (provider === 'antigravity') {
    bg = '#e8f0fe';
    color = '#1a73e8';
    path = ANTIGRAVITY_SVG_PATH;
  }
  if (withBg) {
    ctx.fillStyle = bg;
    roundRect(ctx, x, y, size, size, 8, true, false);
  }
  const iconSize = withBg ? Math.round(size * 0.58) : size;
  const scale = iconSize / 24;
  const offsetX = x + (size - iconSize) / 2;
  const offsetY = y + (size - iconSize) / 2;
  ctx.save();
  ctx.translate(offsetX, offsetY);
  ctx.scale(scale, scale);
  ctx.fillStyle = color;
  ctx.fill(path);
  ctx.restore();
}

const TOTAL_DURATION = 15.0;
const FPS = 60;
const TOTAL_FRAMES = TOTAL_DURATION * FPS;

const canvas = document.getElementById('stage');
const ctx = canvas.getContext('2d', { alpha: false });
const playBtn = document.getElementById('playBtn');
const restartBtn = document.getElementById('restartBtn');
const soundBtn = document.getElementById('soundBtn');
const speedBtn = document.getElementById('speedBtn');
const snapshotBtn = document.getElementById('snapshotBtn');
const exportBtn = document.getElementById('exportBtn');
const timeline = document.getElementById('timeline');
const timelineProgress = document.getElementById('timelineProgress');
const timeText = document.getElementById('timeText');
const renderStatus = document.getElementById('renderStatus');
const chapterBar = document.getElementById('chapterBar');
const uiBrandTitle = document.getElementById('uiBrandTitle');
const uiBrandBadge = document.getElementById('uiBrandBadge');
const linkDesktopVideo = document.getElementById('linkDesktopVideo');
const linkMobileVideo = document.getElementById('linkMobileVideo');

let currentFrame = 0;
let isPlaying = true;
let isRecording = false;
let audioEnabled = true;
let playbackSpeed = 1.0;
let animationId = null;

let audioCtx = null;
function getAudioContext() {
  if (!audioCtx) {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    audioCtx = new AudioContext();
  }
  if (audioCtx.state === 'suspended') audioCtx.resume();
  return audioCtx;
}

function playSound(type) {
  if (!audioEnabled) return;
  try {
    const actx = getAudioContext();
    const now = actx.currentTime;
    if (type === 'click') {
      const osc = actx.createOscillator();
      const gain = actx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(980, now);
      osc.frequency.exponentialRampToValueAtTime(320, now + 0.04);
      gain.gain.setValueAtTime(0.16, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.04);
      osc.connect(gain);
      gain.connect(actx.destination);
      osc.start(now);
      osc.stop(now + 0.04);
    } else if (type === 'scan') {
      const osc = actx.createOscillator();
      const gain = actx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(880, now);
      osc.frequency.setValueAtTime(1318.5, now + 0.07);
      gain.gain.setValueAtTime(0.18, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
      osc.connect(gain);
      gain.connect(actx.destination);
      osc.start(now);
      osc.stop(now + 0.25);
    } else if (type === 'voice') {
      const osc = actx.createOscillator();
      const gain = actx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(523.25, now);
      osc.frequency.setValueAtTime(659.25, now + 0.06);
      osc.frequency.setValueAtTime(1046.5, now + 0.12);
      gain.gain.setValueAtTime(0.15, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.28);
      osc.connect(gain);
      gain.connect(actx.destination);
      osc.start(now);
      osc.stop(now + 0.28);
    } else if (type === 'approve') {
      const osc1 = actx.createOscillator();
      const osc2 = actx.createOscillator();
      const gain = actx.createGain();
      osc1.frequency.setValueAtTime(587.33, now);
      osc2.frequency.setValueAtTime(880.0, now + 0.06);
      gain.gain.setValueAtTime(0.2, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.32);
      osc1.connect(gain);
      osc2.connect(gain);
      gain.connect(actx.destination);
      osc1.start(now);
      osc2.start(now + 0.06);
      osc1.stop(now + 0.06);
      osc2.stop(now + 0.32);
    }
  } catch (e) {}
}

function easeOutCubic(t) { return (--t) * t * t + 1; }
function easeInOutQuad(t) { return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t; }
function clamp(val, min, max) { return Math.max(min, Math.min(max, val)); }

function roundRect(ctx, x, y, width, height, radius, fill, stroke) {
  const r = Math.max(0, Math.min(radius, width / 2, height / 2));
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + width - r, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + r);
  ctx.lineTo(x + width, y + height - r);
  ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  ctx.lineTo(x + r, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
  if (fill) ctx.fill();
  if (stroke) ctx.stroke();
}

function drawCleanShadowRect(ctx, x, y, width, height, radius, fill, stroke, shadowColor, blur, offsetY) {
  ctx.save();
  if (shadowColor) {
    ctx.shadowColor = shadowColor;
    ctx.shadowBlur = blur || 0;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = offsetY || 0;
  }
  roundRect(ctx, x, y, width, height, radius, fill, stroke);
  ctx.restore();
}

function truncateText(ctx, text, maxWidth) {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let len = text.length;
  while (len > 0 && ctx.measureText(text.slice(0, len) + '…').width > maxWidth) {
    len--;
  }
  return text.slice(0, len) + '…';
}

function drawWrappedText(ctx, text, x, y, maxWidth, lineHeight, maxLines = 2) {
  const isCJK = /[\u4e00-\u9fa5\u3040-\u30ff]/.test(text);
  const units = isCJK ? Array.from(text) : text.split(' ');
  let line = '';
  let lineCount = 0;
  for (let i = 0; i < units.length; i++) {
    const sep = isCJK ? '' : (line === '' ? '' : ' ');
    const testLine = line + sep + units[i];
    if (ctx.measureText(testLine).width > maxWidth && line !== '') {
      lineCount++;
      if (lineCount >= maxLines) {
        ctx.fillText(truncateText(ctx, line + sep + units.slice(i).join(isCJK ? '' : ' '), maxWidth), x, y);
        return y + lineHeight;
      }
      ctx.fillText(line, x, y);
      line = units[i];
      y += lineHeight;
    } else {
      line = testLine;
    }
  }
  if (line) {
    ctx.fillText(line, x, y);
    y += lineHeight;
  }
  return y;
}

function drawAuthenticQrCode(ctx, x, y, size, scanProgress) {
  ctx.save();
  const n = 25;
  const quiet = 1.5;
  const total = n + quiet * 2;
  const cell = size / total;

  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = '#d5e2da';
  ctx.lineWidth = 1.5;
  roundRect(ctx, x, y, size, size, 12, true, true);

  const isFinder = (gx, gy) =>
    (gx < 7 && gy < 7) || (gx >= n - 7 && gy < 7) || (gx < 7 && gy >= n - 7);

  ctx.fillStyle = '#1e2b24';
  for (let gy = 0; gy < n; gy++) {
    for (let gx = 0; gx < n; gx++) {
      if (isFinder(gx, gy)) continue;
      const v = ((gx * 17 + gy * 31 + (gx ^ gy) * 13) % 7);
      const timing = (gx === 6 || gy === 6) ? ((gx + gy) % 2 === 0) : (v < 3);
      if (timing) {
        const px = x + (gx + quiet) * cell;
        const py = y + (gy + quiet) * cell;
        roundRect(ctx, px + 0.4, py + 0.4, cell - 0.8, cell - 0.8, cell * 0.32, true, false);
      }
    }
  }

  const eyes = [
    { gx: 0, gy: 0 },
    { gx: n - 7, gy: 0 },
    { gx: 0, gy: n - 7 }
  ];
  ctx.strokeStyle = '#1e2b24';
  ctx.lineWidth = cell * 0.95;
  for (const e of eyes) {
    const ex = x + (e.gx + quiet) * cell;
    const ey = y + (e.gy + quiet) * cell;
    roundRect(ctx, ex + cell * 0.5, ey + cell * 0.5, cell * 6, cell * 6, cell * 1.5, false, true);
    ctx.fillStyle = '#25634f';
    roundRect(ctx, ex + cell * 2, ey + cell * 2, cell * 3, cell * 3, cell * 0.75, true, false);
  }

  if (scanProgress > 0 && scanProgress < 1) {
    const sy = y + 10 + (size - 20) * ((Math.sin(scanProgress * Math.PI * 2 - Math.PI / 2) + 1) / 2);
    const grad = ctx.createLinearGradient(x + 8, sy - 16, x + 8, sy + 4);
    grad.addColorStop(0, 'rgba(16, 185, 129, 0)');
    grad.addColorStop(1, 'rgba(16, 185, 129, 0.38)');
    ctx.fillStyle = grad;
    ctx.fillRect(x + 8, sy - 16, size - 16, 20);

    ctx.strokeStyle = '#10b981';
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    ctx.moveTo(x + 8, sy);
    ctx.lineTo(x + size - 8, sy);
    ctx.stroke();
  }
  ctx.restore();
}

// Helper to determine current mobile screen state:
// 'qr_scan': 0 .. 1.1s
// 'board_list_1': 1.1 .. 3.5s (Mobile Multi-Session Board List)
// 'session_claude': 3.5 .. 5.1s (Expanded Session 1: Claude)
// 'board_list_2': 5.1 .. 6.5s (Back to Mobile Multi-Session Board List -> Scroll & tap Session 2)
// 'session_codex': 6.5 .. 15.0s (Expanded Session 2: Codex with Voice Input & Approval)
function getMobileViewState(t) {
  if (t < 1.1) return 'qr_scan';
  if (t < 3.5) return 'board_list_1';
  if (t < 5.1) return 'session_claude';
  if (t < 6.5) return 'board_list_2';
  return 'session_codex';
}

function renderFrame(t) {
  const S = getStrings();
  ctx.save();
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';

  // Background matching var(--c-f1f3f2)
  ctx.fillStyle = '#f1f3f2';
  ctx.fillRect(0, 0, 1920, 1080);

  // Subtle ambient glow
  const bgGrad = ctx.createRadialGradient(1650, 500, 50, 1650, 500, 620);
  bgGrad.addColorStop(0, 'rgba(37, 99, 79, 0.09)');
  bgGrad.addColorStop(1, 'rgba(37, 99, 79, 0)');
  ctx.fillStyle = bgGrad;
  ctx.fillRect(0, 0, 1920, 1080);

  // 1. Top Header Bar
  drawTopWorkspaceBar(t, S);

  // 2. Anywhere Scene Switcher Banner (Wi-Fi / Tailscale / 5G HTTPS)
  drawAnywhereSceneBanner(t, S);

  // 3. Left Side: Authentic 3-Column Desktop Agent Board (x=36, y=144, w=1316, h=836)
  drawLeftDesktopStage(t, S);

  // 4. Wireless Sync Bridge between Desktop (x=1352) and Portrait Phone (x=1456)
  drawWirelessBridge(t, S);

  // 5. Right Side: Mainstream Vertical Portrait Smartphone (x=1456, y=144, w=428, h=836, ratio ~9:19.5)
  drawRightPortraitPhone(t, S);

  // 6. Touch & Mouse Interactions
  drawTouchAndMouse(t);

  // 7. Bottom Subtitle Bar
  drawFooterSubtitle(t, S);

  // 8. Chapter 5: Outro Overlay
  if (t >= 13.2) {
    drawMobileOutro(t - 13.2, S);
  }

  ctx.restore();
}

function drawTopWorkspaceBar(t, S) {
  const pad = 36;
  ctx.save();
  ctx.fillStyle = '#25634f';
  roundRect(ctx, pad, 18, 34, 34, 9, true, false);
  ctx.font = '700 17px "Segoe UI", sans-serif';
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('▦', pad + 17, 35);

  ctx.textAlign = 'left';
  ctx.font = '700 19px "Plus Jakarta Sans", "Segoe UI", sans-serif';
  ctx.fillStyle = '#23332e';
  ctx.fillText('Agent Board', pad + 46, 28);

  ctx.font = '500 11.5px "Segoe UI", sans-serif';
  ctx.fillStyle = '#6c7b74';
  ctx.fillText(S.topbarSub, pad + 46, 45);

  // Right side controls matching src/App.tsx (.connection + .remoteTopbarBtn + sound + lang)
  let rx = 1920 - pad;
  ctx.font = '600 12px "Segoe UI", sans-serif';
  const remW = Math.max(118, ctx.measureText(S.remoteBtn).width + 26);
  rx -= remW;
  const isRemPulse = t < 2.8;
  ctx.fillStyle = isRemPulse ? '#1e523f' : '#e5f2eb';
  ctx.strokeStyle = isRemPulse ? '#1e523f' : '#a8cfbb';
  ctx.lineWidth = 1.2;
  roundRect(ctx, rx, 19, remW, 32, 8, true, true);
  ctx.fillStyle = isRemPulse ? '#ffffff' : '#1e523f';
  ctx.textAlign = 'center';
  ctx.fillText(S.remoteBtn, rx + remW / 2, 35);

  ctx.font = '500 12px "Segoe UI", sans-serif';
  const connW = ctx.measureText(S.connected).width + 32;
  rx -= (connW + 12);
  ctx.fillStyle = '#e7ece9';
  roundRect(ctx, rx, 19, connW, 32, 999, true, false);
  ctx.fillStyle = '#438b68';
  ctx.beginPath();
  ctx.arc(rx + 13, 35, 3.8, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#416557';
  ctx.textAlign = 'left';
  ctx.fillText(S.connected, rx + 22, 35);
  ctx.restore();
}

function drawAnywhereSceneBanner(t, S) {
  const pad = 36;
  const y = 62;
  const h = 68;
  const totalW = 1920 - pad * 2;
  ctx.save();

  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = '#d5e2da';
  ctx.lineWidth = 1;
  drawCleanShadowRect(ctx, pad, y, totalW, h, 12, true, true, 'rgba(20, 36, 27, 0.05)', 10, 2);

  ctx.font = '700 13.5px "Plus Jakarta Sans", "Segoe UI", sans-serif';
  ctx.fillStyle = '#1e2b24';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(S.anywhereHeader, pad + 18, y + h / 2);

  const activeSceneIdx = t < 3.0 ? 0 : (t < 5.1 ? 1 : (t < 6.8 ? 2 : 1));
  const cardW = 360;
  const gap = 10;
  let sx = 1920 - pad - (cardW * 3 + gap * 2) - 10;

  S.scenes.forEach((sc, idx) => {
    const isAct = idx === activeSceneIdx;
    ctx.fillStyle = isAct ? '#edf7f1' : '#f8faf9';
    ctx.strokeStyle = isAct ? '#25634f' : '#dce5df';
    ctx.lineWidth = isAct ? 1.8 : 1;
    roundRect(ctx, sx, y + 8, cardW, h - 16, 9, true, true);

    ctx.font = '19px "Segoe UI Emoji", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(sc.icon, sx + 22, y + h / 2 + 1);

    ctx.textAlign = 'left';
    ctx.font = '700 12px "Segoe UI", sans-serif';
    ctx.fillStyle = isAct ? '#1e523f' : '#1e2b24';
    ctx.fillText(sc.title, sx + 42, y + 24);

    ctx.font = '600 9.5px "JetBrains Mono", monospace';
    const tw = ctx.measureText(sc.tag).width + 12;
    ctx.fillStyle = isAct ? '#25634f' : '#e2ebe5';
    roundRect(ctx, sx + cardW - tw - 8, y + 13, tw, 17, 999, true, false);
    ctx.fillStyle = isAct ? '#ffffff' : '#4e6157';
    ctx.textAlign = 'center';
    ctx.fillText(sc.tag, sx + cardW - tw / 2 - 8, y + 21.5);

    ctx.textAlign = 'left';
    ctx.font = '400 10.5px "Segoe UI", sans-serif';
    ctx.fillStyle = '#52635a';
    ctx.fillText(truncateText(ctx, sc.desc, cardW - 50), sx + 42, y + 43);

    sx += cardW + gap;
  });

  ctx.restore();
}

function drawLeftDesktopStage(t, S) {
  const x = 36;
  const y = 142;
  const w = 1316;
  const h = 838;
  ctx.save();

  // Desktop App Frame
  drawCleanShadowRect(ctx, x, y, w, h, 14, true, false, 'rgba(15, 23, 42, 0.07)', 18, 5);
  ctx.fillStyle = '#f1f3f2';
  ctx.strokeStyle = '#d3ded7';
  ctx.lineWidth = 1;
  roundRect(ctx, x, y, w, h, 14, true, true);

  // 1. Authentic Desktop .toolbar (from src/App.tsx & src/Board.module.css)
  const tbX = x + 18;
  const tbY = y + 14;
  const tbW = w - 36;
  const tbH = 44;
  ctx.fillStyle = '#e7ece9';
  roundRect(ctx, tbX, tbY, tbW, tbH, 10, true, false);

  // Active Board Selected Tab
  ctx.font = '600 12px "Segoe UI", sans-serif';
  const t1W = ctx.measureText(S.tabActive).width + 24;
  ctx.fillStyle = '#ffffff';
  roundRect(ctx, tbX + 6, tbY + 6, t1W, 32, 7, true, false);
  ctx.fillStyle = '#214e3c';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(S.tabActive, tbX + 6 + t1W / 2, tbY + 22);

  // Archived Tab
  ctx.font = '500 12px "Segoe UI", sans-serif';
  const t2W = ctx.measureText(S.tabArchived).width + 20;
  ctx.fillStyle = '#63756a';
  ctx.fillText(S.tabArchived, tbX + 12 + t1W + t2W / 2, tbY + 22);

  // Source & Status Filters
  ctx.textAlign = 'left';
  ctx.fillStyle = '#4c5f54';
  ctx.fillText(S.filterSource, tbX + t1W + t2W + 34, tbY + 22);
  ctx.fillText(S.filterStatus, tbX + t1W + t2W + 178, tbY + 22);

  // Right side of toolbar: Total sessions + Refresh
  ctx.textAlign = 'right';
  ctx.fillStyle = '#edf1ef';
  roundRect(ctx, tbX + tbW - 78, tbY + 7, 70, 30, 7, true, false);
  ctx.fillStyle = '#33493e';
  ctx.textAlign = 'center';
  ctx.fillText(S.refreshBtn, tbX + tbW - 43, tbY + 22);

  ctx.textAlign = 'right';
  ctx.fillStyle = '#65756b';
  ctx.fillText(S.totalSessions, tbX + tbW - 92, tbY + 22);

  // 2. Authentic .boardHeading (Heading + [+ Codex] [+ Claude] [+ Antigravity] + Subheading)
  const bhY = tbY + tbH + 14;
  ctx.textAlign = 'left';
  ctx.font = '600 14px "Segoe UI", sans-serif';
  ctx.fillStyle = '#1a2f25';
  ctx.fillText(S.boardHeading, tbX + 2, bhY + 13);

  // New Session Buttons on right
  const providers = [
    { id: 'codex', label: '+ Codex' },
    { id: 'claude', label: '+ Claude' },
    { id: 'antigravity', label: '+ Antigravity' }
  ];
  let nbx = tbX + 210;
  providers.forEach((p) => {
    ctx.font = '500 11.5px "Segoe UI", sans-serif';
    const bw = ctx.measureText(p.label).width + 32;
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#d2ded7';
    ctx.lineWidth = 1;
    roundRect(ctx, nbx, bhY, bw, 26, 6, true, true);
    drawAgentProviderBadge(ctx, p.id, nbx + 7, bhY + 6, 14, false);
    ctx.fillStyle = '#273b31';
    ctx.textAlign = 'left';
    ctx.fillText(p.label, nbx + 24, bhY + 13);
    nbx += bw + 8;
  });

  ctx.textAlign = 'right';
  ctx.font = '400 11.5px "Segoe UI", sans-serif';
  ctx.fillStyle = '#79847f';
  ctx.fillText(S.boardSubheading, tbX + tbW - 2, bhY + 13);

  // 3. Authentic 3-Column .grid of SessionCards on Desktop
  const gridY = bhY + 34;
  const cardW = 414;
  const cardH = 668;
  const gap = 19;
  const mobileState = getMobileViewState(t);
  const isApproved = t >= 11.4;
  const voiceSent = t >= 10.1;

  const cards = [
    {
      provider: 'claude',
      id: '84a19c03',
      title: S.s1Title,
      project: S.s1Project,
      state: 'RUNNING',
      stateText: S.stateRunning,
      badgeText: S.newUnread,
      userMsg: S.s1User,
      toolMsg: S.s1Tool,
      aiMsg: S.s1Ai,
      activeOnPhone: mobileState === 'session_claude'
    },
    {
      provider: 'codex',
      id: '0196fb2a',
      title: S.s2Title,
      project: S.s2Project,
      state: isApproved ? 'COMPLETED' : (voiceSent ? 'RUNNING' : 'WAITING_APPROVAL'),
      stateText: isApproved ? S.stateCompleted : (voiceSent ? S.stateRunning : S.stateWaiting),
      badgeText: S.newUnread,
      userMsg: S.s2User,
      toolMsg: S.s2Tool,
      aiMsg: isApproved ? S.aiReplyAfterVoice : S.s2AiWait,
      activeOnPhone: mobileState === 'session_codex',
      isCodexTarget: true
    },
    {
      provider: 'antigravity',
      id: '3f92d11c',
      title: S.s3Title,
      project: S.s3Project,
      state: 'COMPLETED',
      stateText: S.stateCompleted,
      badgeText: S.completedUnread,
      userMsg: S.s3User,
      toolMsg: S.s3Tool,
      aiMsg: S.s3Ai,
      activeOnPhone: false
    }
  ];

  cards.forEach((c, idx) => {
    const cx = tbX + idx * (cardW + gap);
    const cy = gridY;

    // Card container (.card in Board.module.css)
    const isUrgent = c.state === 'WAITING_APPROVAL';
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = c.activeOnPhone ? '#10b981' : (isUrgent ? '#e6cd9e' : '#dce5df');
    ctx.lineWidth = c.activeOnPhone ? 2.2 : (isUrgent ? 1.8 : 1);
    drawCleanShadowRect(
      ctx,
      cx,
      cy,
      cardW,
      cardH,
      12,
      true,
      true,
      c.activeOnPhone ? 'rgba(16, 185, 129, 0.16)' : (isUrgent ? 'rgba(217, 119, 6, 0.12)' : 'rgba(35, 59, 46, 0.05)'),
      c.activeOnPhone ? 18 : 10,
      3
    );

    // .cardHeader
    drawAgentProviderBadge(ctx, c.provider, cx + 16, cy + 16, 33, true);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.font = '600 13.5px "Segoe UI", sans-serif';
    ctx.fillStyle = '#23332e';
    ctx.fillText(truncateText(ctx, c.title, cardW - 122), cx + 58, cy + 24);

    // Provider ID + Project Badge (.cardProjectBadge)
    const pName = c.provider === 'codex' ? 'Codex' : c.provider === 'claude' ? 'Claude' : 'Antigravity';
    ctx.font = '400 11px "Segoe UI", sans-serif';
    ctx.fillStyle = '#77857d';
    const pText = `${pName} · ${c.id}`;
    ctx.fillText(pText, cx + 58, cy + 42);
    const pw = ctx.measureText(pText).width;

    ctx.font = '600 10.5px "Segoe UI", sans-serif';
    const projW = ctx.measureText(c.project).width + 12;
    ctx.fillStyle = '#eef4f0';
    ctx.strokeStyle = '#dce8e1';
    ctx.lineWidth = 1;
    roundRect(ctx, cx + 58 + pw + 8, cy + 33, projW, 18, 5, true, true);
    ctx.fillStyle = '#1e3e2f';
    ctx.fillText(c.project, cx + 58 + pw + 14, cy + 42);

    // Header actions: 📱 + ↗
    ctx.fillStyle = '#849086';
    ctx.font = '14px "Segoe UI Emoji", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('📱', cx + cardW - 44, cy + 28);
    ctx.font = '15px "Segoe UI", sans-serif';
    ctx.fillText('↗', cx + cardW - 20, cy + 28);

    // .badges row
    const by = cy + 60;
    const dotCol = c.state === 'WAITING_APPROVAL' ? '#d97706' : (c.state === 'RUNNING' ? '#287296' : '#438b68');
    const txtCol = c.state === 'WAITING_APPROVAL' ? '#986c23' : (c.state === 'RUNNING' ? '#287296' : '#44735d');
    ctx.fillStyle = dotCol;
    ctx.beginPath();
    ctx.arc(cx + 20, by + 8, 3.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.textAlign = 'left';
    ctx.font = '500 11px "Segoe UI", sans-serif';
    ctx.fillStyle = txtCol;
    ctx.fillText(c.stateText, cx + 29, by + 8);

    // If active on phone, show synced indicator pill
    if (c.activeOnPhone) {
      ctx.font = '700 10px "Segoe UI", sans-serif';
      const sw2 = ctx.measureText(S.phoneSyncTag).width + 12;
      ctx.fillStyle = '#d1fae5';
      roundRect(ctx, cx + 106, by, sw2, 18, 4, true, false);
      ctx.fillStyle = '#065f46';
      ctx.textAlign = 'center';
      ctx.fillText(S.phoneSyncTag, cx + 106 + sw2 / 2, by + 9);
    }

    // Right attention badge (.attention)
    ctx.font = '600 10px "Segoe UI", sans-serif';
    const attW = ctx.measureText(c.badgeText).width + 12;
    ctx.fillStyle = '#e5f2eb';
    roundRect(ctx, cx + cardW - 16 - attW, by - 1, attW, 18, 4, true, false);
    ctx.fillStyle = '#226649';
    ctx.textAlign = 'center';
    ctx.fillText(c.badgeText, cx + cardW - 16 - attW / 2, by + 8);

    // .scroll Conversation Body
    const scY = cy + 84;
    const scH = cardH - 168;
    ctx.fillStyle = '#fafcfb';
    ctx.fillRect(cx + 1, scY, cardW - 2, scH);

    let ey = scY + 12;
    const ew = cardW - 32;
    const ex = cx + 16;

    // Event 1: User message (.event[data-role='user'] .markdown)
    ctx.textAlign = 'left';
    ctx.font = '600 10px "Segoe UI", sans-serif';
    ctx.fillStyle = '#899387';
    ctx.fillText('你 · 14:20', ex, ey + 6);
    ey += 14;
    ctx.fillStyle = '#f0f4f1';
    ctx.strokeStyle = '#dce5df';
    ctx.lineWidth = 1;
    roundRect(ctx, ex, ey, ew, 46, 8, true, true);
    ctx.font = '400 12px "Segoe UI", sans-serif';
    ctx.fillStyle = '#495a50';
    ctx.textBaseline = 'alphabetic';
    drawWrappedText(ctx, c.userMsg, ex + 11, ey + 18, ew - 22, 17, 2);
    ey += 56;

    // Event 2: Tool Block (.toolBlock)
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#dce4e0';
    roundRect(ctx, ex, ey, ew, c.isCodexTarget ? 88 : 52, 8, true, true);
    ctx.fillStyle = '#f7faf8';
    roundRect(ctx, ex + 1, ey + 1, ew - 2, 26, 7, true, false);
    ctx.textBaseline = 'middle';
    ctx.font = '600 11px Consolas, "Segoe UI", monospace';
    ctx.fillStyle = '#3b5045';
    ctx.fillText(`🛠️ ${truncateText(ctx, c.toolMsg, ew - 24)}`, ex + 10, ey + 14);

    if (c.isCodexTarget) {
      ctx.font = '500 10.5px Consolas, monospace';
      ctx.fillStyle = '#fee2e2';
      ctx.fillRect(ex + 10, ey + 33, ew - 20, 20);
      ctx.fillStyle = '#991b1b';
      ctx.fillText('- const decoded = jwt.verify(token, SECRET);', ex + 16, ey + 43);
      ctx.fillStyle = '#dcfce7';
      ctx.fillRect(ex + 10, ey + 56, ew - 20, 20);
      ctx.fillStyle = '#166534';
      ctx.fillText('+ const decoded = await verifyRs256(token, pubKey);', ex + 16, ey + 66);
      ey += 98;
    } else {
      ctx.font = '400 10.5px Consolas, monospace';
      ctx.fillStyle = '#6a7c72';
      ctx.fillText('⏱ 0.4s · ⚡ exit 0', ex + 10, ey + 38);
      ey += 62;
    }

    // Event 3: AI status or Live Voice Sync on Codex Card
    if (c.isCodexTarget && voiceSent) {
      const vp = easeOutCubic(clamp((t - 10.1) / 0.3, 0, 1));
      ctx.save();
      ctx.globalAlpha = vp;
      ctx.textBaseline = 'middle';
      ctx.font = '600 10px "Segoe UI", sans-serif';
      ctx.fillStyle = '#047857';
      ctx.fillText('你 (🎙️ 手机语音同步) · 14:22', ex, ey + 6);
      ey += 14;
      ctx.fillStyle = '#ecfdf5';
      ctx.strokeStyle = '#10b981';
      roundRect(ctx, ex, ey, ew, 46, 8, true, true);
      ctx.font = '400 11.5px "Segoe UI", sans-serif';
      ctx.fillStyle = '#1e2b24';
      ctx.textBaseline = 'alphabetic';
      drawWrappedText(ctx, S.voiceTranscript, ex + 10, ey + 18, ew - 20, 16, 2);
      ctx.restore();
      ey += 56;
    }

    // AI Reply / Status
    ctx.textBaseline = 'middle';
    ctx.font = '600 10px "Segoe UI", sans-serif';
    ctx.fillStyle = '#698275';
    ctx.fillText('AI · 14:22', ex, ey + 6);
    ey += 14;
    ctx.fillStyle = (c.isCodexTarget && isApproved) ? '#f0fdf4' : '#ffffff';
    ctx.strokeStyle = (c.isCodexTarget && isApproved) ? '#86efac' : '#e4ece7';
    roundRect(ctx, ex, ey, ew, 48, 8, true, true);
    ctx.font = '400 11.5px "Segoe UI", sans-serif';
    ctx.fillStyle = '#3b4b41';
    ctx.textBaseline = 'alphabetic';
    drawWrappedText(ctx, c.aiMsg, ex + 10, ey + 18, ew - 20, 16, 2);

    // Bottom .interactAction (.fullInteractBtn) + .cardFooter
    const iaY = cy + cardH - 80;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(cx + 1, iaY, cardW - 2, 79);

    if (isUrgent) {
      const urgGrad = ctx.createLinearGradient(ex, iaY + 6, ex + ew, iaY + 40);
      urgGrad.addColorStop(0, '#fef3c7');
      urgGrad.addColorStop(1, '#fde68a');
      ctx.fillStyle = urgGrad;
      ctx.strokeStyle = '#f59e0b';
    } else if (c.state === 'RUNNING') {
      ctx.fillStyle = '#edf6f9';
      ctx.strokeStyle = '#c0e0eb';
    } else {
      ctx.fillStyle = '#e8f2ec';
      ctx.strokeStyle = '#c8dfd2';
    }
    ctx.lineWidth = 1;
    roundRect(ctx, ex, iaY + 6, ew, 34, 8, true, true);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '600 12.5px "Segoe UI", sans-serif';
    ctx.fillStyle = isUrgent ? '#92400e' : (c.state === 'RUNNING' ? '#1a6585' : '#1e523f');
    ctx.fillText(isUrgent ? S.interactUrgent : S.interact, ex + ew / 2, iaY + 23);

    // .cardFooter ([✓ 标记已读] ... [收纳])
    const cfY = iaY + 46;
    ctx.font = '500 11px "Segoe UI", sans-serif';
    const mrW = ctx.measureText(S.markRead).width + 20;
    ctx.fillStyle = '#f0f4f1';
    roundRect(ctx, ex, cfY, mrW, 24, 6, true, false);
    ctx.fillStyle = '#56715e';
    ctx.fillText(S.markRead, ex + mrW / 2, cfY + 12);

    ctx.textAlign = 'right';
    ctx.fillStyle = '#879289';
    ctx.fillText(S.archive, ex + ew - 6, cfY + 12);
  });

  // 4. RemoteControlModal Overlay during Chapter 1 (t < 3.0s)
  const modalAlpha = t < 2.5 ? easeOutCubic(clamp(t / 0.3, 0, 1)) : clamp((3.0 - t) / 0.5, 0, 1);
  if (modalAlpha > 0.01) {
    ctx.save();
    ctx.fillStyle = `rgba(15, 23, 42, ${0.42 * modalAlpha})`;
    roundRect(ctx, x, y, w, h, 14, true, false);

    ctx.globalAlpha = modalAlpha;
    const mw = 480;
    const mh = 540;
    const mx = x + (w - mw) / 2;
    const my = y + (h - mh) / 2;

    drawCleanShadowRect(ctx, mx, my, mw, mh, 14, true, false, 'rgba(15, 23, 42, 0.35)', 28, 8);
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#dce5df';
    ctx.lineWidth = 1;
    roundRect(ctx, mx, my, mw, mh, 14, true, true);

    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.font = '700 15px "Segoe UI", sans-serif';
    ctx.fillStyle = '#1b3126';
    ctx.fillText(`📱 ${S.qrModalTitle}`, mx + 22, my + 28);
    ctx.font = '400 11.5px "Segoe UI", sans-serif';
    ctx.fillStyle = '#5e7267';
    ctx.fillText(truncateText(ctx, S.qrModalSub, mw - 44), mx + 22, my + 48);

    // 3 Mode Tabs (.remoteModeTabs)
    const tabs = [S.modeLan, S.modeTunnel, S.modeCustom];
    const tabW = (mw - 44 - 8) / 3;
    ctx.fillStyle = '#edf2ef';
    roundRect(ctx, mx + 22, my + 66, mw - 44, 34, 8, true, false);
    tabs.forEach((label, idx) => {
      const tx = mx + 25 + idx * (tabW + 1);
      const act = idx === 0;
      if (act) {
        ctx.fillStyle = '#ffffff';
        roundRect(ctx, tx, my + 69, tabW, 28, 6, true, false);
      }
      ctx.font = act ? '600 11px "Segoe UI", sans-serif' : '500 11px "Segoe UI", sans-serif';
      ctx.fillStyle = act ? '#1a4734' : '#596d61';
      ctx.textAlign = 'center';
      ctx.fillText(label, tx + tabW / 2, my + 83);
    });

    // QR Code Stage (.remoteQrStage)
    const qx = mx + 22;
    const qy = my + 112;
    const qw = mw - 44;
    const qh = 286;
    ctx.fillStyle = '#f6f9f7';
    ctx.strokeStyle = '#dfe8e3';
    roundRect(ctx, qx, qy, qw, qh, 12, true, true);

    const qrSize = 196;
    drawAuthenticQrCode(ctx, qx + (qw - qrSize) / 2, qy + 16, qrSize, clamp(t / 1.1, 0, 1));

    ctx.font = '600 11.5px "Segoe UI", sans-serif';
    ctx.fillStyle = '#374151';
    ctx.textAlign = 'center';
    ctx.fillText(S.deviceBadge, qx + qw / 2, qy + 230);

    const paired = t >= 1.1;
    ctx.fillStyle = paired ? '#dcfce7' : '#fef3c7';
    ctx.strokeStyle = paired ? '#22c55e' : '#f59e0b';
    roundRect(ctx, qx + 40, qy + 246, qw - 80, 28, 999, true, true);
    ctx.font = '700 11.5px "Segoe UI", sans-serif';
    ctx.fillStyle = paired ? '#15803d' : '#b45309';
    ctx.fillText(paired ? S.scanSuccess : S.scanPrompt, qx + qw / 2, qy + 260);

    // Network Interface & URL
    ctx.fillStyle = '#f2f6f4';
    ctx.strokeStyle = '#d4e0d9';
    roundRect(ctx, qx, qy + qh + 12, qw, 34, 8, true, true);
    ctx.textAlign = 'left';
    ctx.font = '600 11px Consolas, monospace';
    ctx.fillStyle = '#263d31';
    ctx.fillText(S.netInterface, qx + 12, qy + qh + 29);

    ctx.fillStyle = '#e6f3ec';
    roundRect(ctx, qx, qy + qh + 56, qw, 34, 8, true, false);
    ctx.textAlign = 'center';
    ctx.font = '600 11.5px "Segoe UI", sans-serif';
    ctx.fillStyle = '#1e4d38';
    ctx.fillText(`${S.pwaTitle} · ${S.pwaDesc}`, qx + qw / 2, qy + qh + 73);

    ctx.restore();
  }

  ctx.restore();
}

function drawWirelessBridge(t, S) {
  const x1 = 1354;
  const x2 = 1454;
  const cx = (x1 + x2) / 2;
  const cy = 550;
  ctx.save();

  ctx.strokeStyle = '#bdd6c8';
  ctx.lineWidth = 2;
  ctx.setLineDash([5, 5]);
  ctx.beginPath();
  ctx.moveTo(x1, cy - 24);
  ctx.lineTo(x2, cy - 24);
  ctx.moveTo(x1, cy + 24);
  ctx.lineTo(x2, cy + 24);
  ctx.stroke();
  ctx.setLineDash([]);

  for (let i = 0; i < 2; i++) {
    const p = ((t * 1.5 + i * 0.5) % 1);
    ctx.fillStyle = '#10b981';
    ctx.beginPath();
    ctx.arc(x1 + p * (x2 - x1), cy - 24, 4, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#0284c7';
    ctx.beginPath();
    ctx.arc(x2 - p * (x2 - x1), cy + 24, 4, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.fillStyle = '#1e2b24';
  ctx.strokeStyle = '#10b981';
  ctx.lineWidth = 1.6;
  roundRect(ctx, cx - 44, cy - 16, 88, 32, 999, true, true);
  ctx.font = '700 10px "JetBrains Mono", monospace';
  ctx.fillStyle = '#34d399';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const netTag = t < 3.0 ? 'Wi-Fi LAN' : (t >= 5.1 && t < 6.8 ? '5G HTTPS' : 'Tailscale');
  ctx.fillText(`⚡ ${netTag}`, cx, cy);

  ctx.restore();
}

function drawRightPortraitPhone(t, S) {
  // Mainstream Vertical Portrait Smartphone: 428 x 838 (Inner Screen: 404 x 814, ~9:19.5 aspect ratio)
  const px = 1456;
  const py = 142;
  const pw = 428;
  const ph = 838;
  ctx.save();

  // Hardware side buttons (Left volume + Right power)
  ctx.fillStyle = '#334155';
  roundRect(ctx, px - 3, py + 150, 4, 44, 2, true, false);
  roundRect(ctx, px - 3, py + 206, 4, 44, 2, true, false);
  roundRect(ctx, px + pw - 1, py + 175, 4, 64, 2, true, false);

  // Outer Portrait Smartphone Frame
  drawCleanShadowRect(ctx, px, py, pw, ph, 46, true, false, 'rgba(9, 13, 22, 0.36)', 34, 12);
  ctx.fillStyle = '#0f172a';
  ctx.strokeStyle = '#475569';
  ctx.lineWidth = 3;
  roundRect(ctx, px, py, pw, ph, 46, true, true);

  // Inner Portrait Screen (404 x 814)
  const sx = px + 12;
  const sy = py + 12;
  const sw = pw - 24;
  const sh = ph - 24;

  ctx.save();
  ctx.beginPath();
  roundRect(ctx, sx, sy, sw, sh, 36, false, false);
  ctx.clip();

  // Screen Background matching var(--c-f1f3f2)
  ctx.fillStyle = '#f1f3f2';
  ctx.fillRect(sx, sy, sw, sh);

  // 1. iOS Status Bar + Dynamic Island (sy .. sy + 34)
  ctx.fillStyle = '#090d16';
  roundRect(ctx, sx + sw / 2 - 48, sy + 8, 96, 22, 999, true, false);
  const isVoiceActive = t >= 7.1 && t < 10.0;
  if (isVoiceActive) {
    ctx.fillStyle = '#f97316';
    ctx.beginPath();
    ctx.arc(sx + sw / 2 + 32, sy + 19, 4, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.font = '700 11.5px "Plus Jakarta Sans", "Segoe UI", sans-serif';
  ctx.fillStyle = '#23332e';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText('09:41', sx + 22, sy + 19);

  ctx.textAlign = 'right';
  const netLabel = t < 3.0 ? 'Wi-Fi 100%' : (t >= 5.1 && t < 6.8 ? '5G · HTTPS' : '5G · Tailscale');
  ctx.font = '600 10.5px "JetBrains Mono", sans-serif';
  ctx.fillStyle = '#1e523f';
  ctx.fillText(`${netLabel} 🔋`, sx + sw - 20, sy + 19);

  // 2. Render Portrait Phone Content based on current state
  const mobileState = getMobileViewState(t);

  if (mobileState === 'qr_scan') {
    drawPhoneQrCameraView(sx, sy + 34, sw, sh - 48, t, S);
  } else if (mobileState === 'board_list_1' || mobileState === 'board_list_2') {
    const scrollProgress = mobileState === 'board_list_2'
      ? easeInOutQuad(clamp((t - 5.2) / 0.7, 0, 1))
      : 0;
    const highlightIdx = mobileState === 'board_list_1'
      ? (t >= 3.1 ? 0 : -1)
      : (t >= 6.0 ? 1 : -1);
    drawPhoneBoardListView(sx, sy + 34, sw, sh - 48, t, S, scrollProgress, highlightIdx);
  } else if (mobileState === 'session_claude') {
    drawPhoneExpandedSessionView(sx, sy + 34, sw, sh - 48, t, S, 'claude');
  } else {
    drawPhoneExpandedSessionView(sx, sy + 34, sw, sh - 48, t, S, 'codex');
  }

  // 3. iOS Bottom Home Indicator Bar
  ctx.fillStyle = '#94a3b8';
  roundRect(ctx, sx + sw / 2 - 58, sy + sh - 10, 116, 4.5, 999, true, false);

  ctx.restore(); // end screen clip
  ctx.restore();
}

// State 0: Brief QR Scanner View on Phone (0.0s .. 1.1s)
function drawPhoneQrCameraView(sx, sy, sw, sh, t, S) {
  ctx.save();
  ctx.fillStyle = '#0f172a';
  ctx.fillRect(sx, sy, sw, sh);

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = '700 15px "Segoe UI", sans-serif';
  ctx.fillStyle = '#ffffff';
  ctx.fillText(S.scanPrompt, sx + sw / 2, sy + 110);

  const boxSize = 230;
  const bx = sx + (sw - boxSize) / 2;
  const by = sy + 165;
  drawAuthenticQrCode(ctx, bx, by, boxSize, clamp(t / 1.0, 0, 1));

  // Corner viewfinder brackets
  ctx.strokeStyle = '#10b981';
  ctx.lineWidth = 4;
  roundRect(ctx, bx - 10, by - 10, boxSize + 20, boxSize + 20, 18, false, true);

  ctx.fillStyle = '#dcfce7';
  roundRect(ctx, sx + 32, by + boxSize + 36, sw - 64, 38, 999, true, false);
  ctx.font = '700 12.5px "Segoe UI", sans-serif';
  ctx.fillStyle = '#15803d';
  ctx.fillText(S.scanSuccess, sx + sw / 2, by + boxSize + 55);
  ctx.restore();
}

// State 1: Authentic Mobile Multi-Session Board List View (matches @media (max-width: 768px) in src/Board.module.css)
function drawPhoneBoardListView(sx, sy, sw, sh, t, S, scrollProgress, highlightIdx) {
  ctx.save();
  const pad = 12;
  const iw = sw - pad * 2;
  let cy = sy + 6;

  // 1. Mobile .topbar
  ctx.fillStyle = '#25634f';
  roundRect(ctx, sx + pad, cy, 28, 28, 7, true, false);
  ctx.font = '700 14px "Segoe UI", sans-serif';
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('▦', sx + pad + 14, cy + 14);

  ctx.textAlign = 'left';
  ctx.font = '700 15px "Segoe UI", sans-serif';
  ctx.fillStyle = '#23332e';
  ctx.fillText('Agent Board', sx + pad + 35, cy + 9);
  ctx.font = '400 9.5px "Segoe UI", sans-serif';
  ctx.fillStyle = '#6c7b74';
  ctx.fillText(S.topbarSub, sx + pad + 35, cy + 22);

  // Mobile topbar right badges
  ctx.fillStyle = '#e5f2eb';
  roundRect(ctx, sx + sw - pad - 88, cy + 2, 88, 24, 6, true, false);
  ctx.fillStyle = '#438b68';
  ctx.beginPath();
  ctx.arc(sx + sw - pad - 77, cy + 14, 3, 0, Math.PI * 2);
  ctx.fill();
  ctx.font = '600 10px "Segoe UI", sans-serif';
  ctx.fillStyle = '#1e523f';
  ctx.fillText(S.connected, sx + sw - pad - 69, cy + 14);
  cy += 36;

  // 2. Mobile .pwaBanner
  ctx.fillStyle = '#e6f3ec';
  ctx.strokeStyle = '#b7d8c6';
  ctx.lineWidth = 1;
  roundRect(ctx, sx + pad, cy, iw, 38, 8, true, true);
  ctx.textAlign = 'left';
  ctx.font = '700 10.5px "Segoe UI", sans-serif';
  ctx.fillStyle = '#163829';
  ctx.fillText(S.pwaTitle, sx + pad + 10, cy + 13);
  ctx.font = '400 9.5px "Segoe UI", sans-serif';
  ctx.fillStyle = '#3f5e4f';
  ctx.fillText(truncateText(ctx, S.pwaDesc, iw - 86), sx + pad + 10, cy + 27);

  ctx.fillStyle = '#1c523e';
  roundRect(ctx, sx + sw - pad - 68, cy + 7, 60, 24, 6, true, false);
  ctx.textAlign = 'center';
  ctx.font = '600 10px "Segoe UI", sans-serif';
  ctx.fillStyle = '#ffffff';
  ctx.fillText(S.pwaInstall, sx + sw - pad - 38, cy + 19);
  cy += 44;

  // 3. Mobile .toolbar (2-row responsive toolbar)
  ctx.fillStyle = '#e7ece9';
  roundRect(ctx, sx + pad, cy, iw, 56, 9, true, false);

  // Row 1: .tabs
  const tabW = (iw - 14) / 2;
  ctx.fillStyle = '#ffffff';
  roundRect(ctx, sx + pad + 5, cy + 5, tabW, 22, 6, true, false);
  ctx.font = '600 10.5px "Segoe UI", sans-serif';
  ctx.fillStyle = '#214e3c';
  ctx.textAlign = 'center';
  ctx.fillText(S.tabActive, sx + pad + 5 + tabW / 2, cy + 16);

  ctx.font = '500 10.5px "Segoe UI", sans-serif';
  ctx.fillStyle = '#63756a';
  ctx.fillText(S.tabArchived, sx + pad + 9 + tabW + tabW / 2, cy + 16);

  // Row 2: Filters + Total + Refresh
  ctx.textAlign = 'left';
  ctx.font = '400 10px "Segoe UI", sans-serif';
  ctx.fillStyle = '#4c5f54';
  ctx.fillText(`${S.filterSource}   ${S.totalSessions}`, sx + pad + 8, cy + 41);

  ctx.fillStyle = '#edf1ef';
  roundRect(ctx, sx + sw - pad - 58, cy + 31, 52, 20, 5, true, false);
  ctx.textAlign = 'center';
  ctx.font = '600 10px "Segoe UI", sans-serif';
  ctx.fillStyle = '#33493e';
  ctx.fillText(S.refreshBtn, sx + sw - pad - 32, cy + 41);
  cy += 62;

  // 4. Mobile .boardHeading + 3-column .newSessionGroup
  ctx.textAlign = 'left';
  ctx.font = '600 12px "Segoe UI", sans-serif';
  ctx.fillStyle = '#1a2f25';
  ctx.fillText(S.boardHeading, sx + pad + 2, cy + 8);
  cy += 18;

  const btnW3 = (iw - 12) / 3;
  const newBtns = [
    { id: 'codex', label: '+ Codex' },
    { id: 'claude', label: '+ Claude' },
    { id: 'antigravity', label: '+ Antigravity' }
  ];
  newBtns.forEach((b, idx) => {
    const bx = sx + pad + idx * (btnW3 + 6);
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#d2ded7';
    ctx.lineWidth = 1;
    roundRect(ctx, bx, cy, btnW3, 25, 6, true, true);
    drawAgentProviderBadge(ctx, b.id, bx + 8, cy + 6, 13, false);
    ctx.textAlign = 'left';
    ctx.font = '500 10.5px "Segoe UI", sans-serif';
    ctx.fillStyle = '#273b31';
    ctx.fillText(b.label, bx + 24, cy + 12.5);
  });
  cy += 32;

  // 5. Scrollable Single-Column Mobile Session Cards (.grid on mobile)
  const listTop = cy;
  const listH = sy + sh - listTop;
  ctx.save();
  ctx.beginPath();
  ctx.rect(sx, listTop, sw, listH);
  ctx.clip();

  const scrollOffset = scrollProgress * 125;
  let cardY = listTop - scrollOffset;

  const mCards = [
    {
      provider: 'claude',
      id: '84a19c03',
      title: S.s1Title,
      project: S.s1Project,
      state: 'RUNNING',
      stateText: S.stateRunning,
      badge: S.newUnread,
      userMsg: S.s1User,
      toolMsg: S.s1Tool,
      urgent: false
    },
    {
      provider: 'codex',
      id: '0196fb2a',
      title: S.s2Title,
      project: S.s2Project,
      state: 'WAITING_APPROVAL',
      stateText: S.stateWaiting,
      badge: S.newUnread,
      userMsg: S.s2User,
      toolMsg: S.s2Tool,
      urgent: true
    },
    {
      provider: 'antigravity',
      id: '3f92d11c',
      title: S.s3Title,
      project: S.s3Project,
      state: 'COMPLETED',
      stateText: S.stateCompleted,
      badge: S.completedUnread,
      userMsg: S.s3User,
      toolMsg: S.s3Tool,
      urgent: false
    }
  ];

  const mCardH = 216;
  mCards.forEach((mc, idx) => {
    const isHi = idx === highlightIdx;
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = isHi ? '#10b981' : (mc.urgent ? '#f59e0b' : '#dce5df');
    ctx.lineWidth = isHi ? 2.2 : (mc.urgent ? 1.6 : 1);
    roundRect(ctx, sx + pad, cardY, iw, mCardH, 11, true, true);

    // Card Header
    drawAgentProviderBadge(ctx, mc.provider, sx + pad + 12, cardY + 12, 28, true);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.font = '600 12.5px "Segoe UI", sans-serif';
    ctx.fillStyle = '#23332e';
    ctx.fillText(truncateText(ctx, mc.title, iw - 92), sx + pad + 48, cardY + 19);

    const pName = mc.provider === 'codex' ? 'Codex' : mc.provider === 'claude' ? 'Claude' : 'Antigravity';
    ctx.font = '400 10px "Segoe UI", sans-serif';
    ctx.fillStyle = '#77857d';
    ctx.fillText(`${pName} · ${mc.id}  ${mc.project}`, sx + pad + 48, cardY + 34);

    ctx.textAlign = 'center';
    ctx.font = '13px "Segoe UI", sans-serif';
    ctx.fillStyle = '#849086';
    ctx.fillText('↗', sx + pad + iw - 18, cardY + 22);

    // Badges row
    const by = cardY + 46;
    const dotCol = mc.urgent ? '#d97706' : (mc.state === 'RUNNING' ? '#287296' : '#438b68');
    ctx.fillStyle = dotCol;
    ctx.beginPath();
    ctx.arc(sx + pad + 16, by + 7, 3.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.textAlign = 'left';
    ctx.font = '500 10.5px "Segoe UI", sans-serif';
    ctx.fillStyle = dotCol;
    ctx.fillText(mc.stateText, sx + pad + 24, by + 7);

    ctx.font = '600 9.5px "Segoe UI", sans-serif';
    const bw = ctx.measureText(mc.badge).width + 10;
    ctx.fillStyle = '#e5f2eb';
    roundRect(ctx, sx + pad + iw - 12 - bw, by - 1, bw, 16, 4, true, false);
    ctx.fillStyle = '#226649';
    ctx.textAlign = 'center';
    ctx.fillText(mc.badge, sx + pad + iw - 12 - bw / 2, by + 7);

    // Mini Conversation Preview inside Mobile Card
    const py1 = cardY + 66;
    ctx.fillStyle = '#f0f4f1';
    ctx.strokeStyle = '#dce5df';
    ctx.lineWidth = 1;
    roundRect(ctx, sx + pad + 12, py1, iw - 24, 34, 7, true, true);
    ctx.textAlign = 'left';
    ctx.font = '400 11px "Segoe UI", sans-serif';
    ctx.fillStyle = '#495a50';
    ctx.fillText(truncateText(ctx, `你: ${mc.userMsg}`, iw - 42), sx + pad + 20, py1 + 17);

    const py2 = py1 + 40;
    ctx.fillStyle = '#f7faf8';
    ctx.strokeStyle = '#dce4e0';
    roundRect(ctx, sx + pad + 12, py2, iw - 24, 30, 7, true, true);
    ctx.font = '600 10.5px Consolas, "Segoe UI", monospace';
    ctx.fillStyle = '#3b5045';
    ctx.fillText(truncateText(ctx, `🛠️ ${mc.toolMsg}`, iw - 42), sx + pad + 20, py2 + 15);

    // Full-width .fullInteractBtn on Mobile Card
    const btnY = cardY + 144;
    if (mc.urgent) {
      const g = ctx.createLinearGradient(sx + pad + 12, btnY, sx + pad + iw - 12, btnY + 32);
      g.addColorStop(0, '#fef3c7');
      g.addColorStop(1, '#fde68a');
      ctx.fillStyle = g;
      ctx.strokeStyle = '#f59e0b';
    } else if (mc.state === 'RUNNING') {
      ctx.fillStyle = isHi ? '#d1fae5' : '#edf6f9';
      ctx.strokeStyle = isHi ? '#10b981' : '#c0e0eb';
    } else {
      ctx.fillStyle = '#e8f2ec';
      ctx.strokeStyle = '#c8dfd2';
    }
    roundRect(ctx, sx + pad + 12, btnY, iw - 24, 32, 7, true, true);
    ctx.textAlign = 'center';
    ctx.font = '700 12px "Segoe UI", sans-serif';
    ctx.fillStyle = mc.urgent ? '#92400e' : (mc.state === 'RUNNING' ? '#1a6585' : '#1e523f');
    ctx.fillText(mc.urgent ? S.interactUrgent : S.interact, sx + pad + iw / 2, btnY + 16);

    // Mobile Card Footer ([✓ 标记已读] ... [收纳])
    const fy = cardY + 184;
    ctx.font = '500 10px "Segoe UI", sans-serif';
    ctx.fillStyle = '#f0f4f1';
    roundRect(ctx, sx + pad + 12, fy, 74, 22, 5, true, false);
    ctx.fillStyle = '#56715e';
    ctx.fillText(S.markRead, sx + pad + 49, fy + 11);

    ctx.textAlign = 'right';
    ctx.fillStyle = '#879289';
    ctx.fillText(S.archive, sx + pad + iw - 14, fy + 11);

    cardY += mCardH + 10;
  });

  ctx.restore();
  ctx.restore();
}

// State 2: Authentic Fullscreen Mobile Expanded Session View (.expandedCard in @media (max-width: 768px))
function drawPhoneExpandedSessionView(sx, sy, sw, sh, t, S, provider) {
  ctx.save();
  // Fullscreen white dialog background
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(sx, sy, sw, sh);

  const isCodex = provider === 'codex';
  const isApproved = isCodex && t >= 11.4;
  const voiceSent = isCodex && t >= 10.1;
  const isVoiceActive = isCodex && t >= 7.1 && t < 10.0;

  // 1. Mobile Expanded .cardHeader (with .mobileBackBtn '← 返回列表' on the left!)
  const chY = sy + 4;
  const chH = 48;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(sx, chY, sw, chH);
  ctx.strokeStyle = '#e6ece8';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(sx, chY + chH);
  ctx.lineTo(sx + sw, chY + chH);
  ctx.stroke();

  // .mobileBackBtn (highlighted when user taps it around t=4.95s)
  const isBackTap = !isCodex && t >= 4.8 && t <= 5.1;
  ctx.font = '600 11.5px "Segoe UI", sans-serif';
  const backW = Math.max(82, ctx.measureText(S.backToBoard).width + 18);
  ctx.fillStyle = isBackTap ? '#d1fae5' : '#edf3f0';
  ctx.strokeStyle = isBackTap ? '#10b981' : '#d0ddd5';
  roundRect(ctx, sx + 12, chY + 9, backW, 30, 7, true, true);
  ctx.fillStyle = '#1f3b2e';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(S.backToBoard, sx + 12 + backW / 2, chY + 24);

  // Provider Logo + Session Title + ID
  const logoX = sx + 18 + backW;
  drawAgentProviderBadge(ctx, provider, logoX, chY + 10, 28, true);

  ctx.textAlign = 'left';
  ctx.font = '600 12.5px "Segoe UI", sans-serif';
  ctx.fillStyle = '#23332e';
  const titleStr = isCodex ? S.s2Title : S.s1Title;
  ctx.fillText(truncateText(ctx, titleStr, sw - (logoX - sx) - 68), logoX + 34, chY + 17);

  ctx.font = '400 10px "Segoe UI", sans-serif';
  ctx.fillStyle = '#77857d';
  const subStr = isCodex ? `Codex · 0196fb2a  ${S.s2Project}` : `Claude · 84a19c03  ${S.s1Project}`;
  ctx.fillText(truncateText(ctx, subStr, sw - (logoX - sx) - 68), logoX + 34, chY + 33);

  // Collapse button ↙ on right
  ctx.textAlign = 'center';
  ctx.font = '14px "Segoe UI", sans-serif';
  ctx.fillStyle = '#849086';
  ctx.fillText('↙', sx + sw - 22, chY + 24);

  // 2. .badges + Quick Session Switcher Bar
  const bgY = chY + chH + 6;
  const stText = isCodex
    ? (isApproved ? S.stateCompleted : (voiceSent ? S.stateRunning : S.stateWaiting))
    : S.stateRunning;
  const stCol = isCodex
    ? (isApproved ? '#438b68' : (voiceSent ? '#287296' : '#d97706'))
    : '#287296';

  ctx.fillStyle = stCol;
  ctx.beginPath();
  ctx.arc(sx + 18, bgY + 10, 3.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.textAlign = 'left';
  ctx.font = '600 11px "Segoe UI", sans-serif';
  ctx.fillText(stText, sx + 27, bgY + 10);

  // Session switcher indicator pills on right of badges bar (1/3 Claude | 2/3 Codex | 3/3 Antigravity)
  const sTabs = [
    { id: 'claude', label: 'Claude', act: !isCodex },
    { id: 'codex', label: 'Codex', act: isCodex },
    { id: 'antigravity', label: 'AGY', act: false }
  ];
  let stx = sx + sw - 12;
  for (let i = sTabs.length - 1; i >= 0; i--) {
    const item = sTabs[i];
    ctx.font = item.act ? '700 10px "Segoe UI", sans-serif' : '500 10px "Segoe UI", sans-serif';
    const pw = ctx.measureText(item.label).width + 16;
    stx -= pw;
    ctx.fillStyle = item.act ? '#e5f2eb' : '#f2f5f3';
    ctx.strokeStyle = item.act ? '#25634f' : '#dce5df';
    ctx.lineWidth = 1;
    roundRect(ctx, stx, bgY + 1, pw, 18, 999, true, true);
    ctx.fillStyle = item.act ? '#1e523f' : '#65756b';
    ctx.textAlign = 'center';
    ctx.fillText(item.label, stx + pw / 2, bgY + 10);
    stx -= 5;
  }

  // 3. .scroll Conversation Events Area
  let curY = bgY + 26;
  const pad = 14;
  const iw = sw - pad * 2;
  const scrollH = isCodex ? 228 : 390;

  ctx.fillStyle = '#fafcfb';
  ctx.fillRect(sx, curY, sw, scrollH);

  let ey = curY + 8;
  // User Event 1
  ctx.textAlign = 'left';
  ctx.font = '600 10px "Segoe UI", sans-serif';
  ctx.fillStyle = '#899387';
  ctx.fillText('你 · 14:20', sx + pad, ey + 6);
  ey += 14;
  ctx.fillStyle = '#f0f4f1';
  ctx.strokeStyle = '#dce5df';
  roundRect(ctx, sx + pad, ey, iw, 44, 8, true, true);
  ctx.font = '400 11.5px "Segoe UI", sans-serif';
  ctx.fillStyle = '#495a50';
  ctx.textBaseline = 'alphabetic';
  drawWrappedText(ctx, isCodex ? S.s2User : S.s1User, sx + pad + 10, ey + 17, iw - 20, 16, 2);
  ey += 52;

  // Tool Call Event
  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = '#dce4e0';
  roundRect(ctx, sx + pad, ey, iw, isCodex ? 68 : 78, 8, true, true);
  ctx.fillStyle = '#f7faf8';
  roundRect(ctx, sx + pad + 1, ey + 1, iw - 2, 24, 7, true, false);
  ctx.textBaseline = 'middle';
  ctx.font = '600 10.5px Consolas, "Segoe UI", monospace';
  ctx.fillStyle = '#3b5045';
  ctx.fillText(`🛠️ ${truncateText(ctx, isCodex ? S.s2Tool : S.s1Tool, iw - 20)}`, sx + pad + 10, ey + 13);

  if (isCodex) {
    ctx.fillStyle = '#fee2e2';
    ctx.fillRect(sx + pad + 8, ey + 28, iw - 16, 16);
    ctx.font = '500 10px Consolas, monospace';
    ctx.fillStyle = '#991b1b';
    ctx.fillText('- const decoded = jwt.verify(token, SECRET);', sx + pad + 12, ey + 36);
    ctx.fillStyle = '#dcfce7';
    ctx.fillRect(sx + pad + 8, ey + 46, iw - 16, 16);
    ctx.fillStyle = '#166534';
    ctx.fillText('+ const decoded = await verifyRs256(token, pubKey);', sx + pad + 12, ey + 54);
    ey += 76;
  } else {
    ctx.font = '500 10.5px Consolas, monospace';
    ctx.fillStyle = '#166534';
    ctx.fillText('PASS test/webhook.spec.ts (12 passed in 0.8s)', sx + pad + 12, ey + 42);
    ctx.fillStyle = '#6a7c72';
    ctx.fillText('⏱ 0.8s · ⚡ exit 0', sx + pad + 12, ey + 60);
    ey += 88;
  }

  // Follow-up Event in Conversation Stream
  if (!isCodex) {
    // Claude AI reply
    ctx.font = '600 10px "Segoe UI", sans-serif';
    ctx.fillStyle = '#698275';
    ctx.fillText('AI (Claude) · 14:21', sx + pad, ey + 6);
    ey += 14;
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#dce5df';
    roundRect(ctx, sx + pad, ey, iw, 54, 8, true, true);
    ctx.font = '400 11.5px "Segoe UI", sans-serif';
    ctx.fillStyle = '#3b4b41';
    ctx.textBaseline = 'alphabetic';
    drawWrappedText(ctx, S.s1Ai, sx + pad + 10, ey + 18, iw - 20, 17, 2);
  } else if (voiceSent) {
    // Show sent voice message & AI completion inside Codex mobile stream
    ctx.textBaseline = 'middle';
    ctx.font = '600 10px "Segoe UI", sans-serif';
    ctx.fillStyle = '#047857';
    ctx.fillText('你 (🎙️ 语音输入) · 14:22', sx + pad, ey + 5);
    ey += 13;
    ctx.fillStyle = '#ecfdf5';
    ctx.strokeStyle = '#10b981';
    roundRect(ctx, sx + pad, ey, iw, 42, 8, true, true);
    ctx.font = '400 11px "Segoe UI", sans-serif';
    ctx.fillStyle = '#1e2b24';
    ctx.textBaseline = 'alphabetic';
    drawWrappedText(ctx, S.voiceTranscript, sx + pad + 10, ey + 16, iw - 20, 15, 2);
  } else {
    ctx.textBaseline = 'middle';
    ctx.font = '600 10px "Segoe UI", sans-serif';
    ctx.fillStyle = '#698275';
    ctx.fillText('AI (Codex) · 14:21', sx + pad, ey + 5);
    ey += 13;
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#e4ece7';
    roundRect(ctx, sx + pad, ey, iw, 40, 8, true, true);
    ctx.font = '400 11px "Segoe UI", sans-serif';
    ctx.fillStyle = '#3b4b41';
    ctx.textBaseline = 'alphabetic';
    drawWrappedText(ctx, S.s2AiWait, sx + pad + 10, ey + 16, iw - 20, 15, 2);
  }

  // 4. .interaction Panel at bottom of Expanded Mobile Card (matches src/InteractionPanel.tsx & src/ChatComposer.tsx)
  const intY = curY + scrollH;
  const intH = sy + sh - intY - 36;
  ctx.fillStyle = '#f2f5f3';
  ctx.fillRect(sx, intY, sw, intH);
  ctx.strokeStyle = '#dfe6e1';
  ctx.beginPath();
  ctx.moveTo(sx, intY);
  ctx.lineTo(sx + sw, intY);
  ctx.stroke();

  let iy = intY + 10;
  // .interactionHeading
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.font = '700 11.5px "Segoe UI", sans-serif';
  ctx.fillStyle = '#23332e';
  const phaseLabel = isCodex ? (isApproved ? S.phaseCompleted : S.phaseWaiting) : S.phaseRunning;
  ctx.fillText(phaseLabel, sx + pad, iy + 6);

  ctx.textAlign = 'right';
  ctx.font = '400 10px "Segoe UI", sans-serif';
  ctx.fillStyle = '#62716a';
  ctx.fillText(S.keepOpenHint, sx + sw - pad, iy + 6);
  iy += 20;

  // .permission Approval Box (shown on Codex session)
  if (isCodex) {
    const permH = 88;
    ctx.fillStyle = isApproved ? '#f8fbf9' : '#fafcfb';
    ctx.strokeStyle = isApproved ? '#10b981' : '#e6cd9e';
    ctx.lineWidth = 1.5;
    roundRect(ctx, sx + pad, iy, iw, permH, 8, true, true);

    ctx.textAlign = 'left';
    ctx.font = '700 11.5px "Segoe UI", sans-serif';
    ctx.fillStyle = isApproved ? '#1e523f' : '#986c23';
    ctx.fillText(isApproved ? S.approvedBanner : S.approvalTitle, sx + pad + 10, iy + 18);

    if (isApproved) {
      ctx.font = '500 11px "Segoe UI", sans-serif';
      ctx.fillStyle = '#15803d';
      ctx.textBaseline = 'alphabetic';
      drawWrappedText(ctx, S.aiReplyAfterVoice, sx + pad + 10, iy + 42, iw - 20, 16, 2);
    } else {
      // [拒绝本次] (.denyButton) & [✓ 允许本次] (.allowButton)
      const bw = (iw - 28) / 2;
      const by2 = iy + 38;
      ctx.fillStyle = '#edf1ef';
      ctx.strokeStyle = '#d4ded8';
      ctx.lineWidth = 1;
      roundRect(ctx, sx + pad + 10, by2, bw, 36, 6, true, true);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = '600 11.5px "Segoe UI", sans-serif';
      ctx.fillStyle = '#55675c';
      ctx.fillText(S.btnDeny, sx + pad + 10 + bw / 2, by2 + 18);

      const allowX = sx + pad + 18 + bw;
      ctx.fillStyle = '#25835b';
      ctx.strokeStyle = '#1e6d4c';
      roundRect(ctx, allowX, by2, bw, 36, 6, true, true);
      ctx.font = '700 11.5px "Segoe UI", sans-serif';
      ctx.fillStyle = '#ffffff';
      ctx.fillText(S.btnAllow, allowX + bw / 2, by2 + 18);
    }
    iy += permH + 10;
  }

  // .composerBox (ChatComposer.tsx: Label + Multilingual Pills + Textarea + .composerTools + Send Row)
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.font = '600 11px "Segoe UI", sans-serif';
  ctx.fillStyle = '#23332e';
  ctx.fillText(S.composerLabel, sx + pad, iy + 8);

  // Multilingual speech recognition pills on right of composer label
  let lpx = sx + sw - pad;
  for (let i = S.voiceLangPills.length - 1; i >= 0; i--) {
    const pill = S.voiceLangPills[i];
    ctx.font = i === 0 ? '700 9.5px "Segoe UI", sans-serif' : '500 9.5px "Segoe UI", sans-serif';
    const pw = ctx.measureText(pill).width + 12;
    lpx -= pw;
    ctx.fillStyle = i === 0 ? '#e5f2eb' : '#ffffff';
    ctx.strokeStyle = i === 0 ? '#25634f' : '#d5ded9';
    ctx.lineWidth = 1;
    roundRect(ctx, lpx, iy, pw, 17, 999, true, true);
    ctx.fillStyle = i === 0 ? '#1e523f' : '#65756b';
    ctx.textAlign = 'center';
    ctx.fillText(pill, lpx + pw / 2, iy + 8.5);
    lpx -= 4;
  }
  iy += 22;

  // .composer textarea
  const taH = isCodex ? 88 : 96;
  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = isVoiceActive ? '#2e7d5b' : '#c6d2ca';
  ctx.lineWidth = isVoiceActive ? 1.8 : 1;
  roundRect(ctx, sx + pad, iy, iw, taH, 8, true, true);

  const dictRatio = isCodex ? clamp((t - 7.3) / 2.3, 0, 1) : 0;
  const dictLen = Math.floor(S.voiceTranscript.length * dictRatio);
  const shownText = (isCodex && t >= 7.1 && !voiceSent)
    ? S.voiceTranscript.slice(0, dictLen) + (isVoiceActive ? ' ▋' : '')
    : '';

  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  if (shownText) {
    ctx.font = '400 12px "Segoe UI", sans-serif';
    ctx.fillStyle = '#20372b';
    drawWrappedText(ctx, shownText, sx + pad + 10, iy + 20, iw - 20, 17, 2);
  } else {
    ctx.font = '400 11.5px "Segoe UI", sans-serif';
    ctx.fillStyle = '#98a39c';
    ctx.fillText(S.composerPlaceholder, sx + pad + 10, iy + 22);
  }

  // Live acoustic voice waveform inside bottom of textarea when voice is active
  if (isCodex) {
    const wy = iy + taH - 26;
    ctx.fillStyle = isVoiceActive ? '#ecfdf5' : '#f4f7f5';
    roundRect(ctx, sx + pad + 8, wy, iw - 16, 20, 5, true, false);
    for (let b = 0; b < 22; b++) {
      const amp = isVoiceActive
        ? 3 + Math.abs(Math.sin(t * 14 + b * 0.55) * Math.cos(t * 7 - b * 0.3)) * 13
        : 3;
      ctx.fillStyle = isVoiceActive ? (b % 2 === 0 ? '#10b981' : '#059669') : '#cbd5e1';
      roundRect(ctx, sx + pad + 16 + b * 7.5, wy + 10 - amp / 2, 4, amp, 1.5, true, false);
    }
  }
  iy += taH + 8;

  // .composerTools ([📎 添加附件] [🎙️ 语音输入 / 🎙️ 停止识别] + ● 正在聆听，请说话…)
  ctx.textBaseline = 'middle';
  ctx.font = '500 11px "Segoe UI", sans-serif';
  const attBtnW = ctx.measureText(S.attachBtn).width + 18;
  ctx.fillStyle = '#e5ece8';
  ctx.strokeStyle = '#ccd8d1';
  ctx.lineWidth = 1;
  roundRect(ctx, sx + pad, iy, attBtnW, 28, 6, true, true);
  ctx.fillStyle = '#435e50';
  ctx.textAlign = 'center';
  ctx.fillText(S.attachBtn, sx + pad + attBtnW / 2, iy + 14);

  const vLabel = isVoiceActive ? S.voiceBtnActive : S.voiceBtnIdle;
  ctx.font = isVoiceActive ? '700 11px "Segoe UI", sans-serif' : '500 11px "Segoe UI", sans-serif';
  const vBtnW = ctx.measureText(vLabel).width + 20;
  const vx = sx + pad + attBtnW + 6;
  ctx.fillStyle = isVoiceActive ? '#fde8e8' : '#e5ece8';
  ctx.strokeStyle = isVoiceActive ? '#f5b7b7' : '#ccd8d1';
  ctx.lineWidth = isVoiceActive ? 1.5 : 1;
  roundRect(ctx, vx, iy, vBtnW, 28, 6, true, true);
  ctx.fillStyle = isVoiceActive ? '#c62828' : '#435e50';
  ctx.fillText(vLabel, vx + vBtnW / 2, iy + 14);

  if (isVoiceActive) {
    ctx.textAlign = 'left';
    ctx.font = '600 10.5px "Segoe UI", sans-serif';
    ctx.fillStyle = '#c62828';
    ctx.fillText(truncateText(ctx, S.voiceListening, sx + sw - pad - (vx + vBtnW + 8)), vx + vBtnW + 8, iy + 14);
  }
  iy += 36;

  // .interactionActions bottom row (Hint + [发送] button)
  ctx.textAlign = 'left';
  ctx.font = '400 10px "Segoe UI", sans-serif';
  ctx.fillStyle = '#62716a';
  ctx.fillText(truncateText(ctx, S.composerHint, iw - 86), sx + pad, iy + 16);

  const sendW = 76;
  const sendX = sx + sw - pad - sendW;
  ctx.fillStyle = (isCodex && (shownText || voiceSent)) ? '#1c523e' : '#edf1ef';
  roundRect(ctx, sendX, iy, sendW, 32, 7, true, false);
  ctx.textAlign = 'center';
  ctx.font = '600 12px "Segoe UI", sans-serif';
  ctx.fillStyle = (isCodex && (shownText || voiceSent)) ? '#ffffff' : '#65756b';
  ctx.fillText(S.btnSend, sendX + sendW / 2, iy + 16);

  // 5. .cardFooter at bottom of expanded card ([✓ 标记已读] ... [收纳])
  const cfY = sy + sh - 36;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(sx, cfY, sw, 36);
  ctx.strokeStyle = '#e6ece8';
  ctx.beginPath();
  ctx.moveTo(sx, cfY);
  ctx.lineTo(sx + sw, cfY);
  ctx.stroke();

  ctx.font = '500 10.5px "Segoe UI", sans-serif';
  ctx.fillStyle = '#f0f4f1';
  roundRect(ctx, sx + pad, cfY + 6, 80, 24, 6, true, false);
  ctx.fillStyle = '#56715e';
  ctx.textAlign = 'center';
  ctx.fillText(S.markRead, sx + pad + 40, cfY + 18);

  ctx.textAlign = 'right';
  ctx.fillStyle = '#879289';
  ctx.fillText(S.archive, sx + sw - pad - 4, cfY + 18);

  ctx.restore();
}

function drawTouchAndMouse(t) {
  if (t > 13.0) return;
  const waypoints = [
    // 1. Click [📱 手机远程] on PC topbar
    { t: 0.0, x: 1680, y: 110 },
    { t: 0.3, x: 1825, y: 35, click: true },
    // 2. Move to Portrait Phone Board List -> Tap [交互] on Session 1 (Claude) at t=3.4s
    { t: 1.5, x: 1670, y: 546 },
    { t: 3.4, x: 1670, y: 546, click: true },
    // 3. Inside Session 1 (Claude), tap [← 返回列表] (.mobileBackBtn) at t=5.0s
    { t: 4.2, x: 1620, y: 360 },
    { t: 5.0, x: 1521, y: 216, click: true },
    // 4. Back on Board List, scroll & tap [⚡ 交互] on Session 2 (Codex) at t=6.4s
    { t: 5.8, x: 1670, y: 647 },
    { t: 6.4, x: 1670, y: 647, click: true },
    // 5. Inside Session 2 (Codex), tap [🎙️ 语音输入] in ChatComposer at t=7.1s
    { t: 6.9, x: 1618, y: 760 },
    { t: 7.1, x: 1618, y: 760, click: true },
    { t: 9.5, x: 1618, y: 760 },
    // 6. Tap [发送] on Phone at t=10.1s
    { t: 9.95, x: 1806, y: 798 },
    { t: 10.1, x: 1806, y: 798, click: true },
    // 7. Tap [✓ 允许本次] (.allowButton) on Phone at t=11.35s
    { t: 11.0, x: 1743, y: 586 },
    { t: 11.35, x: 1743, y: 586, click: true },
    { t: 12.6, x: 1670, y: 540 }
  ];

  let p0 = waypoints[0], p1 = waypoints[waypoints.length - 1];
  for (let i = 0; i < waypoints.length - 1; i++) {
    if (t >= waypoints[i].t && t <= waypoints[i + 1].t) {
      p0 = waypoints[i];
      p1 = waypoints[i + 1];
      break;
    }
  }
  const segDur = Math.max(0.001, p1.t - p0.t);
  const ratio = easeInOutQuad(clamp((t - p0.t) / segDur, 0, 1));
  const mx = p0.x + (p1.x - p0.x) * ratio;
  const my = p0.y + (p1.y - p0.y) * ratio;

  for (const wp of waypoints) {
    if (wp.click && t >= wp.t && t <= wp.t + 0.4) {
      const rp = (t - wp.t) / 0.4;
      ctx.save();
      ctx.strokeStyle = `rgba(16, 185, 129, ${1 - rp})`;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(wp.x, wp.y, 8 + rp * 28, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  }

  ctx.save();
  ctx.translate(mx, my);
  if (mx > 1420) {
    ctx.fillStyle = 'rgba(16, 185, 129, 0.38)';
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(0, 0, 13, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  } else {
    ctx.fillStyle = '#1e2b24';
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(0, 19);
    ctx.lineTo(4.8, 14.8);
    ctx.lineTo(8.8, 22.5);
    ctx.lineTo(11.8, 21);
    ctx.lineTo(7.8, 13.2);
    ctx.lineTo(13.8, 13.2);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }
  ctx.restore();
}

function drawFooterSubtitle(t, S) {
  ctx.save();
  ctx.fillStyle = 'rgba(15, 23, 42, 0.96)';
  ctx.fillRect(0, 995, 1920, 85);

  let activeSubtitle = S.subtitles[S.subtitles.length - 1];
  for (const s of S.subtitles) {
    if (t < s.tEnd) {
      activeSubtitle = s;
      break;
    }
  }

  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.font = '700 16px "Plus Jakarta Sans", "Segoe UI", sans-serif';
  ctx.fillStyle = '#ffffff';
  ctx.fillText(activeSubtitle.text, 960, 1030);

  ctx.font = '500 13px "JetBrains Mono", "Segoe UI", monospace';
  ctx.fillStyle = '#34d399';
  ctx.fillText(activeSubtitle.sub, 960, 1058);
  ctx.restore();
}

function drawMobileOutro(st, S) {
  const p = clamp(st / 0.45, 0, 1);
  ctx.save();
  ctx.fillStyle = `rgba(15, 23, 42, ${p * 0.95})`;
  ctx.fillRect(0, 0, 1920, 995);

  ctx.globalAlpha = p;
  drawAgentProviderBadge(ctx, 'codex', 960 - 76, 260, 44, true);
  drawAgentProviderBadge(ctx, 'claude', 960 - 22, 260, 44, true);
  drawAgentProviderBadge(ctx, 'antigravity', 960 + 32, 260, 44, true);

  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.font = '800 44px "Plus Jakarta Sans", "Segoe UI", sans-serif';
  ctx.fillStyle = '#ffffff';
  ctx.fillText(S.outroTitle, 960, 375);

  ctx.font = '500 18px "JetBrains Mono", "Segoe UI", monospace';
  ctx.fillStyle = '#34d399';
  ctx.fillText(S.outroSubtitle, 960, 425);

  ctx.font = '600 14px "JetBrains Mono", "Segoe UI", monospace';
  const badgeW = Math.max(520, ctx.measureText(S.outroBadge).width + 44);
  ctx.fillStyle = 'rgba(16, 185, 129, 0.14)';
  ctx.strokeStyle = 'rgba(16, 185, 129, 0.4)';
  ctx.lineWidth = 1;
  roundRect(ctx, 960 - badgeW / 2, 456, badgeW, 38, 999, true, true);
  ctx.fillStyle = '#d1fae5';
  ctx.textBaseline = 'middle';
  ctx.fillText(S.outroBadge, 960, 475);

  ctx.fillStyle = 'rgba(30, 41, 59, 0.92)';
  ctx.strokeStyle = 'rgba(56, 189, 248, 0.45)';
  roundRect(ctx, 960 - 320, 516, 640, 56, 10, true, true);
  ctx.font = '600 16px "JetBrains Mono", Consolas, monospace';
  ctx.fillStyle = '#38bdf8';
  ctx.fillText(S.outroCommand, 960, 544);

  ctx.textBaseline = 'alphabetic';
  ctx.font = '400 13.5px "JetBrains Mono", "Segoe UI", monospace';
  ctx.fillStyle = '#94a3b8';
  ctx.fillText(S.outroFootnote, 960, 618);
  ctx.restore();
}

let lastSoundCheck = -1;

function updateUIStrings() {
  const S = getStrings();
  document.title = S.pageTitle;
  uiBrandTitle.textContent = S.brandTitle;
  uiBrandBadge.textContent = S.brandBadge;
  if (linkDesktopVideo) {
    linkDesktopVideo.textContent = S.switchDesktop;
    linkDesktopVideo.href = `index.html?lang=${currentLocale}`;
  }
  if (linkMobileVideo) {
    linkMobileVideo.textContent = S.switchMobile;
    linkMobileVideo.href = `mobile.html?lang=${currentLocale}`;
  }
  playBtn.textContent = isPlaying ? S.pause : S.play;
  restartBtn.textContent = S.restart;
  soundBtn.textContent = audioEnabled ? S.soundOn : S.soundOff;
  snapshotBtn.textContent = S.snapshot;
  exportBtn.textContent = S.exportVideo;
  renderStatus.textContent = S.statusReady(FPS, TOTAL_DURATION);

  chapterBar.innerHTML = '';
  S.chapters.forEach((ch) => {
    const pill = document.createElement('div');
    pill.className = 'chapter-pill';
    pill.dataset.time = ch.t;
    pill.innerHTML = `<span class="dot"></span><span>${ch.label}</span>`;
    pill.addEventListener('click', () => seekTo(ch.t));
    chapterBar.appendChild(pill);
  });
}

function updateChapterActive(t) {
  const S = getStrings();
  const pills = chapterBar.querySelectorAll('.chapter-pill');
  let activeIdx = 0;
  for (let i = 0; i < S.chapters.length; i++) {
    if (t >= S.chapters[i].t) activeIdx = i;
  }
  pills.forEach((p, idx) => {
    if (idx === activeIdx) p.classList.add('active');
    else p.classList.remove('active');
  });
}

function seekTo(t) {
  currentFrame = Math.round(t * FPS);
  renderFrame(t);
  updateChapterActive(t);
  const secStr = Math.floor(t).toString().padStart(2, '0');
  const msStr = Math.floor((t % 1) * 100).toString().padStart(2, '0');
  timeText.textContent = `00:${secStr}.${msStr} / 00:15.00`;
  timelineProgress.style.width = `${(t / TOTAL_DURATION) * 100}%`;
}
window.seekTo = seekTo;

function tick() {
  if (isPlaying) {
    currentFrame += playbackSpeed;
    if (currentFrame >= TOTAL_FRAMES) currentFrame = 0;
  }
  const t = currentFrame / FPS;
  renderFrame(t);
  updateChapterActive(t);

  const curSec10 = Math.floor(t * 10);
  if (curSec10 !== lastSoundCheck) {
    lastSoundCheck = curSec10;
    if (curSec10 === 3) playSound('click');
    else if (curSec10 === 11) playSound('scan');
    else if (curSec10 === 34) playSound('click');
    else if (curSec10 === 50) playSound('click');
    else if (curSec10 === 64) playSound('click');
    else if (curSec10 === 71) playSound('voice');
    else if (curSec10 === 101) playSound('click');
    else if (curSec10 === 114) playSound('approve');
  }

  timelineProgress.style.width = `${(currentFrame / TOTAL_FRAMES) * 100}%`;
  const secStr = Math.floor(t).toString().padStart(2, '0');
  const msStr = Math.floor((t % 1) * 100).toString().padStart(2, '0');
  timeText.textContent = `00:${secStr}.${msStr} / 00:15.00`;

  if (isPlaying) {
    animationId = requestAnimationFrame(tick);
  }
}

function takeSnapshot() {
  const t = currentFrame / FPS;
  const link = document.createElement('a');
  link.download = `agent-board-mobile-showcase-${currentLocale}-${t.toFixed(1)}s.png`;
  link.href = canvas.toDataURL('image/png');
  link.click();
}

async function exportVideo() {
  if (isRecording) return;
  const S = getStrings();
  isRecording = true;
  isPlaying = false;
  cancelAnimationFrame(animationId);
  exportBtn.disabled = true;
  exportBtn.textContent = S.exportingVideo;
  renderStatus.textContent = S.statusRecording;

  const stream = canvas.captureStream(FPS);
  let options = { mimeType: 'video/webm;codecs=vp9', videoBitsPerSecond: 12000000 };
  if (!MediaRecorder.isTypeSupported(options.mimeType)) {
    options = { mimeType: 'video/webm' };
  }

  const recorder = new MediaRecorder(stream, options);
  const chunks = [];
  recorder.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data); };
  recorder.onstop = () => {
    const blob = new Blob(chunks, { type: 'video/webm' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `agent-board-mobile-showcase-${currentLocale}.webm`;
    a.click();
    URL.revokeObjectURL(url);

    exportBtn.disabled = false;
    exportBtn.textContent = S.exportVideo;
    renderStatus.textContent = S.statusComplete;
    isRecording = false;
    isPlaying = true;
    currentFrame = 0;
    animationId = requestAnimationFrame(tick);
  };

  recorder.start();
  for (let f = 0; f < TOTAL_FRAMES; f++) {
    currentFrame = f;
    renderFrame(f / FPS);
    const pct = Math.floor((f / TOTAL_FRAMES) * 100);
    renderStatus.textContent = `STATUS: RENDERING ${pct}% [${f}/${TOTAL_FRAMES}]`;
    await new Promise(r => setTimeout(r, 1000 / FPS));
  }
  recorder.stop();
}

document.querySelectorAll('.lang-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const lang = btn.dataset.lang;
    document.querySelectorAll('.lang-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentLocale = lang;
    localStorage.setItem('agent_board_promo_lang', lang);
    updateUIStrings();
    renderFrame(currentFrame / FPS);
  });
});

document.querySelectorAll('.lang-btn').forEach(b => {
  if (b.dataset.lang === currentLocale) b.classList.add('active');
  else b.classList.remove('active');
});

playBtn.addEventListener('click', () => {
  const S = getStrings();
  isPlaying = !isPlaying;
  playBtn.textContent = isPlaying ? S.pause : S.play;
  if (isPlaying) {
    getAudioContext();
    animationId = requestAnimationFrame(tick);
  }
});

restartBtn.addEventListener('click', () => {
  const S = getStrings();
  currentFrame = 0;
  isPlaying = true;
  playBtn.textContent = S.pause;
  getAudioContext();
  if (animationId) cancelAnimationFrame(animationId);
  animationId = requestAnimationFrame(tick);
});

soundBtn.addEventListener('click', () => {
  const S = getStrings();
  audioEnabled = !audioEnabled;
  soundBtn.textContent = audioEnabled ? S.soundOn : S.soundOff;
  if (audioEnabled) getAudioContext();
});

speedBtn.addEventListener('click', () => {
  if (playbackSpeed === 1.0) playbackSpeed = 1.5;
  else if (playbackSpeed === 1.5) playbackSpeed = 2.0;
  else if (playbackSpeed === 2.0) playbackSpeed = 0.5;
  else playbackSpeed = 1.0;
  speedBtn.textContent = `${playbackSpeed.toFixed(1)}x`;
});

snapshotBtn.addEventListener('click', takeSnapshot);
exportBtn.addEventListener('click', exportVideo);

timeline.addEventListener('click', (e) => {
  const rect = timeline.getBoundingClientRect();
  const ratio = clamp((e.clientX - rect.left) / rect.width, 0, 1);
  seekTo(ratio * TOTAL_DURATION);
});

window.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
  if (e.code === 'Space') { e.preventDefault(); playBtn.click(); }
  else if (e.code === 'KeyR') restartBtn.click();
  else if (e.code === 'KeyM') soundBtn.click();
  else if (e.code === 'KeyS') takeSnapshot();
  else if (e.code === 'Digit1') document.querySelector('.lang-btn[data-lang="en-US"]')?.click();
  else if (e.code === 'Digit2') document.querySelector('.lang-btn[data-lang="zh-CN"]')?.click();
  else if (e.code === 'Digit3') document.querySelector('.lang-btn[data-lang="zh-TW"]')?.click();
  else if (e.code === 'Digit4') document.querySelector('.lang-btn[data-lang="ja-JP"]')?.click();
  else if (e.code === 'ArrowLeft') seekTo(Math.max(0, (currentFrame / FPS) - 1.0));
  else if (e.code === 'ArrowRight') seekTo(Math.min(TOTAL_DURATION, (currentFrame / FPS) + 1.0));
});

updateUIStrings();

const urlParams = new URLSearchParams(window.location.search);
if (urlParams.has('t')) {
  const seekT = parseFloat(urlParams.get('t'));
  isPlaying = false;
  playBtn.textContent = getStrings().play;
  seekTo(seekT);
} else {
  animationId = requestAnimationFrame(tick);
}
