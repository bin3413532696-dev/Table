/**
 * 存量文档元数据回填脚本
 *
 * 执行方式：
 * - 快速回填（仅关键词匹配，不调用LLM）：
 *   npx tsx server/src/scripts/backfill-metadata.ts --no-llm
 *
 * - 完整回填（含LLM分类，需要Provider配置）：
 *   npx tsx server/src/scripts/backfill-metadata.ts --llm --batch-size 10
 */

import { PrismaClient } from '@prisma/client';
import { extractMetadata, extractMetadataFast } from '../modules/knowledge-rag/indexing/metadata-extractor';

const prisma = new PrismaClient();

interface BackfillOptions {
  useLlm: boolean;
  batchSize: number;
  dryRun: boolean;
  verbose: boolean;
}

const DEFAULT_OPTIONS: BackfillOptions = {
  useLlm: false,
  batchSize: 20,
  dryRun: false,
  verbose: true,
};

/**
 * 解析命令行参数
 */
function parseArgs(): BackfillOptions {
  const args = process.argv.slice(2);
  const options = { ...DEFAULT_OPTIONS };

  for (const arg of args) {
    if (arg === '--llm') {
      options.useLlm = true;
    } else if (arg === '--no-llm') {
      options.useLlm = false;
    } else if (arg.startsWith('--batch-size=')) {
      options.batchSize = parseInt(arg.split('=')[1], 10);
    } else if (arg === '--dry-run') {
      options.dryRun = true;
    } else if (arg === '--quiet') {
      options.verbose = false;
    }
  }

  return options;
}

/**
 * 主回填函数
 */
async function backfillMetadata(options: BackfillOptions): Promise<void> {
  console.log('='.repeat(60));
  console.log('存量文档元数据回填脚本');
  console.log('='.repeat(60));
  console.log(`模式: ${options.useLlm ? 'LLM 分类' : '关键词匹配'}`);
  console.log(`批次大小: ${options.batchSize}`);
  console.log(`试运行: ${options.dryRun ? '是' : '否'}`);
  console.log('='.repeat(60));

  // 统计信息
  const stats = {
    total: 0,
    processed: 0,
    updated: 0,
    skipped: 0,
    errors: 0,
    startTime: Date.now(),
  };

  // 获取需要回填的文档总数
  const totalCount = await prisma.knowledgeDocument.count({
    where: {
      OR: [
        { sourceDept: null },
        { publishDate: null },
      ],
    },
  });

  stats.total = totalCount;
  console.log(`\n待处理文档总数: ${totalCount}`);

  if (totalCount === 0) {
    console.log('\n没有需要回填的文档，脚本结束。');
    await prisma.$disconnect();
    return;
  }

  // 批量处理
  let offset = 0;

  while (offset < totalCount) {
    // 获取一批文档
    const docs = await prisma.knowledgeDocument.findMany({
      where: {
        OR: [
          { sourceDept: null },
          { publishDate: null },
        ],
      },
      select: {
        id: true,
        title: true,
        content: true,
        source: true,
        fileType: true,
        userId: true,
      },
      take: options.batchSize,
      skip: offset,
    });

    if (docs.length === 0) break;

    console.log(`\n处理批次 ${Math.floor(offset / options.batchSize) + 1}: ${docs.length} 个文档`);

    for (const doc of docs) {
      try {
        stats.processed++;

        // 提取元数据
        const metadata = options.useLlm
          ? await extractMetadata({
              title: doc.title,
              content: doc.content || '',
              parseResult: { content: doc.content || '', metadata: {} },
              filename: doc.source || '',
              useLlm: true,
            })
          : extractMetadataFast({
              title: doc.title,
              content: doc.content || '',
              parseResult: { content: doc.content || '', metadata: {} },
              filename: doc.source || '',
            });

        // 检查是否有实际更新
        const hasUpdates =
          metadata.publishDate !== null ||
          metadata.sourceDept !== null ||
          metadata.securityLevel !== 'internal' ||
          metadata.businessCategory !== null;

        if (!hasUpdates) {
          stats.skipped++;
          if (options.verbose) {
            console.log(`  [跳过] ${doc.id}: 无有效元数据`);
          }
          continue;
        }

        // 输出日志
        if (options.verbose) {
          console.log(`  [更新] ${doc.id}: ` +
            `部门=${metadata.sourceDept || '未识别'}, ` +
            `日期=${metadata.publishDate?.toISOString().split('T')[0] || '未识别'}, ` +
            `等级=${metadata.securityLevel}, ` +
            `分类=${metadata.businessCategory || '未识别'}`);
        }

        // 试运行模式下不实际更新
        if (options.dryRun) {
          stats.updated++;
          continue;
        }

        // 更新数据库
        await prisma.knowledgeDocument.update({
          where: { id: doc.id },
          data: {
            publishDate: metadata.publishDate,
            sourceDept: metadata.sourceDept,
            securityLevel: metadata.securityLevel,
            businessCategory: metadata.businessCategory,
            docLanguage: metadata.docLanguage,
            updatedAt: new Date(),
          },
        });

        stats.updated++;

      } catch (error) {
        stats.errors++;
        console.error(`  [错误] ${doc.id}: ${error instanceof Error ? error.message : error}`);
      }
    }

    offset += options.batchSize;

    // 进度报告
    const progress = Math.round((stats.processed / stats.total) * 100);
    const elapsed = Math.round((Date.now() - stats.startTime) / 1000);
    console.log(`\n进度: ${progress}% (${stats.processed}/${stats.total}), ` +
      `更新=${stats.updated}, 跳过=${stats.skipped}, 错误=${stats.errors}, ` +
      `耗时=${elapsed}s`);
  }

  // 最终报告
  const totalTime = Math.round((Date.now() - stats.startTime) / 1000);
  console.log('\n' + '='.repeat(60));
  console.log('回填完成');
  console.log('='.repeat(60));
  console.log(`处理总数: ${stats.processed}`);
  console.log(`成功更新: ${stats.updated}`);
  console.log(`跳过: ${stats.skipped}`);
  console.log(`错误: ${stats.errors}`);
  console.log(`总耗时: ${totalTime}s`);
  if (stats.updated > 0) {
    console.log(`平均速度: ${Math.round(stats.processed / (totalTime / 60))} 文档/分钟`);
  }
  console.log('='.repeat(60));

  await prisma.$disconnect();
}

/**
 * 显示帮助信息
 */
function showHelp(): void {
  console.log(`
存量文档元数据回填脚本

用法:
  npx tsx server/src/scripts/backfill-metadata.ts [选项]

选项:
  --llm           使用 LLM 分类（需要 Provider 配置）
  --no-llm        仅使用关键词匹配（默认）
  --batch-size=N  每批处理文档数量（默认 20）
  --dry-run       试运行，不实际更新数据库
  --quiet         减少输出日志

示例:
  # 快速回填
  npx tsx server/src/scripts/backfill-metadata.ts --no-llm --batch-size=50

  # 完整回填（含 LLM 分类）
  npx tsx server/src/scripts/backfill-metadata.ts --llm --batch-size=10

  # 试运行检查
  npx tsx server/src/scripts/backfill-metadata.ts --dry-run --verbose
`);
}

// 主入口
async function main(): Promise<void> {
  if (process.argv.includes('--help')) {
    showHelp();
    process.exit(0);
  }

  const options = parseArgs();

  try {
    await backfillMetadata(options);
    process.exit(0);
  } catch (error) {
    console.error('\n脚本执行失败:', error);
    process.exit(1);
  }
}

main();