#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execSync } from 'node:child_process';

const isUninstall = process.argv.includes('--uninstall');
const homedir = os.homedir();
const claudeDir = path.join(homedir, '.claude');
const wrapperExe = path.join(claudeDir, 'agent-board-wrapper.exe');
const vscodeSettingsPath = path.join(process.env.APPDATA || path.join(homedir, 'AppData', 'Roaming'), 'Code', 'User', 'settings.json');
const claudeCmdPath = 'd:\\tools\\nvm\\nodejs\\claude.cmd';
const claudeCmdBakPath = 'd:\\tools\\nvm\\nodejs\\claude.cmd.original.bak';

console.log(isUninstall ? '=== 卸载 Agent Board 永久双向通道 ===' : '=== 安装 Agent Board 永久双向通道 ===');

// 1. 编译 / 检查包装器二进制
if (!isUninstall) {
  if (!fs.existsSync(claudeDir)) {
    fs.mkdirSync(claudeDir, { recursive: true });
  }

  const goSource = path.resolve('scripts/claude-wrapper/main.go');
  if (!fs.existsSync(wrapperExe)) {
    console.log('[1/3] 编译透明包装器 agent-board-wrapper.exe ...');
    execSync(`"D:\\Program Files\\Go\\bin\\go.exe" build -ldflags "-s -w" -o "${wrapperExe}" "${goSource}"`, { stdio: 'inherit' });
  } else {
    console.log('[1/3] 包装器二进制已就绪:', wrapperExe);
  }
} else {
  console.log('[1/3] 跳过删除二进制文件（保留 ~/.claude/agent-board-wrapper.exe）');
}

// 2. 配置 VS Code 用户设置
console.log('[2/3] 配置 VS Code 官方插件启动项 (claudeCode.claudeProcessWrapper) ...');
if (fs.existsSync(vscodeSettingsPath)) {
  try {
    const raw = fs.readFileSync(vscodeSettingsPath, 'utf8');
    const settings = JSON.parse(raw);
    if (isUninstall) {
      if ('claudeCode.claudeProcessWrapper' in settings) {
        delete settings['claudeCode.claudeProcessWrapper'];
        fs.writeFileSync(vscodeSettingsPath, JSON.stringify(settings, null, 4), 'utf8');
        console.log('  -> 已从 VS Code settings.json 移除 claudeCode.claudeProcessWrapper');
      } else {
        console.log('  -> VS Code settings.json 中无此配置，无需清理');
      }
    } else {
      settings['claudeCode.claudeProcessWrapper'] = wrapperExe;
      fs.writeFileSync(vscodeSettingsPath, JSON.stringify(settings, null, 4), 'utf8');
      console.log('  -> 成功写入 VS Code settings.json: claudeCode.claudeProcessWrapper = ' + wrapperExe);
    }
  } catch (e) {
    console.error('  -> 修改 VS Code settings.json 失败:', e.message);
  }
} else {
  console.warn('  -> 未找到 VS Code settings.json:', vscodeSettingsPath);
}

// 3. 配置终端全局 claude.cmd
console.log('[3/3] 配置全局终端入口 claude.cmd ...');
if (fs.existsSync(claudeCmdPath)) {
  try {
    if (isUninstall) {
      if (fs.existsSync(claudeCmdBakPath)) {
        fs.copyFileSync(claudeCmdBakPath, claudeCmdPath);
        fs.unlinkSync(claudeCmdBakPath);
        console.log('  -> 已恢复原始 claude.cmd');
      } else {
        console.log('  -> 未找到备份文件，保留当前状态');
      }
    } else {
      if (!fs.existsSync(claudeCmdBakPath)) {
        fs.copyFileSync(claudeCmdPath, claudeCmdBakPath);
        console.log('  -> 已备份原始 claude.cmd 至 claude.cmd.original.bak');
      }
      const newCmdContent = `@ECHO off\r\n"${wrapperExe}" %*\r\n`;
      fs.writeFileSync(claudeCmdPath, newCmdContent, 'utf8');
      console.log('  -> 成功更新 claude.cmd 指向透明通道包装器');
    }
  } catch (e) {
    console.error('  -> 配置 claude.cmd 失败:', e.message);
  }
} else {
  console.warn('  -> 未找到 claude.cmd:', claudeCmdPath);
}

console.log(isUninstall ? '\n卸载完成！' : '\n安装完成！现在无论是 VS Code 插件界面直接使用，还是在终端输入原生 claude，均会自动永久挂载 Agent Board 双向通道。');
