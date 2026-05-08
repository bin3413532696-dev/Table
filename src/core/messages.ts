/**
 * 前端统一错误消息字典
 * 集中管理用户可见的中文提示，便于后续国际化替换
 */

export const MESSAGES = {
  common: {
    loadFailed: '加载失败',
    saveFailed: '保存失败',
    deleteFailed: '删除失败',
    networkError: '网络错误，请检查连接',
    unknownError: '未知错误',
  },
  knowledge: {
    loadDataFailed: '加载数据失败',
    saveNoteFailed: '保存失败',
    deleteNoteFailed: '删除失败',
    deletePresetTagFailed: '删除预设标签失败',
    noteTitleRequired: '请输入笔记标题',
    noteCreated: '笔记已创建',
    noteUpdated: '笔记已更新',
    noteDeleted: '笔记已删除',
    noPresetTags: '暂无预设标签，在编辑笔记时可以创建',
  },
  settings: {
    saveProfileFailed: '保存个人资料失败',
    switchUserFailed: '切换用户失败，请先创建该用户',
    restoreDefaultUserFailed: '恢复默认用户失败',
    createUserFailed: '创建用户失败',
    importFailed: '导入失败：文件格式不正确或与当前数据类型不匹配',
    clearFailed: '清理失败，请稍后重试',
    fetchModelsFailed: '获取模型列表失败',
    loadProviderFailed: '加载 Provider 失败',
    activateProviderFailed: '激活 Provider 失败',
    deleteProviderFailed: '删除 Provider 失败',
    saveProviderFailed: '保存 Provider 失败',
    importBusinessSuccess: '业务数据导入成功，页面即将刷新...',
    importKnowledgeSuccess: '知识库导入成功，页面即将刷新...',
    importSettingsSuccess: '本地设置导入成功，页面即将刷新...',
  },
  agent: {
    processError: '处理请求时发生错误。',
    executeFailed: '执行失败',
    cancelFailed: '取消执行失败',
    loadHistoryFailed: '加载失败',
    loadDetailFailed: '加载详情失败',
    deleteRunFailed: '删除失败',
    statusCompleted: '已完成',
    statusFailed: '失败',
    statusCancelled: '已取消',
    statusWaiting: '待确认',
    statusRunning: '运行中',
    statusPending: '等待中',
  },
  sync: {
    syncFailed: '同步失败',
    storageError: '存储错误',
    errorOccurred: '错误发生',
  },
} as const;
