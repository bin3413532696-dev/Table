// 测试 Embedding API
import { OpenAIEmbeddings } from '@langchain/openai';

async function testEmbedding() {
  const apiKey = 'pk_VpdDkQ325cCRhILF-Z9U6pCW9HXiQ_vKR7m3QtdX5Ew';
  const baseUrl = 'https://zyapi.tuluo.top:8888/v1';
  const model = 'bge-m3';

  console.log('测试配置:');
  console.log(`  API Key: ${apiKey.slice(0, 10)}...`);
  console.log(`  Base URL: ${baseUrl}`);
  console.log(`  Model: ${model}`);
  console.log('');

  try {
    const embeddings = new OpenAIEmbeddings({
      model,
      apiKey,
      configuration: { baseURL: baseUrl },
    });

    console.log('正在生成 Embedding...');
    const start = Date.now();

    const result = await embeddings.embedQuery('这是一个测试文本，用于验证Embedding功能是否正常工作。');

    const elapsed = Date.now() - start;

    console.log(`✅ 成功! 耗时: ${elapsed}ms`);
    console.log(`  向量维度: ${result.length}`);
    console.log(`  前5个值: [${result.slice(0, 5).map(v => v.toFixed(4)).join(', ')}]`);

  } catch (error) {
    console.log('❌ 失败:');
    console.error(error);
  }
}

testEmbedding();