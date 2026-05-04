// 编码测试：用于确认中文注释和字符串不会出现乱码

const testMessage = "你好，世界。这里是一段中文编码测试。";
const testStatus = "任务状态：正常";

function printEncodingTest() {
  console.log(testMessage);
  console.log(testStatus);
}

printEncodingTest();
