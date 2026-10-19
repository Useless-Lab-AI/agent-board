import type { SupportedLocale } from './types.js';

const EXACT_MAP: Record<string, { 'zh-TW': string; 'en-US': string; 'ja-JP': string }> = {
  // ClaudeClient
  'Claude 正在响应并执行中；可在 VS Code 或在此继续交互。': {
    'zh-TW': 'Claude 正在回應並執行中；可在 VS Code 或在此繼續互動。',
    'en-US': 'Claude is responding and executing; you can continue interacting in VS Code or here.',
    'ja-JP': 'Claude が応答・実行中です。VS Code またはここから対話を続けられます。',
  },
  '已连接 Claude 原生会话（透明标准输入桥接在线，具备完全用户权限）；在此输入可直接与 Claude 继续对话。': {
    'zh-TW': '已連線 Claude 原生會話（透明標準輸入橋接在線，具備完整使用者權限）；在此輸入可直接與 Claude 繼續對話。',
    'en-US': 'Connected to native Claude session (transparent stdin bridge online with full user permissions); type here to continue chatting with Claude.',
    'ja-JP': 'Claude ネイティブセッションに接続済み（透過標準入力ブリッジがオンライン、完全なユーザー権限あり）。ここに入力して Claude と直接対話を続けられます。',
  },
  'Claude 正在响应并执行中；执行完成后可继续发送。': {
    'zh-TW': 'Claude 正在回應並執行中；執行完成後可繼續發送。',
    'en-US': 'Claude is responding and executing; you can continue sending after completion.',
    'ja-JP': 'Claude が応答・実行中です。完了後に続けて送信できます。',
  },
  'Claude 正在原客户端执行任务；请等待当前回复完成后继续交互。': {
    'zh-TW': 'Claude 正在原用戶端執行任務；請等待目前回覆完成後繼續互動。',
    'en-US': 'Claude is executing a task in the original client; please wait for the current reply to finish.',
    'ja-JP': 'Claude が元のクライアントでタスクを実行中です。現在の応答が完了するまでお待ちください。',
  },
  '已连接 Claude 原生会话；在此输入将以真实用户身份直接续接（不会触发跨会话提示）。': {
    'zh-TW': '已連線 Claude 原生會話；在此輸入將以真實使用者身分直接續接（不會觸發跨會話提示）。',
    'en-US': 'Connected to native Claude session; typing here continues directly as the authentic user (without cross-session prompts).',
    'ja-JP': 'Claude ネイティブセッションに接続済み。ここに入力すると本人として直接続行されます（別セッション警告は発生しません）。',
  },
  'AI 响应已完成；在此输入即可直接续接此会话。': {
    'zh-TW': 'AI 回應已完成；在此輸入即可直接續接此會話。',
    'en-US': 'AI response completed; type here to directly continue this session.',
    'ja-JP': 'AI の応答が完了しました。ここに入力してこのセッションを直接続行できます。',
  },
  '已连接 Claude 原生会话（IPC 管道在线）；在此输入可直接与 Claude 继续对话。': {
    'zh-TW': '已連線 Claude 原生會話（IPC 管道在線）；在此輸入可直接與 Claude 繼續對話。',
    'en-US': 'Connected to native Claude session (IPC pipe online); type here to continue chatting with Claude.',
    'ja-JP': 'Claude ネイティブセッションに接続済み（IPC パイプがオンライン）。ここに入力して Claude と直接対話を続けられます。',
  },
  'Claude 正在响应并执行中；可在原客户端或在此继续交互。': {
    'zh-TW': 'Claude 正在回應並執行中；可在原用戶端或在此繼續互動。',
    'en-US': 'Claude is responding and executing; you can continue interacting in the original client or here.',
    'ja-JP': 'Claude が応答・実行中です。元のクライアントまたはここから対話を続けられます。',
  },
  '消息已写入 Channel，等待 Claude 确认收到；执行进度以上方原生记录为准。': {
    'zh-TW': '訊息已寫入 Channel，等待 Claude 確認收到；執行進度以上方原生記錄為準。',
    'en-US': 'Message written to Channel, waiting for Claude to acknowledge; see native records above for progress.',
    'ja-JP': 'メッセージが Channel に書き込まれました。Claude の受信確認待ちです（進捗は上部のネイティブ記録を参照）。',
  },
  '已连接 Claude 原生会话；在此输入可直接与 Claude 继续对话。': {
    'zh-TW': '已連線 Claude 原生會話；在此輸入可直接與 Claude 繼續對話。',
    'en-US': 'Connected to native Claude session; type here to continue chatting with Claude.',
    'ja-JP': 'Claude ネイティブセッションに接続済み。ここに入力して Claude と直接対話を続けられます。',
  },
  'Claude 正在执行中': {
    'zh-TW': 'Claude 正在執行中',
    'en-US': 'Claude is running',
    'ja-JP': 'Claude が実行中です',
  },
  '原生 Claude 进程存活且处于就绪状态': {
    'zh-TW': '原生 Claude 程序存活且處於就緒狀態',
    'en-US': 'Native Claude process is alive and ready',
    'ja-JP': 'ネイティブ Claude プロセスが稼働中で待機状態です',
  },
  'Claude 正在等待工具审批确认；可在此直接允许/拒绝，或在原客户端处理。': {
    'zh-TW': 'Claude 正在等待工具審批確認；可在此直接允許/拒絕，或在原用戶端處理。',
    'en-US': 'Claude is waiting for tool approval; you can allow/deny directly here or handle it in the original client.',
    'ja-JP': 'Claude がツールの承認を待っています。ここで直接許可/拒否するか、元のクライアントで処理できます。',
  },
  'Claude 正在等待你回答问题；可在此直接提交回答，或在原客户端处理。': {
    'zh-TW': 'Claude 正在等待你回答問題；可在此直接提交回答，或在原用戶端處理。',
    'en-US': 'Claude is waiting for your answer; you can submit your answer here or handle it in the original client.',
    'ja-JP': 'Claude が回答を待っています。ここで直接回答を送信するか、元のクライアントで処理できます。',
  },

  // CodexClient
  '原客户端正在执行中；两端共用此会话，无需退出。': {
    'zh-TW': '原用戶端正在執行中；兩端共用此會話，無需退出。',
    'en-US': 'Original client is running; both ends share this session without needing to exit.',
    'ja-JP': '元のクライアントが実行中です。両端でこのセッションを共有しているため終了は不要です。',
  },
  '已连接原客户端；两端共用此会话，无需退出。': {
    'zh-TW': '已連線原用戶端；兩端共用此會話，無需退出。',
    'en-US': 'Connected to original client; both ends share this session without needing to exit.',
    'ja-JP': '元のクライアントに接続済み。両端でこのセッションを共有しているため終了は不要です。',
  },
  '正在同步原客户端会话数据…': {
    'zh-TW': '正在同步原用戶端會話資料…',
    'en-US': 'Syncing session data from original client…',
    'ja-JP': '元のクライアントのセッションデータを同期中…',
  },
  '原客户端有暂不支持的确认，请在原客户端处理。': {
    'zh-TW': '原用戶端有暫不支援的確認，請在原用戶端處理。',
    'en-US': 'Original client has an unsupported confirmation prompt; please handle it in the original client.',
    'ja-JP': '元のクライアントに未対応の確認プロンプトがあります。元のクライアントで処理してください。',
  },
  '允许执行命令？': {
    'zh-TW': '允許執行命令？',
    'en-US': 'Allow command execution?',
    'ja-JP': 'コマンドの実行を許可しますか？',
  },
  '允许修改文件？': {
    'zh-TW': '允許修改檔案？',
    'en-US': 'Allow file modification?',
    'ja-JP': 'ファイルの変更を許可しますか？',
  },
  'AI 需要你的回答': {
    'zh-TW': 'AI 需要你的回答',
    'en-US': 'AI needs your answer',
    'ja-JP': 'AI があなたの回答を求めています',
  },

  // Antigravity
  '智能体正在处理发送的消息': {
    'zh-TW': '智能體正在處理發送的訊息',
    'en-US': 'Agent is processing the sent message',
    'ja-JP': 'エージェントが送信メッセージを処理中',
  },
  '智能体正在思考回复': {
    'zh-TW': '智能體正在思考回覆',
    'en-US': 'Agent is thinking',
    'ja-JP': 'エージェントが思考中',
  },
  'Antigravity 系统就绪': {
    'zh-TW': 'Antigravity 系統就緒',
    'en-US': 'Antigravity system ready',
    'ja-JP': 'Antigravity システム準備完了',
  },
  '智能体正在等待用户回答问题': {
    'zh-TW': '智能體正在等待使用者回答問題',
    'en-US': 'Agent is waiting for user answer',
    'ja-JP': 'エージェントがユーザーの回答を待っています',
  },
  'Antigravity 会话就绪 / 空闲': {
    'zh-TW': 'Antigravity 會話就緒 / 閒置',
    'en-US': 'Antigravity session ready / idle',
    'ja-JP': 'Antigravity セッション準備完了 / 待機中',
  },
  'Antigravity 会话就绪（上一轮已结束）': {
    'zh-TW': 'Antigravity 會話就緒（上一輪已結束）',
    'en-US': 'Antigravity session ready (previous turn finished)',
    'ja-JP': 'Antigravity セッション準備完了（前のターン完了）',
  },
  '智能体正在生成回复': {
    'zh-TW': '智能體正在生成回覆',
    'en-US': 'Agent is generating reply',
    'ja-JP': 'エージェントが応答を生成中',
  },
  '智能体正在执行工具': {
    'zh-TW': '智能體正在執行工具',
    'en-US': 'Agent is executing tool',
    'ja-JP': 'エージェントがツールを実行中',
  },
  '智能体正在处理工具返回结果': {
    'zh-TW': '智能體正在處理工具返回結果',
    'en-US': 'Agent is processing tool result',
    'ja-JP': 'エージェントがツール結果を処理中',
  },
  'Antigravity 会话已被终止': {
    'zh-TW': 'Antigravity 會話已被終止',
    'en-US': 'Antigravity session terminated',
    'ja-JP': 'Antigravity セッションは終了しました',
  },
  'Antigravity 会话元信息尚未确认': {
    'zh-TW': 'Antigravity 會話元資訊尚未確認',
    'en-US': 'Antigravity session metadata unconfirmed',
    'ja-JP': 'Antigravity セッションメタデータ未確認',
  },
  'Antigravity 会话正在执行中': {
    'zh-TW': 'Antigravity 會話正在執行中',
    'en-US': 'Antigravity session is running',
    'ja-JP': 'Antigravity セッションが実行中です',
  },
  'Antigravity 智能体正在启动执行': {
    'zh-TW': 'Antigravity 智能體正在啟動執行',
    'en-US': 'Antigravity agent is starting execution',
    'ja-JP': 'Antigravity エージェントが起動・実行中です',
  },
  'Antigravity 智能体正在等待你回答问题；可直接在此选择选项并提交，或在原客户端处理': {
    'zh-TW': 'Antigravity 智能體正在等待你回答問題；可直接在此選擇選項並提交，或在原用戶端處理',
    'en-US': 'Antigravity agent is waiting for your answer; select an option and submit here, or handle it in the original client',
    'ja-JP': 'Antigravity エージェントが回答を待っています。ここで選択肢を選んで送信するか、元のクライアントで処理してください',
  },

  // General / Readers
  '正在连接原客户端': {
    'zh-TW': '正在連線原用戶端',
    'en-US': 'Connecting to original client…',
    'ja-JP': '元のクライアントに接続中…',
  },
  '原生会话记录，当前执行状态尚未确认': {
    'zh-TW': '原生會話記錄，目前執行狀態尚未確認',
    'en-US': 'Native session record; current execution state unconfirmed',
    'ja-JP': 'ネイティブセッション記録（現在の実行状態は未確認）',
  },
  '已有原生记录，当前执行状态尚未确认': {
    'zh-TW': '已有原生記錄，目前執行狀態尚未確認',
    'en-US': 'Existing native record; current execution state unconfirmed',
    'ja-JP': '既存のネイティブ記録あり（現在の実行状態は未確認）',
  },
  '原生 assistant end_turn': {
    'zh-TW': '原生 assistant end_turn',
    'en-US': 'Native assistant end_turn',
    'ja-JP': 'ネイティブ assistant end_turn',
  },
  '原生工具执行中': {
    'zh-TW': '原生工具執行中',
    'en-US': 'Native tool executing',
    'ja-JP': 'ネイティブツール実行中',
  },
  '原生工具结果已落盘': {
    'zh-TW': '原生工具結果已落盤',
    'en-US': 'Native tool result written to disk',
    'ja-JP': 'ネイティブツール結果が保存されました',
  },
  '来源未知': {
    'zh-TW': '來源未知',
    'en-US': 'Unknown source',
    'ja-JP': 'ソース不明',
  },
  '此会话当前处于仅观察模式，请在原客户端中继续此会话。': {
    'zh-TW': '此會話目前處於僅檢視模式，請在原用戶端中繼續此會話。',
    'en-US': 'This session is currently in view-only mode. Please continue in the original client.',
    'ja-JP': 'このセッションは現在閲覧専用モードです。元のクライアントで続行してください。',
  },
  'content truncated: size limit exceeded（原生记录超过 256 KiB）': {
    'zh-TW': 'content truncated: size limit exceeded（原生記錄超過 256 KiB）',
    'en-US': 'Content truncated: size limit exceeded (native record exceeds 256 KiB)',
    'ja-JP': 'content truncated: size limit exceeded（ネイティブ記録が 256 KiB を超過）',
  },
  '原生记录无法解析；此行未作为有效内容处理': {
    'zh-TW': '原生記錄無法解析；此行未作為有效內容處理',
    'en-US': 'Unable to parse native record; this line was ignored',
    'ja-JP': 'ネイティブ記録を解析できません。この行は無視されました',
  },
  'content truncated: size limit exceeded（读取窗口内没有完整记录；继续加载更早内容）': {
    'zh-TW': 'content truncated: size limit exceeded（讀取視窗內沒有完整記錄；繼續載入更早內容）',
    'en-US': 'Content truncated: size limit exceeded (no complete record in read window; load earlier history)',
    'ja-JP': 'content truncated: size limit exceeded（読み込みウィンドウ内に完全な記録がありません。前の履歴を読み込んでください）',
  },
  '原生上下文已压缩；压缩前后历史的完整顺序无法确认': {
    'zh-TW': '原生上下文已壓縮；壓縮前後歷史的完整順序無法確認',
    'en-US': 'Native context compacted; full ordering across compaction boundary cannot be verified',
    'ja-JP': 'ネイティブコンテキストが圧縮されました。圧縮前後の履歴順序は完全には確認できません',
  },
  '原生上下文已压缩；压缩前历史由上下文摘要恢复': {
    'zh-TW': '原生上下文已壓縮；壓縮前歷史由上下文摘要恢復',
    'en-US': 'Native context compacted; pre-compaction history restored from context summary',
    'ja-JP': 'ネイティブコンテキストが圧縮されました。圧縮前の履歴は要約から復元されています',
  },
  '已观测任务开始，尚无当前运行端证据': {
    'zh-TW': '已觀測任務開始，尚無目前執行端證據',
    'en-US': 'Task start observed; no active runtime evidence yet',
    'ja-JP': 'タスク開始を検出しましたが、実行中プロセスの証拠はまだありません',
  },
  '原生日志 task_complete': {
    'zh-TW': '原生記錄 task_complete',
    'en-US': 'Native log task_complete',
    'ja-JP': 'ネイティブログ task_complete',
  },
  '原生回合已中断': {
    'zh-TW': '原生回合已中斷',
    'en-US': 'Native turn aborted',
    'ja-JP': 'ネイティブターンが中断されました',
  },
};

export function translateDynamicText(text: string | undefined, locale: SupportedLocale): string {
  if (!text) return '';
  if (locale === 'zh-CN') return text;

  const exact = EXACT_MAP[text];
  if (exact) return exact[locale];

  // Pattern: 未命名会话 · <id>
  if (text.startsWith('未命名会话 · ')) {
    const suffix = text.slice('未命名会话 · '.length);
    if (locale === 'zh-TW') return `未命名會話 · ${suffix}`;
    if (locale === 'en-US') return `Untitled Session · ${suffix}`;
    if (locale === 'ja-JP') return `無題のセッション · ${suffix}`;
  }

  // Pattern: Antigravity 智能体正在执行中（...）；执行完成后可继续发送
  const agRunMatch = text.match(/^Antigravity 智能体正在执行中（(.+)）；执行完成后可继续发送$/);
  if (agRunMatch) {
    const inner = translateDynamicText(agRunMatch[1], locale);
    if (locale === 'zh-TW') return `Antigravity 智能體正在執行中（${inner}）；執行完成後可繼續發送`;
    if (locale === 'en-US') return `Antigravity agent is running (${inner}); you can continue sending after completion.`;
    if (locale === 'ja-JP') return `Antigravity エージェントが実行中です（${inner}）。完了後に続けて送信できます。`;
  }

  // Pattern: 已连接 Antigravity 原生会话（...）；在此输入可继续与智能体对话
  const agReadyMatch = text.match(/^已连接 Antigravity 原生会话（(.+)）；在此输入可继续与智能体对话$/);
  if (agReadyMatch) {
    const inner = translateDynamicText(agReadyMatch[1], locale);
    if (locale === 'zh-TW') return `已連線 Antigravity 原生會話（${inner}）；在此輸入可繼續與智能體對話`;
    if (locale === 'en-US') return `Connected to native Antigravity session (${inner}); type here to continue chatting with the agent.`;
    if (locale === 'ja-JP') return `Antigravity ネイティブセッションに接続済み（${inner}）。ここに入力してエージェントと対話を続けられます。`;
  }

  // Pattern: 已连接 Antigravity 原生记录（...）；看板提供同屏实时观察
  const agObsMatch = text.match(/^已连接 Antigravity 原生记录（(.+)）；看板提供同屏实时观察$/);
  if (agObsMatch) {
    const inner = translateDynamicText(agObsMatch[1], locale);
    if (locale === 'zh-TW') return `已連線 Antigravity 原生記錄（${inner}）；看板提供同屏即時觀察`;
    if (locale === 'en-US') return `Connected to native Antigravity records (${inner}); real-time observation is active.`;
    if (locale === 'ja-JP') return `Antigravity ネイティブ記録に接続済み（${inner}）。リアルタイム閲覧が有効です。`;
  }

  // Pattern: 智能体正在调用工具: <tool>
  if (text.startsWith('智能体正在调用工具: ')) {
    const tool = text.slice('智能体正在调用工具: '.length);
    if (locale === 'zh-TW') return `智能體正在呼叫工具: ${tool}`;
    if (locale === 'en-US') return `Agent is calling tool: ${tool}`;
    if (locale === 'ja-JP') return `エージェントがツールを呼び出し中: ${tool}`;
  }

  // Pattern: Claude 正在运行子智能体: <desc>
  if (text.startsWith('Claude 正在运行子智能体: ')) {
    const desc = text.slice('Claude 正在运行子智能体: '.length);
    if (locale === 'zh-TW') return `Claude 正在執行子智能體: ${desc}`;
    if (locale === 'en-US') return `Claude is running subagent: ${desc}`;
    if (locale === 'ja-JP') return `Claude がサブエージェントを実行中: ${desc}`;
  }

  // Pattern: 执行提示: ...。在此输入即可继续此会话。
  const errHintMatch = text.match(/^执行提示:\s*(.+)。在此输入即可继续此会话。$/);
  if (errHintMatch) {
    const inner = errHintMatch[1].replace(/^进程退出码\s+(\d+)$/, (_, code) =>
      locale === 'zh-TW' ? `程序結束代碼 ${code}` : locale === 'en-US' ? `Process exit code ${code}` : `プロセス終了コード ${code}`,
    );
    if (locale === 'zh-TW') return `執行提示: ${inner}。在此輸入即可繼續此會話。`;
    if (locale === 'en-US') return `Execution notice: ${inner}. Type here to continue this session.`;
    if (locale === 'ja-JP') return `実行通知: ${inner}。ここに入力してこのセッションを続行できます。`;
  }

  return text;
}
