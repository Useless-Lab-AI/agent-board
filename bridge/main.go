package main

import (
	"bufio"
	"bytes"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"strings"
	"sync"
	"syscall"
	"time"
)

// SyncWriter provides thread-safe writes to a stream (childStdin or os.Stdout).
type SyncWriter struct {
	mu sync.Mutex
	w  io.Writer
}

func (s *SyncWriter) Write(p []byte) (n int, err error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.w.Write(p)
}

func fileExists(p string) bool {
	info, err := os.Stat(p)
	if err != nil {
		return false
	}
	return !info.IsDir()
}

func generateToken(n int) string {
	b := make([]byte, n)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

func generateUUID() string {
	b := make([]byte, 16)
	_, _ = rand.Read(b)
	b[6] = (b[6] & 0x0f) | 0x40
	b[8] = (b[8] & 0x3f) | 0x80
	return fmt.Sprintf("%08x-%04x-%04x-%04x-%012x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:16])
}

type BridgeQuestion struct {
	ID       string   `json:"id"`
	Text     string   `json:"text"`
	Options  []string `json:"options"`
	Multiple bool     `json:"multiple,omitempty"`
}

type BridgePendingItem struct {
	ID        string                 `json:"id"`
	Kind      string                 `json:"kind"` // "approval" | "question"
	Title     string                 `json:"title"`
	Detail    string                 `json:"detail"`
	Questions []BridgeQuestion       `json:"questions,omitempty"`
	ToolName  string                 `json:"toolName,omitempty"`
	ToolUseID string                 `json:"toolUseId,omitempty"`
	Input     map[string]interface{} `json:"-"`
	CreatedAt int64                  `json:"createdAt"`
}

// BridgeMetadata is recorded into ~/.claude/agent-board-bridges/<pid>.json
// to allow Agent Board to discover and connect to this running instance.
type BridgeMetadata struct {
	PID          int                 `json:"pid"`
	BridgePID    int                 `json:"bridgePid"`
	SessionID    string              `json:"sessionId"`
	Port         int                 `json:"port"`
	Token        string              `json:"token"`
	CreatedAt    int64               `json:"createdAt"`
	Capabilities []string            `json:"capabilities,omitempty"`
	Pending      []BridgePendingItem `json:"pending,omitempty"`
}

type PendingTracker struct {
	mu              sync.Mutex
	order           []string
	items           map[string]BridgePendingItem
	answeredByBoard map[string]bool
}

func newPendingTracker() *PendingTracker {
	return &PendingTracker{
		order:           make([]string, 0),
		items:           make(map[string]BridgePendingItem),
		answeredByBoard: make(map[string]bool),
	}
}

func (pt *PendingTracker) Add(item BridgePendingItem) bool {
	pt.mu.Lock()
	defer pt.mu.Unlock()
	if pt.answeredByBoard[item.ID] {
		return false
	}
	if _, exists := pt.items[item.ID]; !exists {
		if len(pt.order) >= 16 {
			oldest := pt.order[0]
			pt.order = pt.order[1:]
			delete(pt.items, oldest)
		}
		pt.order = append(pt.order, item.ID)
	}
	pt.items[item.ID] = item
	return true
}

func (pt *PendingTracker) Remove(id string) bool {
	pt.mu.Lock()
	defer pt.mu.Unlock()
	if _, exists := pt.items[id]; !exists {
		return false
	}
	delete(pt.items, id)
	for i, oid := range pt.order {
		if oid == id {
			pt.order = append(pt.order[:i], pt.order[i+1:]...)
			break
		}
	}
	return true
}

func (pt *PendingTracker) PopForBoardDecision(id string) (BridgePendingItem, bool) {
	pt.mu.Lock()
	defer pt.mu.Unlock()
	item, exists := pt.items[id]
	if !exists {
		return BridgePendingItem{}, false
	}
	delete(pt.items, id)
	for i, oid := range pt.order {
		if oid == id {
			pt.order = append(pt.order[:i], pt.order[i+1:]...)
			break
		}
	}
	pt.answeredByBoard[id] = true
	return item, true
}

func (pt *PendingTracker) WasAnsweredByBoard(id string) bool {
	pt.mu.Lock()
	defer pt.mu.Unlock()
	return pt.answeredByBoard[id]
}

func (pt *PendingTracker) Clear() bool {
	pt.mu.Lock()
	defer pt.mu.Unlock()
	if len(pt.items) == 0 {
		return false
	}
	pt.order = make([]string, 0)
	pt.items = make(map[string]BridgePendingItem)
	return true
}

func (pt *PendingTracker) List() []BridgePendingItem {
	pt.mu.Lock()
	defer pt.mu.Unlock()
	res := make([]BridgePendingItem, 0, len(pt.order))
	for _, id := range pt.order {
		if it, ok := pt.items[id]; ok {
			res = append(res, it)
		}
	}
	return res
}

func stringField(m map[string]interface{}, key string) string {
	if m == nil {
		return ""
	}
	if v, ok := m[key]; ok {
		if s, ok := v.(string); ok {
			return s
		}
	}
	return ""
}

func prefixLines(text string, prefix string) string {
	lines := strings.Split(text, "\n")
	for i, l := range lines {
		lines[i] = prefix + l
	}
	return strings.Join(lines, "\n")
}

func truncateDetail(s string, maxLen int) string {
	if len(s) <= maxLen {
		return s
	}
	return s[:maxLen] + "\n... (内容已截断)"
}

func buildPendingItem(
	requestID string,
	toolName string,
	toolUseID string,
	input map[string]interface{},
	description string,
	decisionReason string,
	blockedPath string,
) BridgePendingItem {
	now := time.Now().UnixMilli()
	if input == nil {
		input = map[string]interface{}{}
	}

	// 1. Interactive question tool: AskUserQuestion
	if toolName == "AskUserQuestion" {
		questions := make([]BridgeQuestion, 0)
		if rawQs, ok := input["questions"].([]interface{}); ok {
			for idx, rq := range rawQs {
				qMap, ok := rq.(map[string]interface{})
				if !ok {
					continue
				}
				qText := stringField(qMap, "question")
				qID := qText
				if qID == "" {
					qID = fmt.Sprintf("q_%d", idx)
				}
				multi, _ := qMap["multiSelect"].(bool)
				opts := make([]string, 0)
				if rawOpts, ok := qMap["options"].([]interface{}); ok {
					for _, ro := range rawOpts {
						if oMap, ok := ro.(map[string]interface{}); ok {
							lbl := stringField(oMap, "label")
							if lbl != "" {
								opts = append(opts, lbl)
							}
						}
					}
				}
				questions = append(questions, BridgeQuestion{
					ID:       qID,
					Text:     qText,
					Options:  opts,
					Multiple: multi,
				})
			}
		}
		if len(questions) > 0 {
			return BridgePendingItem{
				ID:        requestID,
				Kind:      "question",
				Title:     "AI 需要你的回答",
				Detail:    "",
				Questions: questions,
				ToolName:  toolName,
				ToolUseID: toolUseID,
				Input:     input,
				CreatedAt: now,
			}
		}
	}

	// 2. File modification tools: Edit / MultiEdit / Write
	if toolName == "Edit" || toolName == "MultiEdit" || toolName == "Write" {
		filePath := stringField(input, "file_path")
		var sb strings.Builder
		if filePath != "" {
			sb.WriteString("# File: " + filePath + "\n")
		}
		if description != "" {
			sb.WriteString("# " + description + "\n")
		}
		if toolName == "Edit" {
			oldStr := stringField(input, "old_string")
			newStr := stringField(input, "new_string")
			sb.WriteString("@@ Edit @@\n")
			if oldStr != "" {
				sb.WriteString(prefixLines(oldStr, "- ") + "\n")
			}
			if newStr != "" {
				sb.WriteString(prefixLines(newStr, "+ "))
			}
		} else if toolName == "MultiEdit" {
			if rawEdits, ok := input["edits"].([]interface{}); ok {
				for idx, re := range rawEdits {
					if eMap, ok := re.(map[string]interface{}); ok {
						oldStr := stringField(eMap, "old_string")
						newStr := stringField(eMap, "new_string")
						sb.WriteString(fmt.Sprintf("@@ Edit #%d @@\n", idx+1))
						if oldStr != "" {
							sb.WriteString(prefixLines(oldStr, "- ") + "\n")
						}
						if newStr != "" {
							sb.WriteString(prefixLines(newStr, "+ ") + "\n")
						}
					}
				}
			}
		} else if toolName == "Write" {
			content := stringField(input, "content")
			sb.WriteString("@@ Write File @@\n")
			if content != "" {
				sb.WriteString(prefixLines(content, "+ "))
			}
		}
		detail := strings.TrimSpace(sb.String())
		if detail == "" {
			raw, _ := json.MarshalIndent(input, "", "  ")
			detail = string(raw)
		}
		return BridgePendingItem{
			ID:        requestID,
			Kind:      "approval",
			Title:     "允许修改文件？",
			Detail:    truncateDetail(detail, 15000),
			ToolName:  toolName,
			ToolUseID: toolUseID,
			Input:     input,
			CreatedAt: now,
		}
	}

	// 3. Command execution tool: Bash
	if toolName == "Bash" {
		cmdStr := stringField(input, "command")
		descStr := stringField(input, "description")
		if descStr == "" {
			descStr = description
		}
		var sb strings.Builder
		if descStr != "" {
			sb.WriteString("# " + descStr + "\n")
		}
		if cmdStr != "" {
			sb.WriteString("$ " + cmdStr)
		} else {
			raw, _ := json.MarshalIndent(input, "", "  ")
			sb.Write(raw)
		}
		return BridgePendingItem{
			ID:        requestID,
			Kind:      "approval",
			Title:     "允许执行命令？",
			Detail:    truncateDetail(strings.TrimSpace(sb.String()), 15000),
			ToolName:  toolName,
			ToolUseID: toolUseID,
			Input:     input,
			CreatedAt: now,
		}
	}

	// 4. Plan / other tools
	var sb strings.Builder
	if toolName != "" {
		sb.WriteString("# Tool: " + toolName + "\n")
	}
	if description != "" {
		sb.WriteString("# " + description + "\n")
	}
	if decisionReason != "" {
		sb.WriteString("# Reason: " + decisionReason + "\n")
	}
	if blockedPath != "" {
		sb.WriteString("# Path: " + blockedPath + "\n")
	}
	if planStr := stringField(input, "plan"); planStr != "" {
		sb.WriteString(planStr)
	} else {
		raw, _ := json.MarshalIndent(input, "", "  ")
		sb.Write(raw)
	}

	return BridgePendingItem{
		ID:        requestID,
		Kind:      "approval",
		Title:     "允许执行命令？",
		Detail:    truncateDetail(strings.TrimSpace(sb.String()), 15000),
		ToolName:  toolName,
		ToolUseID: toolUseID,
		Input:     input,
		CreatedAt: now,
	}
}

func extractSessionIDFromArgs(args []string) string {
	for i := 0; i < len(args); i++ {
		a := args[i]
		if (a == "--session-id" || a == "--resume") && i+1 < len(args) {
			val := args[i+1]
			if !strings.HasPrefix(val, "-") && len(val) > 8 {
				return val
			}
		}
		if strings.HasPrefix(a, "--session-id=") {
			return strings.TrimPrefix(a, "--session-id=")
		}
		if strings.HasPrefix(a, "--resume=") {
			return strings.TrimPrefix(a, "--resume=")
		}
	}
	return ""
}

func findDefaultClaudeExe() string {
	// 1. Check VS Code extension bundled native binary first (fastest, latest version, no cmd.exe wrapper)
	if userProfile := os.Getenv("USERPROFILE"); userProfile != "" {
		extDir := filepath.Join(userProfile, ".vscode", "extensions")
		patterns := []string{
			filepath.Join(extDir, "anthropic.claude-code-*", "resources", "native-binaries", "win32-x64", "claude.exe"),
			filepath.Join(extDir, "anthropic.claude-code-*", "resources", "native-binary", "claude.exe"),
		}
		for _, pat := range patterns {
			matches, _ := filepath.Glob(pat)
			if len(matches) > 0 && fileExists(matches[len(matches)-1]) {
				return matches[len(matches)-1]
			}
		}
	}

	// 2. Check local / roaming AppData direct .exe paths
	if localAppData := os.Getenv("LOCALAPPDATA"); localAppData != "" {
		candidates := []string{
			filepath.Join(localAppData, "Programs", "Claude", "claude.exe"),
		}
		for _, c := range candidates {
			if fileExists(c) {
				return c
			}
		}
	}
	if appData := os.Getenv("APPDATA"); appData != "" {
		p := filepath.Join(appData, "npm", "node_modules", "@anthropic-ai", "claude-code", "bin", "claude.exe")
		if fileExists(p) {
			return p
		}
	}

	// 3. Search in PATH for direct .exe (avoid .cmd wrappers which spawn intermediate cmd.exe)
	if p, err := exec.LookPath("claude.exe"); err == nil && strings.HasSuffix(strings.ToLower(p), ".exe") {
		return p
	}
	if p, err := exec.LookPath("claude"); err == nil {
		if strings.HasSuffix(strings.ToLower(p), ".cmd") {
			dir := filepath.Dir(p)
			directExe := filepath.Join(dir, "node_modules", "@anthropic-ai", "claude-code", "bin", "claude.exe")
			if fileExists(directExe) {
				return directExe
			}
		}
		return p
	}

	return "claude.exe"
}

func isOneShotSubcommand(args []string) bool {
	for _, a := range args {
		switch a {
		case "-p", "--print", "auth", "doctor", "update", "install", "mcp", "--version", "-v", "--help", "-h", "--claude-in-chrome-mcp":
			return true
		}
	}
	if os.Getenv("CLAUDE_CODE_CONFIG_PROBE") == "1" {
		return true
	}
	return false
}

func readSessionIDFromDisk(claudeRootDir string, pid int) string {
	sessionFile := filepath.Join(claudeRootDir, "sessions", fmt.Sprintf("%d.json", pid))
	if content, err := os.ReadFile(sessionFile); err == nil {
		var sData struct {
			SessionID string `json:"sessionId"`
		}
		if json.Unmarshal(content, &sData) == nil && sData.SessionID != "" {
			return sData.SessionID
		}
	}
	return ""
}

func main() {
	rawArgs := os.Args[1:]

	var targetExe string
	var actualArgs []string

	// When invoked as claudeProcessWrapper, the first arg is the target binary:
	// e.g.: agent-board-bridge.exe C:\path\to\claude.exe --output-format stream-json ...
	if len(rawArgs) > 0 && !strings.HasPrefix(rawArgs[0], "-") {
		if fileExists(rawArgs[0]) {
			targetExe = rawArgs[0]
			actualArgs = rawArgs[1:]
		} else if p, err := exec.LookPath(rawArgs[0]); err == nil {
			targetExe = p
			actualArgs = rawArgs[1:]
		}
	}

	if targetExe == "" {
		targetExe = findDefaultClaudeExe()
		actualArgs = rawArgs
	}

	isStreamJson := false
	for _, a := range actualArgs {
		if strings.Contains(a, "stream-json") {
			isStreamJson = true
			break
		}
	}

	oneShot := isOneShotSubcommand(actualArgs)
	sessionID := extractSessionIDFromArgs(actualArgs)
	var sessionMu sync.Mutex
	getSessionID := func() string {
		sessionMu.Lock()
		defer sessionMu.Unlock()
		return sessionID
	}
	setSessionID := func(sid string) bool {
		sessionMu.Lock()
		defer sessionMu.Unlock()
		if sid != "" && sid != sessionID {
			sessionID = sid
			return true
		}
		return false
	}

	cmd := exec.Command(targetExe, actualArgs...)
	cmd.Env = os.Environ()

	childStdin, err := cmd.StdinPipe()
	if err != nil {
		fmt.Fprintf(os.Stderr, "[bridge] Failed to create stdin pipe: %v\n", err)
		os.Exit(1)
	}

	childStdout, err := cmd.StdoutPipe()
	if err != nil {
		fmt.Fprintf(os.Stderr, "[bridge] Failed to create stdout pipe: %v\n", err)
		os.Exit(1)
	}

	childStderr, err := cmd.StderrPipe()
	if err != nil {
		fmt.Fprintf(os.Stderr, "[bridge] Failed to create stderr pipe: %v\n", err)
		os.Exit(1)
	}

	if err := cmd.Start(); err != nil {
		fmt.Fprintf(os.Stderr, "[bridge] Failed to start %s: %v\n", targetExe, err)
		os.Exit(1)
	}

	childPID := cmd.Process.Pid
	bridgePID := os.Getpid()
	createdAt := time.Now().UnixMilli()

	stdoutWriter := &SyncWriter{w: os.Stdout}
	syncWriter := &SyncWriter{w: childStdin}
	tracker := newPendingTracker()

	var listener net.Listener
	homeDir, _ := os.UserHomeDir()
	claudeRootDir := filepath.Join(homeDir, ".claude")
	if envHome := os.Getenv("AGENT_BOARD_CLAUDE_HOME"); envHome != "" {
		claudeRootDir = envHome
	}
	bridgesDir := filepath.Join(claudeRootDir, "agent-board-bridges")
	regFilePath := filepath.Join(bridgesDir, fmt.Sprintf("%d.json", childPID))
	token := generateToken(16)

	if !oneShot {
		listener, err = net.Listen("tcp", "127.0.0.1:0")
		if err != nil {
			fmt.Fprintf(os.Stderr, "[bridge] Warning: Failed to start bridge TCP server: %v\n", err)
		}
		_ = os.MkdirAll(bridgesDir, 0755)
	}

	var regMu sync.Mutex
	updateRegistry := func(sid string) {
		if listener == nil {
			return
		}
		regMu.Lock()
		defer regMu.Unlock()
		port := listener.Addr().(*net.TCPAddr).Port
		meta := BridgeMetadata{
			PID:          childPID,
			BridgePID:    bridgePID,
			SessionID:    sid,
			Port:         port,
			Token:        token,
			CreatedAt:    createdAt,
			Capabilities: []string{"approval_v1"},
			Pending:      tracker.List(),
		}
		data, err := json.MarshalIndent(meta, "", "  ")
		if err == nil {
			tmpPath := regFilePath + ".tmp"
			if writeErr := os.WriteFile(tmpPath, data, 0644); writeErr == nil {
				if renameErr := os.Rename(tmpPath, regFilePath); renameErr != nil {
					_ = os.WriteFile(regFilePath, data, 0644)
					_ = os.Remove(tmpPath)
				}
			} else {
				_ = os.WriteFile(regFilePath, data, 0644)
			}
		}
	}

	// Direct stream piping for stderr
	go func() {
		_, _ = io.Copy(os.Stderr, childStderr)
	}()

	// Pipe childStdout -> os.Stdout (with stream-json control_request tracking when active)
	go func() {
		if !isStreamJson || oneShot {
			_, _ = io.Copy(stdoutWriter, childStdout)
			return
		}
		reader := bufio.NewReaderSize(childStdout, 64*1024)
		for {
			line, readErr := reader.ReadBytes('\n')
			if len(line) > 0 {
				_, _ = stdoutWriter.Write(line)
				trimmed := bytes.TrimSpace(line)
				if len(trimmed) > 0 && trimmed[0] == '{' {
					var env struct {
						Type      string `json:"type"`
						RequestID string `json:"request_id"`
						SessionID string `json:"session_id"`
						Request   struct {
							Subtype        string                 `json:"subtype"`
							ToolName       string                 `json:"tool_name"`
							ToolUseID      string                 `json:"tool_use_id"`
							Input          map[string]interface{} `json:"input"`
							Description    string                 `json:"description"`
							DecisionReason string                 `json:"decision_reason"`
							BlockedPath    string                 `json:"blocked_path"`
						} `json:"request"`
					}
					if json.Unmarshal(trimmed, &env) == nil {
						sidChanged := false
						if env.SessionID != "" && setSessionID(env.SessionID) {
							sidChanged = true
						}
						pendingChanged := false
						switch env.Type {
						case "control_request":
							if env.Request.Subtype == "can_use_tool" && env.RequestID != "" {
								item := buildPendingItem(
									env.RequestID,
									env.Request.ToolName,
									env.Request.ToolUseID,
									env.Request.Input,
									env.Request.Description,
									env.Request.DecisionReason,
									env.Request.BlockedPath,
								)
								if tracker.Add(item) {
									pendingChanged = true
								}
							}
						case "control_cancel_request":
							if env.RequestID != "" && tracker.Remove(env.RequestID) {
								pendingChanged = true
							}
						case "result":
							if tracker.Clear() {
								pendingChanged = true
							}
						}
						if sidChanged || pendingChanged {
							updateRegistry(getSessionID())
						}
					}
				}
			}
			if readErr != nil {
				break
			}
		}
	}()

	// Forward native os.Stdin (e.g. from VS Code) to childStdin
	go func() {
		if !isStreamJson || oneShot {
			_, _ = io.Copy(syncWriter, os.Stdin)
			_ = childStdin.Close()
			return
		}
		inReader := bufio.NewReaderSize(os.Stdin, 64*1024)
		for {
			line, readErr := inReader.ReadBytes('\n')
			if len(line) > 0 {
				forward := true
				trimmed := bytes.TrimSpace(line)
				if len(trimmed) > 0 && trimmed[0] == '{' {
					var inEnv struct {
						Type     string `json:"type"`
						Response struct {
							RequestID string `json:"request_id"`
						} `json:"response"`
					}
					if json.Unmarshal(trimmed, &inEnv) == nil {
						if inEnv.Type == "control_response" && inEnv.Response.RequestID != "" {
							if tracker.WasAnsweredByBoard(inEnv.Response.RequestID) {
								// Already answered via Agent Board; drop duplicate/abort response from VS Code
								forward = false
							} else if tracker.Remove(inEnv.Response.RequestID) {
								updateRegistry(getSessionID())
							}
						} else if inEnv.Type == "user" {
							if tracker.Clear() {
								updateRegistry(getSessionID())
							}
						}
					}
				}
				if forward {
					_, _ = syncWriter.Write(line)
				}
			}
			if readErr != nil {
				break
			}
		}
		_ = childStdin.Close()
	}()

	if !oneShot {
		updateRegistry(getSessionID())

		// Continuously sync sessionId from ~/.claude/sessions/<childPID>.json
		go func() {
			for {
				time.Sleep(1 * time.Second)
				if sid := readSessionIDFromDisk(claudeRootDir, childPID); sid != "" {
					if setSessionID(sid) {
						updateRegistry(sid)
					}
				}
			}
		}()

		// Handle Bridge IPC Connections
		if listener != nil {
			go func() {
				for {
					conn, err := listener.Accept()
					if err != nil {
						break
					}
					go handleBridgeConn(
						conn,
						token,
						syncWriter,
						stdoutWriter,
						tracker,
						isStreamJson,
						claudeRootDir,
						childPID,
						getSessionID,
						setSessionID,
						updateRegistry,
					)
				}
			}()
		}
	}

	// Handle OS Signals
	sigChan := make(chan os.Signal, 1)
	signal.Notify(sigChan, os.Interrupt, syscall.SIGTERM)
	go func() {
		for sig := range sigChan {
			if cmd.Process != nil {
				_ = cmd.Process.Signal(sig)
			}
		}
	}()

	// Wait for child process to finish
	waitErr := cmd.Wait()

	// Cleanup
	if listener != nil {
		_ = listener.Close()
	}
	_ = os.Remove(regFilePath)
	_ = os.Remove(regFilePath + ".tmp")

	if waitErr != nil {
		if exitErr, ok := waitErr.(*exec.ExitError); ok {
			os.Exit(exitErr.ExitCode())
		}
		os.Exit(1)
	}
	os.Exit(0)
}

type IncomingFrame struct {
	Type      string            `json:"type"`
	Token     string            `json:"token"`
	Text      string            `json:"text"`
	RequestID string            `json:"requestId"`
	Decision  string            `json:"decision"`
	Answers   map[string]string `json:"answers"`
	RawFrame  json.RawMessage   `json:"rawFrame"`
}

func cloneMap(src map[string]interface{}) map[string]interface{} {
	dst := make(map[string]interface{}, len(src))
	for k, v := range src {
		dst[k] = v
	}
	return dst
}

func handleBridgeConn(
	conn net.Conn,
	expectedToken string,
	writer *SyncWriter,
	stdoutWriter *SyncWriter,
	tracker *PendingTracker,
	isStreamJson bool,
	homeDir string,
	childPID int,
	getSessionID func() string,
	setSessionID func(string) bool,
	updateRegistry func(string),
) {
	defer conn.Close()

	reader := bufio.NewReader(conn)

	// Step 1: Read Auth Line
	authLine, err := reader.ReadBytes('\n')
	if err != nil {
		return
	}

	var frame IncomingFrame
	if err := json.Unmarshal(authLine, &frame); err != nil || frame.Token != expectedToken {
		_, _ = conn.Write([]byte(`{"error":"unauthorized"}` + "\n"))
		return
	}

	_, _ = conn.Write([]byte(`{"status":"authenticated","version":2,"capabilities":["approval_v1"]}` + "\n"))

	// Step 2: Read Messages
	for {
		line, err := reader.ReadBytes('\n')
		if err != nil {
			break
		}
		trimmed := strings.TrimSpace(string(line))
		if len(trimmed) == 0 {
			continue
		}

		var msg IncomingFrame
		parsedJSON := json.Unmarshal(line, &msg) == nil

		if parsedJSON && msg.Type == "get_state" {
			stateResp := map[string]interface{}{
				"status":    "ok",
				"sessionId": getSessionID(),
				"pending":   tracker.List(),
			}
			bytes, _ := json.Marshal(stateResp)
			_, _ = conn.Write(append(bytes, '\n'))
			continue
		}

		if parsedJSON && msg.Type == "decision" {
			item, ok := tracker.PopForBoardDecision(msg.RequestID)
			if !ok {
				_, _ = conn.Write([]byte(`{"error":"请求已在原客户端处理或已过期"}` + "\n"))
				continue
			}
			updateRegistry(getSessionID())

			updatedInput := cloneMap(item.Input)
			var respInner map[string]interface{}

			if item.Kind == "question" || len(msg.Answers) > 0 {
				answersObj := make(map[string]interface{}, len(msg.Answers))
				for k, v := range msg.Answers {
					answersObj[k] = v
				}
				updatedInput["answers"] = answersObj
				respInner = map[string]interface{}{
					"behavior":     "allow",
					"updatedInput": updatedInput,
				}
			} else if msg.Decision == "allow" {
				respInner = map[string]interface{}{
					"behavior":           "allow",
					"updatedInput":       updatedInput,
					"updatedPermissions": []interface{}{},
				}
			} else {
				denyMsg := "The user doesn't want to proceed with this tool use. The tool use was rejected (eg. if it was a file edit, the new_string was NOT written to the file). STOP what you are doing and wait for the user to tell you how to proceed."
				if item.ToolName == "ExitPlanMode" {
					denyMsg = "User chose to stay in plan mode and continue planning"
				}
				respInner = map[string]interface{}{
					"behavior":  "deny",
					"message":   denyMsg,
					"interrupt": true,
				}
			}

			if item.ToolUseID != "" {
				respInner["toolUseID"] = item.ToolUseID
			}

			ctrlResp := map[string]interface{}{
				"type": "control_response",
				"response": map[string]interface{}{
					"subtype":    "success",
					"request_id": item.ID,
					"response":   respInner,
				},
			}
			respBytes, marshalErr := json.Marshal(ctrlResp)
			if marshalErr != nil {
				_, _ = conn.Write([]byte(fmt.Sprintf(`{"error":%q}`+"\n", marshalErr.Error())))
				continue
			}
			_, writeErr := writer.Write(append(respBytes, '\n'))
			if writeErr != nil {
				_, _ = conn.Write([]byte(fmt.Sprintf(`{"error":%q}`+"\n", writeErr.Error())))
				break
			}

			// Notify the original client (e.g. VS Code extension) to dismiss its pending permission prompt
			cancelFrame := map[string]interface{}{
				"type":       "control_cancel_request",
				"request_id": item.ID,
			}
			if cancelBytes, err := json.Marshal(cancelFrame); err == nil {
				_, _ = stdoutWriter.Write(append(cancelBytes, '\n'))
			}

			_, _ = conn.Write([]byte(`{"status":"ok"}` + "\n"))
			continue
		}

		if parsedJSON && msg.Text != "" {
			trimmed = msg.Text
		}

		if tracker.Clear() {
			updateRegistry(getSessionID())
		}

		var payloadToWrite []byte
		if isStreamJson {
			// If already a stream-json frame (starts with {"type":)
			if strings.HasPrefix(trimmed, `{"type":`) {
				payloadToWrite = []byte(trimmed + "\n")
			} else {
				// Wrap user prompt into native stream-json input format
				currentSID := getSessionID()
				if currentSID == "" {
					if diskSID := readSessionIDFromDisk(homeDir, childPID); diskSID != "" {
						currentSID = diskSID
						if setSessionID(diskSID) {
							updateRegistry(diskSID)
						}
					}
				}
				streamPayload := map[string]interface{}{
					"type": "user",
					"message": map[string]interface{}{
						"role":    "user",
						"content": trimmed,
					},
					"session_id":         currentSID,
					"parent_tool_use_id": nil,
					"uuid":               generateUUID(),
				}
				bytes, err := json.Marshal(streamPayload)
				if err == nil {
					payloadToWrite = append(bytes, '\n')
				}
			}
		} else {
			// Normal terminal CLI mode: raw text + newline
			payloadToWrite = []byte(trimmed + "\n")
		}

		if len(payloadToWrite) > 0 {
			_, writeErr := writer.Write(payloadToWrite)
			if writeErr != nil {
				_, _ = conn.Write([]byte(fmt.Sprintf(`{"error":%q}`+"\n", writeErr.Error())))
				break
			} else {
				_, _ = conn.Write([]byte(`{"status":"ok"}` + "\n"))
			}
		}
	}
}
