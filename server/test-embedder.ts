import { createEmbedder } from './src/modules/knowledge-rag/indexing/embedder';

async function test() {
  try {
    const embedder = await createEmbedder();
    console.log('Embedder创建成功');

    const result = await embedder.embedQuery('人工智能技术测试');
    console.log('向量维度:', result.length);
    console.log('前5值:', result.slice(0, 5).map(v => v.toFixed(4)));
    console.log('✅ Embedding功能正常');
  } catch (e: any) {
    console.error('❌ 失败:', e.message || e);
  }
}
test();