#!/usr/bin/env node

/**
 * 导出整理脚本
 * 将 JSON 备份文件展开为 data/ 目录结构
 *
 * 用法:
 *   node scripts/export-to-files.js --input ./backup.json --output ./data
 *
 * 参数:
 *   --input  必需，JSON 备份文件路径
 *   --output 可选，输出目录，默认 ./data
 */

const fs = require('fs');
const path = require('path');

function parseArgs() {
  const args = process.argv.slice(2);
  const options = { input: '', output: path.join(__dirname, '..', 'data') };

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--input' && args[i + 1]) options.input = args[i + 1];
    if (args[i] === '--output' && args[i + 1]) options.output = args[i + 1];
  }

  if (!options.input) {
    console.error('错误: 请指定 --input 参数');
    console.error('用法: node scripts/export-to-files.js --input ./backup.json');
    process.exit(1);
  }

  return options;
}

function sanitizeFileName(name) {
  return name
    .replace(/[<>:"/\\|?*]/g, '_')
    .replace(/\s+/g, ' ')
    .trim() || 'untitled';
}

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function writeJsonFile(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
  console.log(`  ✓ ${path.relative(process.cwd(), filePath)}`);
}

function exportFolders(folders, outputDir) {
  console.log('\n📁 导出文件夹结构...');
  const dir = path.join(outputDir, 'folders');
  ensureDir(dir);
  writeJsonFile(path.join(dir, 'folders.json'), folders);
}

function exportNotes(notes, folders, outputDir) {
  console.log('\n📝 导出笔记...');

  // 建立文件夹 ID → 名称映射
  const folderMap = {};
  folders.forEach(f => { folderMap[f.id] = f.name; });

  // 按文件夹分组
  notes.forEach(note => {
    let noteDir = path.join(outputDir, 'notes');

    if (note.folderId && folderMap[note.folderId]) {
      const folderName = sanitizeFileName(folderMap[note.folderId]);
      noteDir = path.join(noteDir, folderName);
    }

    ensureDir(noteDir);

    // 构建 Markdown 内容（含 Front Matter）
    const tags = note.tags?.length
      ? `tags: [${note.tags.map(t => `"${t}"`).join(', ')}]`
      : 'tags: []';

    const frontMatter = `---
title: "${note.title}"
created: ${note.createdAt}
updated: ${note.updatedAt}
${tags}
---

`;

    const content = frontMatter + (note.content || '');
    const fileName = sanitizeFileName(note.title) + '.md';
    const filePath = path.join(noteDir, fileName);

    fs.writeFileSync(filePath, content, 'utf-8');
    console.log(`  ✓ ${path.relative(process.cwd(), filePath)}`);
  });
}

function exportTasks(tasks, outputDir) {
  console.log('\n✅ 导出任务...');
  const dir = path.join(outputDir, 'tasks');
  ensureDir(dir);
  writeJsonFile(path.join(dir, 'tasks.json'), tasks);
}

function exportFinance(finance, outputDir) {
  console.log('\n💰 导出财务记录...');
  const dir = path.join(outputDir, 'finance');
  ensureDir(dir);
  writeJsonFile(path.join(dir, 'finance.json'), finance);
}

function main() {
  const options = parseArgs();
  const inputPath = path.resolve(options.input);
  const outputDir = path.resolve(options.output);

  console.log(`输入文件: ${inputPath}`);
  console.log(`输出目录: ${outputDir}`);

  if (!fs.existsSync(inputPath)) {
    console.error(`错误: 文件不存在 — ${inputPath}`);
    process.exit(1);
  }

  let data;
  try {
    const raw = fs.readFileSync(inputPath, 'utf-8');
    data = JSON.parse(raw);
  } catch (err) {
    console.error(`错误: 无法解析 JSON 文件 — ${err.message}`);
    process.exit(1);
  }

  console.log(`导出时间: ${data.exportTime || '未知'}`);
  console.log('━'.repeat(40));

  // 导出各集合
  if (data.folders) {
    exportFolders(data.folders, outputDir);
  } else {
    console.log('\n📁 跳过: 无文件夹数据');
  }

  if (data.notes) {
    exportNotes(data.notes, data.folders || [], outputDir);
  } else {
    console.log('\n📝 跳过: 无笔记数据');
  }

  if (data.tasks) {
    exportTasks(data.tasks, outputDir);
  } else {
    console.log('\n✅ 跳过: 无任务数据');
  }

  if (data.finance) {
    exportFinance(data.finance, outputDir);
  } else {
    console.log('\n💰 跳过: 无财务数据');
  }

  console.log('\n' + '━'.repeat(40));
  console.log('✅ 导出完成！');
  console.log(`文件保存在: ${outputDir}`);
}

main();
