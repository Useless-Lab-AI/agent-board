#!/usr/bin/env node
import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

function isCommandAvailable(cmd: string): boolean {
  try {
    const checkCmd = process.platform === 'win32' ? `where ${cmd}` : `which ${cmd}`;
    execSync(checkCmd, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

async function run() {
  console.log('====================================================');
  console.log('   Agent Board - Claude Channel 一键配置向导');
  console.log('====================================================\n');

  const home = os.homedir();
  const claudeHome = process.env.AGENT_BOARD_CLAUDE_HOME ?? path.join(home, '.claude');
  const claudeJsonPath = path.join(home, '.claude.json');

  const hasGlobalBin = isCommandAvailable('agent-board-channel');
  const distChannelPath = path.resolve(import.meta.dirname, 'claude-channel.js');
  const hasLocalDist = existsSync(distChannelPath);

  let command = 'agent-board-channel';
  let args: string[] = [];

  if (hasGlobalBin) {
    command = 'agent-board-channel';
    args = [];
  } else if (hasLocalDist) {
    command = process.execPath;
    args = [distChannelPath];
  } else {
    command = 'npx';
    args = ['-y', 'agent-board-channel'];
  }

  console.log(`[1/3] 确定 Channel 启动器: ${command} ${args.join(' ')}`);

  const hasClaudeCli = isCommandAvailable('claude');
  let registered = false;

  if (hasClaudeCli) {
    try {
      console.log('[2/3] 检测到 Claude CLI，正在注册全局 MCP 服务 (agent-board)...');
      try {
        execSync('claude mcp remove -s user agent-board', { stdio: 'ignore' });
      } catch {}

      const addArgs = args.length > 0 ? `"${command}" ${args.map((a) => `"${a}"`).join(' ')}` : `"${command}"`;
      execSync(`claude mcp add -s user agent-board -- ${addArgs}`, { stdio: 'inherit' });
      registered = true;
      console.log('✓ 成功通过 Claude CLI 注册全局 MCP 服务！');
    } catch {
      console.warn('⚠️  通过 Claude CLI 注册遇到问题，尝试直接写入用户配置...');
    }
  }

  if (!registered && existsSync(claudeJsonPath)) {
    try {
      console.log(`[2/3] 写入用户配置文件: ${claudeJsonPath}`);
      const raw = await readFile(claudeJsonPath, 'utf8');
      const data = JSON.parse(raw);
      if (!data.mcpServers || typeof data.mcpServers !== 'object') {
        data.mcpServers = {};
      }
      data.mcpServers['agent-board'] = {
        command,
        ...(args.length > 0 ? { args } : {}),
      };
      await writeFile(claudeJsonPath, JSON.stringify(data, null, 2), 'utf8');
      registered = true;
      console.log('✓ 成功更新 ~/.claude.json');
    } catch (e) {
      console.warn(`⚠️  更新 ~/.claude.json 失败:`, e);
    }
  }

  if (!registered) {
    console.log('[2/3] 提示: 未能自动注册全局 MCP，请参考看板界面的配置指南手动配置。');
  }

  console.log('[3/3] 创建快捷启动命令 (claude-board)...');
  const launchFlags = '--dangerously-load-development-channels server:agent-board';
  const launcherLocations: string[] = [];

  if (process.platform === 'win32') {
    let npmPrefix = '';
    try {
      npmPrefix = execSync('npm config get prefix', { encoding: 'utf8' }).trim();
    } catch {}

    const candidateDirs = [npmPrefix, path.join(claudeHome, 'bin'), process.cwd()].filter(
      (d) => d && existsSync(d),
    );

    for (const dir of candidateDirs) {
      try {
        const cmdPath = path.join(dir, 'claude-board.cmd');
        const psPath = path.join(dir, 'claude-board.ps1');
        await writeFile(cmdPath, `@echo off\nclaude ${launchFlags} %*\n`, 'utf8');
        await writeFile(psPath, `claude ${launchFlags} @args\n`, 'utf8');
        launcherLocations.push(cmdPath);
        break;
      } catch {}
    }
  } else {
    let npmPrefix = '';
    try {
      npmPrefix = execSync('npm config get prefix', { encoding: 'utf8' }).trim();
      const binDir = path.join(npmPrefix, 'bin');
      if (existsSync(binDir)) {
        const shPath = path.join(binDir, 'claude-board');
        await writeFile(shPath, `#!/usr/bin/env sh\nexec claude ${launchFlags} "$@"\n`, { mode: 0o755 });
        launcherLocations.push(shPath);
      }
    } catch {}
    try {
      const localSh = path.join(process.cwd(), 'claude-board');
      await writeFile(localSh, `#!/usr/bin/env sh\nexec claude ${launchFlags} "$@"\n`, { mode: 0o755 });
      launcherLocations.push(localSh);
    } catch {}
  }

  console.log('\n====================================================');
  console.log('🎉 配置完成！');
  if (launcherLocations.length > 0) {
    console.log(`✓ 快捷启动命令已创建于: ${launcherLocations[0]}`);
  }
  console.log('\n使用说明：');
  console.log('1. 在任意需要连接看板的项目终端中，直接运行：');
  console.log('     claude-board');
  console.log('   （或运行: claude ' + launchFlags + '）');
  console.log('2. 终端如提示开发通道确认，按回车同意即可。');
  console.log('3. 看板即可自动识别并点亮双向交互！');
  console.log('====================================================\n');
}

run().catch((err) => {
  console.error('配置发生异常:', err);
  process.exit(1);
});
