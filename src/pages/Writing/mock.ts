import type {
  WritingCanonSection,
  WritingProject,
  WritingWorkflowType,
} from './types';

export const canonSectionMeta: Array<{
  id: WritingCanonSection;
  label: string;
  helper: string;
}> = [
  { id: 'characters', label: '角色', helper: '人物卡、动机与关系张力' },
  { id: 'factions', label: '势力', helper: '组织目标与外部压力' },
  { id: 'locations', label: '地点', helper: '场景规则、资源与危险' },
  { id: 'rules', label: '规则', helper: '世界法则、禁忌与例外' },
  { id: 'timeline', label: '时间线', helper: '关键事件链与后果' },
];

export const projectNavItems = [
  { path: '', label: '总览' },
  { path: 'canon', label: '设定库' },
  { path: 'review', label: '冲突审校' },
  { path: 'bible', label: '世界观档案' },
  { path: 'workflows', label: '工作流' },
  { path: 'history', label: '历史' },
  { path: 'settings', label: '设置' },
] as const;

export const workflowMeta: Array<{
  id: WritingWorkflowType;
  label: string;
}> = [
  { id: 'bootstrap_bible', label: '基础设定' },
  { id: 'consistency_check', label: '一致性检查' },
  { id: 'finalize_bible', label: '世界观档案' },
];

export const writingProjects: WritingProject[] = [
  {
    id: 'p-xiangu',
    title: '仙骨重铸录',
    genre: '玄幻',
    subGenre: '东方升级流',
    worldType: '宗门修仙 / 禁忌遗迹',
    premise: '被逐出宗门的外门弟子，在一块残缺仙骨中听见了上古炼体者的回声。',
    bibleVersion: 'v0.7',
    updatedAt: '今天 09:24',
    status: 'active',
    storyCompass: {
      promise: '升级必须伴随肉身代价，爽感不能脱离痛感。',
      protagonistNeed: '林砚既想洗刷污名，也必须学会不把力量当成唯一答案。',
      worldPressure: '宗门秩序、黑市交易与禁地残响同时压迫主角。',
      tone: '冷硬、压抑后爆发、节奏偏快',
      intent: [
        '主角前中期必须持续处于资源劣势，不能轻易无敌。',
        '能力成长依赖肉身锻造与代价交换，不能纯数值膨胀。',
        '宗门体系要有压迫感，配角不能只是纸板反派。',
      ],
    },
    metrics: {
      confirmed: 18,
      candidates: 6,
      openConflicts: 4,
      bibleCoverage: 78,
    },
    assets: {
      characters: [
        {
          id: 'char-linyan',
          title: '林砚',
          subtitle: '主角 · 受辱开局 / 炼体',
          summary: '骨相被毁后改走炼体之路，克制而执拗，力量每前进一步都要付出切身代价。',
          status: 'confirmed',
          tags: ['资源劣势', '代价成长', '宗门压迫'],
          sections: [
            { label: '角色目标', value: '重返云岚宗核心并查清仙骨来历。' },
            { label: '核心张力', value: '每次借用仙骨残响都会加重神识裂伤。' },
            { label: '写作提醒', value: ['不能过早逆天翻盘', '胜利必须留下后遗症'] },
          ],
        },
        {
          id: 'char-suqiuwu',
          title: '苏秋梧',
          subtitle: '关键女主 · 阵师 / 试探型盟友',
          summary: '知道部分古仙骨真相，却不能直接说破，和主角的关系应该始终保持共谋但不完全信任。',
          status: 'candidate',
          tags: ['知情隐瞒', '阵法', '慢热关系'],
          sections: [
            { label: '角色目标', value: '维护家族与个人道统之间的平衡。' },
            { label: '核心张力', value: '她知道得太多，但每次透露真相都会引发家族代价。' },
            { label: '候选修改', value: '将“完全不知情”改为“知情但不明说”，让后续对白更自洽。' },
          ],
        },
        {
          id: 'char-mohe',
          title: '莫鹤山',
          subtitle: '反派导师 · 伪善权谋',
          summary: '表面温和，实则把主角视作容器，适合承担长期压迫与精神控制的反派功能。',
          status: 'confirmed',
          tags: ['控制型反派', '宗门话语权', '长期对手'],
          sections: [
            { label: '角色目标', value: '借主角体质完成禁术复生。' },
            { label: '核心张力', value: '越是装成温和师长，越能压低主角与读者的警觉。' },
          ],
        },
      ],
      factions: [
        {
          id: 'faction-cloud',
          title: '云岚宗',
          subtitle: '名门正统外表下的等级机器',
          summary: '秩序感强，但内部以贡献和血脉决定资源分配，是主角长期压迫来源。',
          status: 'confirmed',
          tags: ['宗门秩序', '资源垄断'],
          sections: [
            { label: '势力目标', value: '垄断本域灵矿与古遗迹解释权。' },
            { label: '势力方法', value: ['执律堂高压管理', '血脉优先制', '对外维持正统叙事'] },
          ],
        },
        {
          id: 'faction-ash',
          title: '灰烬行会',
          subtitle: '黑市协作网络',
          summary: '横跨数城的地下组织，可以提供捷径，但每次帮助都应收取未来筹码。',
          status: 'candidate',
          tags: ['灰市', '情报交易'],
          sections: [
            { label: '势力目标', value: '收购禁忌材料并操纵遗迹消息。' },
            { label: '写作提醒', value: '不能把它写成纯善意外挂，必须带长期代价。' },
          ],
        },
      ],
      locations: [
        {
          id: 'loc-bonepit',
          title: '断骨坑',
          subtitle: '禁地遗迹',
          summary: '主角第一次听见仙骨残响的地方，既是力量起点，也是未来真相回收的第一锚点。',
          status: 'confirmed',
          tags: ['禁地', '真相锚点'],
          sections: [
            { label: '地点规则', value: '夜间灵压翻倍，血肉之躯会被残念共鸣吸附。' },
            { label: '危险要素', value: ['残魂污染', '地气逆涌', '视野错乱'] },
            { label: '资源价值', value: ['碎骨铭纹', '古战场残兵', '炼体材料'] },
          ],
        },
        {
          id: 'loc-market',
          title: '北荒市',
          subtitle: '交易城镇',
          summary: '宗门势力之外的灰色缓冲区，适合展开资源竞争、黑市合作和规则摩擦。',
          status: 'draft',
          tags: ['灰市规则', '过渡空间'],
          sections: [
            { label: '地点规则', value: '城内不许明杀，但暗盘允许赌命交易。' },
            { label: '危险要素', value: '假情报多、线人密集、冲突更隐蔽。' },
          ],
        },
      ],
      rules: [
        {
          id: 'rule-echo',
          title: '仙骨残响',
          subtitle: '能力体系',
          summary: '残响可以临时打开古体术感知，但必须以神识创伤作为代价。',
          status: 'confirmed',
          tags: ['代价', '误判风险'],
          sections: [
            { label: '硬约束', value: '任何越阶使用后都必须有明确后果。' },
            { label: '例外条款', value: '吞纳同源骨纹时，代价可阶段性转移。' },
            { label: '写作提醒', value: '副作用必须进入时间线，而不是只停留在设定文本中。' },
          ],
        },
        {
          id: 'rule-blood',
          title: '宗门血脉优先制',
          subtitle: '社会规则',
          summary: '核心资源优先给嫡系与内定弟子，是主角前期无法正常上升的制度根源。',
          status: 'confirmed',
          tags: ['结构性压迫'],
          sections: [
            { label: '硬约束', value: '主角不能通过普通试炼直接逆袭进核心层。' },
            { label: '例外条款', value: '掌握禁地密钥后可获得一次破格资格。' },
          ],
        },
      ],
      timeline: [
        {
          id: 'event-exile',
          title: '外门逐出',
          subtitle: '开篇第 1 日 · 破局',
          summary: '林砚在众目睽睽下被废骨逐出，世界关系和角色处境在此处一次性落位。',
          status: 'confirmed',
          tags: ['羞辱开局', '关系定调'],
          sections: [
            { label: '前置条件', value: ['宗门审判完成', '莫鹤山暗中推动结果'] },
            { label: '后果链', value: ['身份跌入谷底', '与灰市发生第一次接触'] },
          ],
        },
        {
          id: 'event-echo',
          title: '残响初鸣',
          subtitle: '开篇第 3 夜 · 点火',
          summary: '主角第一次听见仙骨残响并完成搏命锻骨，必须把代价感同时写实。',
          status: 'candidate',
          tags: ['能力点火', '代价显化'],
          sections: [
            { label: '前置条件', value: ['进入禁地深层', '体魄已濒临崩溃'] },
            { label: '后果链', value: ['获得新能力', '神识裂纹埋下长期后果'] },
            { label: '候选修改', value: '在第一次小高潮前补一处感知失衡，让代价更可见。' },
          ],
        },
      ],
    },
    bibles: [
      {
        id: 'bible-07',
        version: 'v0.7',
        status: 'published',
        summary: '当前正式版已明确主角、核心规则与宗门压迫结构，但灰市支线仍偏薄。',
        pillars: ['资源匮乏感', '肉身代价成长', '宗门秩序压迫', '禁地真相牵引'],
        excerpt: [
          '林砚的成长必须伴随真实代价，任何实力提升都应在身体、关系或局势上留下后果。',
          '断骨坑不仅是能力起点，也是未来真相回收的第一锚点。',
        ],
      },
      {
        id: 'bible-08',
        version: 'v0.8-candidate',
        status: 'candidate',
        summary: '候选版补强了北荒市与灰烬行会，但还需要修复“资源劣势被削弱”的风险。',
        pillars: ['黑市缓冲区', '灰势力情报链', '阵法协作张力', '副作用显性化'],
        excerpt: [
          '灰烬行会每次帮助都应该索取未来筹码，而不是成为便利外挂。',
          '苏秋梧与林砚的关系应始终保留一层互相试探的缝隙。',
        ],
      },
    ],
    conflicts: [
      {
        id: 'conflict-su',
        title: '苏秋梧知情范围与对白表现冲突',
        category: '角色认知',
        severity: 'high',
        status: 'open',
        summary: '候选设定里她已经掌握仙骨来源，但现有试写对白仍表现为完全不知情。',
        suggestion: '保留“知情但不能明说”的设定，把惊讶改成试探和确认。',
        involvedAssets: ['苏秋梧', '仙骨残响'],
      },
      {
        id: 'conflict-city',
        title: '北荒市禁止明杀与追杀桥段节奏冲突',
        category: '地点规则',
        severity: 'medium',
        status: 'open',
        summary: '如果这里发生公开追杀，会直接破坏已设定的城市规则。',
        suggestion: '改为暗盘竞技或出城截杀，让“不能明杀”继续成立。',
        involvedAssets: ['北荒市'],
      },
      {
        id: 'conflict-poverty',
        title: '主角资源劣势被高阶阵图削弱',
        category: '作者意图',
        severity: 'critical',
        status: 'open',
        summary: '候选版本中苏秋梧过早赠送高阶阵图，会破坏长期资源劣势主轴。',
        suggestion: '改为残缺阵图，并附带高风险激活条件。',
        involvedAssets: ['林砚', '苏秋梧'],
      },
      {
        id: 'conflict-cost',
        title: '残响代价未在时间线里兑现',
        category: '因果链',
        severity: 'low',
        status: 'ignored',
        summary: '规则写了副作用，但时间线后续还没有出现真实反噬。',
        suggestion: '在第一次胜利后补一次感知迟滞或误判。',
        involvedAssets: ['仙骨残响', '残响初鸣'],
      },
    ],
    workflows: {
      bootstrap_bible: {
        label: '生成基础设定',
        status: 'waiting_review',
        stage: '等待人工确认',
        focus: '角色、势力与时间线起始事件',
        stages: [
          { id: 's1', label: '装载项目约束', detail: '已合并作者意图、禁忌项和世界规则。', status: 'done' },
          { id: 's2', label: '生成候选设定', detail: '补了灰烬行会与北荒市支线。', status: 'done' },
          { id: 's3', label: '结构化归档', detail: '已生成 6 条候选资产补丁。', status: 'done' },
          { id: 's4', label: '人工确认', detail: '等待你决定哪些候选版本可以进入正式资产。', status: 'current' },
          { id: 's5', label: '更新世界观档案', detail: '确认后才会生成 v0.8 正式版。', status: 'todo' },
        ],
        reviewQueue: [
          { id: 'q1', title: '苏秋梧知情范围重写', target: '角色', summary: '把“不知情”改成“知情但不明说”，让关系更有张力。' },
          { id: 'q2', title: '北荒市规则细化', target: '地点', summary: '强化“不可明杀、允许暗盘赌命”的灰色规则。' },
          { id: 'q3', title: '残响副作用追加', target: '规则', summary: '补充一次使用后的感知失衡节点。' },
        ],
        events: [
          { id: 'e1', time: '09:21', text: '角色组补强完成，新增 1 条关系边。', tone: 'success' },
          { id: 'e2', time: '09:23', text: '检测到 2 条和作者意图相关的高风险冲突。', tone: 'warning' },
          { id: 'e3', time: '09:24', text: '等待人工确认后才能更新正式版世界观档案。', tone: 'info' },
        ],
      },
      consistency_check: {
        label: '执行一致性检查',
        status: 'running',
        stage: '扫描规则与因果链',
        focus: '角色认知、地点规则与残响后果',
        stages: [
          { id: 'c1', label: '载入正式资产', detail: '已读取 v0.7 圣经和已确认设定。', status: 'done' },
          { id: 'c2', label: '追踪关键事实链', detail: '建立 14 条角色-事件-规则链路。', status: 'done' },
          { id: 'c3', label: '扫描冲突', detail: '正在检查副作用在后续事件中的体现。', status: 'current' },
          { id: 'c4', label: '生成建议', detail: '将输出按严重级别排序的冲突报告。', status: 'todo' },
        ],
        reviewQueue: [
          { id: 'cq1', title: '补一处代价回收节点', target: '时间线', summary: '建议在第一次胜利后安排一次神识迟滞。' },
        ],
        events: [
          { id: 'ce1', time: '09:26', text: '已比对作者意图与能力规则 9 组。', tone: 'info' },
          { id: 'ce2', time: '09:27', text: '发现“资源劣势”主轴有被削弱风险。', tone: 'warning' },
        ],
      },
      finalize_bible: {
        label: '生成世界观档案',
        status: 'completed',
        stage: '候选文档已生成',
        focus: '整合作品定位、规则与阶段事件',
        stages: [
          { id: 'f1', label: '收集确认资产', detail: '已收集 18 条正式资产。', status: 'done' },
          { id: 'f2', label: '编排圣经结构', detail: '已整理为世界、角色、规则、时间线四大段。', status: 'done' },
          { id: 'f3', label: '生成候选文档', detail: 'v0.8-candidate 已完成。', status: 'done' },
        ],
        reviewQueue: [
          { id: 'fq1', title: '世界观档案候选版', target: '档案', summary: '新增黑市规则段与角色张力说明，待最终发布。' },
        ],
        events: [
          { id: 'fe1', time: '09:18', text: 'v0.8 候选文档编排完成。', tone: 'success' },
          { id: 'fe2', time: '09:19', text: '确认关键修订后即可发布。', tone: 'info' },
        ],
      },
    },
    history: [
      {
        id: 'h1',
        type: 'workflow',
        title: '基础设定流程运行完成',
        summary: '生成了灰烬行会与北荒市候选资产，并进入人工确认阶段。',
        time: '今天 09:24',
        actor: 'LangGraph',
        tone: 'success',
      },
      {
        id: 'h2',
        type: 'decision',
        title: '接受角色候选修订',
        summary: '你确认了林砚的“资源劣势”提醒，但暂缓接受苏秋梧的阵图补丁。',
        time: '今天 09:08',
        actor: '你',
        tone: 'neutral',
      },
      {
        id: 'h3',
        type: 'asset',
        title: '补写断骨坑规则',
        summary: '手动添加“夜间灵压翻倍”的地点规则。',
        time: '今天 08:42',
        actor: '你',
        tone: 'success',
      },
      {
        id: 'h4',
        type: 'bible',
        title: '发布 v0.7 世界观档案',
        summary: '当前正式版成为写作真相源，后续修订必须经过候选确认。',
        time: '昨天 22:12',
        actor: '系统',
        tone: 'success',
      },
    ],
    settings: {
      forbiddenTerms: ['系统流', '校园线', '主角无代价暴涨'],
      styleConstraints: ['第三人称', '偏白话', '节奏快', '情绪克制后爆发'],
      boundaryRules: ['主角前期不可无敌', '能力体系必须自洽', '资源获取要有代价'],
      modelProfile: 'OpenAI-compatible · creative-draft + structured-review 双阶段',
      workflowNotes: '角色与规则改动必须先过一致性检查，再允许生成新的世界观档案候选版。',
    },
  },
  {
    id: 'p-fog',
    title: '雾港造梦人',
    genre: '都市奇谭',
    subGenre: '悬疑成长',
    worldType: '港城异能 / 集体潜意识',
    premise: '能进入他人梦境修补记忆的女主，在雾港连环失梦案中发现自己记忆被删改过。',
    bibleVersion: 'v0.3',
    updatedAt: '昨天 22:16',
    status: 'draft',
    storyCompass: {
      promise: '梦境修补每推进一次案件，都要反噬主角自身记忆。',
      protagonistNeed: '安梨需要学会接受自己的记忆也可能是不可靠的。',
      worldPressure: '雾港的梦检局、旧码头与群体梦境构成持续压迫。',
      tone: '潮湿、冷感、情绪克制',
      intent: [
        '不能写成单纯破案文，梦境修补必须反向揭露主角自身问题。',
        '港城要有潮湿工业感，不要赛博霓虹味。',
        '情感线要慢，信任建立必须来自共同承担风险。',
      ],
    },
    metrics: {
      confirmed: 9,
      candidates: 3,
      openConflicts: 2,
      bibleCoverage: 46,
    },
    assets: {
      characters: [
        {
          id: 'fog-anli',
          title: '安梨',
          subtitle: '主角 · 梦境修补师',
          summary: '经营旧梦修补店的年轻修补师，表面平静，内里高度戒备。',
          status: 'confirmed',
          tags: ['记忆代价', '不可靠叙事'],
          sections: [
            { label: '角色目标', value: '查清自己童年失忆与雾港失梦案的关系。' },
            { label: '核心张力', value: '每次修补梦境都会失去一段自己的感官记忆。' },
          ],
        },
      ],
      factions: [
        {
          id: 'fog-bureau',
          title: '港务梦检局',
          subtitle: '半官方监管机构',
          summary: '名义上负责安全审查，实际上掌握删改梦境的权力。',
          status: 'draft',
          tags: ['机构压迫', '档案控制'],
          sections: [
            { label: '势力目标', value: '控制梦境修补技术在雾港的流通。' },
            { label: '写作提醒', value: '不要让它过早把关系线压成纯办案搭档。' },
          ],
        },
      ],
      locations: [
        {
          id: 'fog-wharf',
          title: '旧三号码头',
          subtitle: '废弃工业区',
          summary: '梦境与现实交叠最严重的区域，是案件主轴入口。',
          status: 'candidate',
          tags: ['潮湿工业感', '集体梦'],
          sections: [
            { label: '地点规则', value: '夜雾极重时会出现群体共享梦境。' },
            { label: '危险要素', value: ['迷失方向', '记忆污染', '失踪人员回声'] },
          ],
        },
      ],
      rules: [
        {
          id: 'fog-dream',
          title: '梦匣修补',
          subtitle: '能力体系',
          summary: '修补以交换记忆质感为代价，而非单纯读取信息。',
          status: 'confirmed',
          tags: ['能力代价'],
          sections: [
            { label: '硬约束', value: '每次使用都必须让主角失去一种个人经验。' },
            { label: '例外条款', value: '若修补对象与主角存在旧记忆共鸣，代价会转化为情绪紊乱。' },
          ],
        },
      ],
      timeline: [
        {
          id: 'fog-case',
          title: '第一起失梦案',
          subtitle: '故事第 1 周 · 引子',
          summary: '港城出现第一位梦境被掏空的失梦者，安梨被迫接案。',
          status: 'confirmed',
          tags: ['案件引子'],
          sections: [
            { label: '前置条件', value: ['旧码头连续大雾', '梦检局开始封锁消息'] },
            { label: '后果链', value: ['主角卷入官方视线', '旧三号码头成为高频场景'] },
          ],
        },
      ],
    },
    bibles: [
      {
        id: 'fog-bible',
        version: 'v0.3',
        status: 'published',
        summary: '雾港气质与核心能力方向已确定，但案件链和梦检局灰度仍需加厚。',
        pillars: ['潮湿工业感', '记忆代价', '自我失真', '慢热关系'],
        excerpt: [
          '安梨不是侦探，她是在修补别人裂缝时逐步看见自己的裂缝。',
          '每次能力使用都要失去某种真实感，这是作品最核心的疼痛机制。',
        ],
      },
    ],
    conflicts: [
      {
        id: 'fog-conflict-1',
        title: '梦检局高频介入会破坏慢热情感线',
        category: '节奏',
        severity: 'medium',
        status: 'open',
        summary: '男主若前期以官方身份高频介入，会导致关系线过快靠近。',
        suggestion: '改为案卷互换与匿名协助，而不是强绑定同行。',
        involvedAssets: ['安梨', '港务梦检局'],
      },
      {
        id: 'fog-conflict-2',
        title: '旧三号码头触发边界仍不够清晰',
        category: '规则',
        severity: 'low',
        status: 'open',
        summary: '“夜雾重时触发”太模糊，容易导致后面写法随意。',
        suggestion: '加上潮汐、汽笛频率或人数阈值等具体条件。',
        involvedAssets: ['旧三号码头'],
      },
    ],
    workflows: {
      bootstrap_bible: {
        label: '生成基础设定',
        status: 'completed',
        stage: '初版完成',
        focus: '港务梦检局与旧码头',
        stages: [
          { id: 'fb1', label: '生成设定雏形', detail: '已完成。', status: 'done' },
          { id: 'fb2', label: '结构化归档', detail: '已完成。', status: 'done' },
          { id: 'fb3', label: '待人工复核', detail: '有 1 条地点候选修订。', status: 'done' },
        ],
        reviewQueue: [
          { id: 'fbq1', title: '旧码头触发条件细化', target: '地点', summary: '建议加入潮汐与汽笛共振条件。' },
        ],
        events: [{ id: 'fbe1', time: '22:16', text: '雾港设定初版已生成。', tone: 'success' }],
      },
      consistency_check: {
        label: '执行一致性检查',
        status: 'waiting_review',
        stage: '等待处理 2 条冲突',
        focus: '慢热关系与机构压迫',
        stages: [
          { id: 'fc1', label: '扫描人物关系', detail: '已完成。', status: 'done' },
          { id: 'fc2', label: '分析规则边界', detail: '已完成。', status: 'done' },
          { id: 'fc3', label: '生成冲突建议', detail: '等待确认。', status: 'current' },
        ],
        reviewQueue: [
          { id: 'fcq1', title: '梦检局介入节奏调整', target: '势力', summary: '前期保持匿名协助，而非并肩搭档。' },
        ],
        events: [{ id: 'fce1', time: '22:20', text: '关系推进节奏存在破坏风险。', tone: 'warning' }],
      },
      finalize_bible: {
        label: '生成世界观档案',
        status: 'completed',
        stage: '正式版可用',
        focus: '世界底色与主角代价机制',
        stages: [
          { id: 'ff1', label: '整理正式资产', detail: '已完成。', status: 'done' },
          { id: 'ff2', label: '生成圣经', detail: '已完成。', status: 'done' },
        ],
        reviewQueue: [],
        events: [{ id: 'ffe1', time: '22:24', text: 'v0.3 正式版已发布。', tone: 'success' }],
      },
    },
    history: [
      {
        id: 'fh1',
        type: 'workflow',
        title: '一致性检查完成',
        summary: '定位出 2 条关系与规则边界问题。',
        time: '昨天 22:20',
        actor: 'LangGraph',
        tone: 'warning',
      },
      {
        id: 'fh2',
        type: 'bible',
        title: '发布 v0.3 世界观档案',
        summary: '世界底色与主角代价机制被锁定为当前正式真相源。',
        time: '昨天 22:24',
        actor: '系统',
        tone: 'success',
      },
    ],
    settings: {
      forbiddenTerms: ['赛博朋克霓虹', '快节奏恋爱推进'],
      styleConstraints: ['第三人称近距离', '情绪克制', '潮湿工业感'],
      boundaryRules: ['梦境代价必须真实生效', '感情线慢热', '案件推进要反噬主角'],
      modelProfile: '多阶段：设定生成 / 审校 / 圣经汇总',
      workflowNotes: '先做世界与规则，再做案件链补全，避免先写正文导致设定漂移。',
    },
  },
];

export function getWritingProject(projectId: string) {
  return writingProjects.find((project) => project.id === projectId) || null;
}

export function getRecentWritingProject() {
  return writingProjects[0];
}
