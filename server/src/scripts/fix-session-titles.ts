/**
 * 批量更新会话标题脚本
 * 将所有"RAG 测试会话"标题的会话根据第一条消息内容更新为正确的标题
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function fixSessionTitles() {
  console.log('开始修复会话标题...');

  // 1. 查找所有标题为"RAG 测试会话"或"新会话"的会话
  const sessions = await prisma.agentSession.findMany({
    where: {
      title: {
        in: ['RAG 测试会话', '新会话'],
      },
    },
    include: {
      runs: {
        orderBy: { createdAt: 'asc' },
        take: 1,
      },
    },
  });

  console.log(`找到 ${sessions.length} 个需要修复的会话`);

  for (const session of sessions) {
    if (session.runs.length === 0) {
      console.log(`会话 ${session.id} 没有运行记录，跳过`);
      continue;
    }

    const firstRun = session.runs[0];
    const inputText = firstRun.inputText.trim();

    // 生成新标题：取前40字符
    const newTitle = inputText.length <= 40
      ? inputText
      : inputText.slice(0, 40) + '...';

    if (newTitle && newTitle !== session.title) {
      await prisma.agentSession.update({
        where: { id: session.id },
        data: { title: newTitle },
      });
      console.log(`更新会话 ${session.id}: "${session.title}" -> "${newTitle}"`);
    }
  }

  console.log('修复完成！');
}

async function main() {
  try {
    await fixSessionTitles();
  } catch (error) {
    console.error('修复失败:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();