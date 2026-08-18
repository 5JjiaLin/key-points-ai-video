import type {
  CreatorCollection,
  LearningField,
  LearningVideo,
  MultiVideoLearningFixture,
} from './learning.types'
import { limitLearningTopic } from './learning.constants'

const assetRoot = '/assets/multi-video'

export const multiVideoLearningFixture: MultiVideoLearningFixture = {
  fields: [
    {
      id: 'astronomy',
      name: '天文宇宙',
      description: '探索宇宙的奥秘',
      iconUrl: `${assetRoot}/field-astronomy.png`,
      topic: limitLearningTopic('从黑洞形成到事件视界：理解恒星坍缩与时空弯曲的完整学习路径'),
      videoTitles: [
        '黑洞究竟是怎样形成的？从大质量恒星燃料耗尽开始讲清楚',
        '事件视界里面发生了什么：为什么连光也无法逃离黑洞',
        '超大质量黑洞从哪里来，它们为何总出现在星系中心',
        '如果靠近黑洞，时间真的会比远处流逝得更慢吗',
        '霍金辐射如何让黑洞缓慢蒸发，最后又会留下什么',
        '人类怎样拍到黑洞照片：从全球望远镜阵列到最终成像',
        '黑洞、白洞和虫洞之间究竟是什么关系',
      ],
      creators: ['巡天者小林', '宇宙放映厅', '天体物理笔记', '星河研究所'],
      collectionTitles: ['从恒星到黑洞', '看懂时空弯曲', '黑洞观测方法', '宇宙中的极端天体'],
    },
    {
      id: 'geography',
      name: '自然地理',
      description: '地球与自然环境',
      iconUrl: `${assetRoot}/field-geography.png`,
      topic: limitLearningTopic('从板块运动到山河地貌：理解地球表面持续变化的力量'),
      videoTitles: [
        '板块为什么一直在移动？地球内部的热量如何推动大陆漂移',
        '喜马拉雅山还在长高吗：印度板块与欧亚板块的持续碰撞',
        '河流怎样切出峡谷，又怎样把泥沙送到辽阔的冲积平原',
        '火山与地震为什么常常出现在相似的地理边界上',
        '沙漠并不只是缺水：环流、地形与洋流共同塑造干旱区',
        '冰川如何雕刻山谷，并记录数十万年的气候变化',
        '海岸线为什么不断变化：海浪、潮汐和人类活动的共同作用',
      ],
      creators: ['地球档案馆', '山河观察局', '地理显微镜', '自然现场'],
      collectionTitles: ['板块运动入门', '地貌是怎样形成的', '气候系统观察', '水循环与海岸'],
    },
    {
      id: 'history',
      name: '历史人文',
      description: '历史与文明故事',
      iconUrl: `${assetRoot}/field-history.png`,
      topic: limitLearningTopic('从制度、贸易与日常生活出发，重建古代文明演进的关键线索'),
      videoTitles: [
        '一座古城如何运转：道路、市场、官署和居民区的真实关系',
        '丝绸之路并不是一条路，它如何连接不同地区的商品与观念',
        '古代文书怎样被保存下来，我们又如何从碎片中还原历史',
        '王朝更替之外，普通人的衣食住行发生了哪些长期变化',
        '海上贸易兴起后，港口城市为何成为文化交流的前沿',
        '文字、度量衡与法律如何帮助早期国家扩大治理范围',
        '考古学家怎样判断遗址年代，又怎样避免过度解读证据',
      ],
      creators: ['文明切片', '历史放大镜', '考古现场', '人文地图'],
      collectionTitles: ['古城生活图景', '贸易与文明交流', '考古证据入门', '制度如何塑造社会'],
    },
    {
      id: 'life-science',
      name: '生命科学',
      description: '生命与生物奥秘',
      iconUrl: `${assetRoot}/field-life.png`,
      topic: limitLearningTopic('从细胞到生态系统：理解生命如何维持、适应并持续演化'),
      videoTitles: [
        '细胞膜为什么既能阻挡物质，又能精确完成交换与信息传递',
        '基因并不是命运：环境与调控如何影响性状最终表现',
        '免疫系统怎样识别威胁，又为什么有时会攻击自身组织',
        '自然选择如何积累微小差异，并最终形成新的物种',
        '微生物群落与人体之间存在怎样复杂而稳定的合作关系',
        '植物没有神经系统，为什么仍能感知光照、重力和损伤',
        '生态系统失去关键物种后，影响为什么会沿食物网扩散',
      ],
      creators: ['生命图鉴', '细胞观察室', '演化笔记', '生态放映厅'],
      collectionTitles: ['细胞如何工作', '基因与演化', '人体防御系统', '生态关系网络'],
    },
    {
      id: 'technology',
      name: '科技原理',
      description: '科技与原理揭秘',
      iconUrl: `${assetRoot}/field-tech.png`,
      topic: limitLearningTopic('拆解现代科技背后的核心原理：从芯片、通信到人工智能'),
      videoTitles: [
        '芯片上的晶体管如何开关，数十亿个开关又怎样协同计算',
        '无线信号看不见摸不着，手机为什么仍能准确接收信息',
        '定位系统怎样利用时间差，在地球表面计算出你的位置',
        '大模型如何把文字变成数字，并根据上下文预测下一个词',
        '锂电池充放电时发生了什么，能量为什么会逐渐衰减',
        '相机传感器怎样记录光线，并把它还原成我们看到的颜色',
        '机器人如何同时完成感知、规划与动作控制',
      ],
      creators: ['原理制造局', '硬核拆解', '工程师手记', '未来实验室'],
      collectionTitles: ['芯片工作原理', '通信系统入门', '人工智能基础', '能源与机器人'],
    },
    {
      id: 'economy',
      name: '社会经济',
      description: '社会与经济现象',
      iconUrl: `${assetRoot}/field-economy.png`,
      topic: limitLearningTopic('从个人选择到市场运行：理解价格、组织与公共决策的相互作用'),
      videoTitles: [
        '价格为什么会上涨：供需变化只是开始，还要看预期与传导',
        '一座城市的房租由什么决定，就业、交通和供给如何共同作用',
        '平台为什么喜欢补贴用户，网络效应又会怎样改变竞争格局',
        '通货膨胀如何影响不同家庭，为什么感受可能完全不同',
        '公共交通看似亏损，为什么仍可能为城市创造更大价值',
        '企业扩大规模后成本一定下降吗：理解规模经济的边界',
        '个人储蓄、企业投资与整体经济增长之间有什么联系',
      ],
      creators: ['经济观察站', '城市研究室', '商业显微镜', '社会数据局'],
      collectionTitles: ['价格是怎样形成的', '城市与住房', '平台与企业组织', '宏观经济入门'],
    },
    {
      id: 'physics-chemistry',
      name: '物理化学',
      description: '物质与能量的规律',
      iconUrl: `${assetRoot}/field-physics-chemistry-v2.png`,
      topic: limitLearningTopic('从分子结构到能量转化：理解物理与化学现象背后的基本规律'),
      videoTitles: [
        '为什么水加热会沸腾：分子运动与相变的完整过程',
        '化学反应中的能量从哪里来，又去了哪里',
        '为什么金属能导电，绝缘体却不能',
        '酸碱中和到底发生了什么：从离子角度看清反应',
        '光是波还是粒子：理解光的双重性质',
        '为什么有些反应放热，有些反应吸热',
        '催化剂如何加速反应却不被消耗',
      ],
      creators: ['分子观察室', '物理原理局', '化学现场', '实验笔记'],
      collectionTitles: ['物质三态与相变', '化学反应入门', '电与磁的原理', '能量守恒观察'],
    },
    {
      id: 'food-nutrition',
      name: '食品营养',
      description: '饮食与健康科学',
      iconUrl: `${assetRoot}/field-food-nutrition-v2.png`,
      topic: limitLearningTopic('从营养素到饮食结构：理解食物如何影响身体与健康'),
      videoTitles: [
        '蛋白质、脂肪和碳水化合物在身体里各起什么作用',
        '为什么均衡饮食比单一节食更有利于健康',
        '维生素并非越多越好：过量摄入会有什么风险',
        '糖分是如何影响血糖和身体代谢的',
        '膳食纤维为什么对肠道健康这么重要',
        '加工食品中的添加剂到底安不安全',
        '如何科学搭配三餐才能满足身体需求',
      ],
      creators: ['营养实验室', '饮食观察站', '健康厨房', '食物研究所'],
      collectionTitles: ['三大营养素入门', '均衡饮食指南', '读懂食品标签', '代谢与健康'],
    },
  ],
}

const durations = ['09:25', '06:48', '12:16', '08:34', '10:05', '07:42', '11:20']

export function buildMultiCreatorVideos(field: LearningField): LearningVideo[] {
  return field.videoTitles.map((title, index) => ({
    id: `${field.id}-video-${index + 1}`,
    title,
    creator: field.creators[index % field.creators.length],
    duration: durations[index % durations.length],
  }))
}

export function buildCreatorCollections(field: LearningField): CreatorCollection[] {
  return field.collectionTitles.map((title, collectionIndex) => ({
    id: `${field.id}-collection-${collectionIndex + 1}`,
    title,
    creator: field.creators[collectionIndex % field.creators.length],
    videos: Array.from({ length: 2 }, (_, videoIndex) => {
      const sourceIndex = (collectionIndex * 2 + videoIndex) % field.videoTitles.length
      return {
        id: `${field.id}-collection-${collectionIndex + 1}-video-${videoIndex + 1}`,
        title: field.videoTitles[sourceIndex],
        creator: field.creators[collectionIndex % field.creators.length],
        duration: durations[sourceIndex % durations.length],
      }
    }),
  }))
}
