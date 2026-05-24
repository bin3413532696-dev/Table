import 'dotenv/config';
import { prisma } from './src/db/client';

async function checkProviders() {
  console.log('=== 检查 Providers ===\n');

  const providers = await prisma.apiProvider.findMany({
    orderBy: { updatedAt: 'desc' },
    take: 3,
  });

  console.log('Providers:', providers.length);

  for (const p of providers) {
    console.log({
      id: p.id,
      name: p.name,
      apiFormat: p.apiFormat,
      baseUrl: p.baseUrl,
      model: p.model,
      isActive: p.isActive,
      hasApiKey: !!p.apiKeyEncrypted,
    });
  }

  // 检查 active provider
  const active = providers.find(p => p.isActive);
  if (active) {
    console.log('\nActive Provider:');
    console.log('  - apiFormat:', active.apiFormat);
    console.log('  - baseUrl:', active.baseUrl);
    console.log('  - model:', active.model);

    // 检查是否支持 OpenAI function calling
    if (active.apiFormat === 'custom') {
      console.log('  - 使用 OpenAI-compatible API，应该支持 bindTools');
    } else if (active.apiFormat === 'openai') {
      console.log('  - 使用原生 OpenAI API，支持 function calling');
    } else {
      console.log('  - ⚠️ 可能不支持 OpenAI function calling 格式');
    }
  } else {
    console.log('⚠️ 没有激活的 Provider');
  }

  await prisma.$disconnect();
}

checkProviders();