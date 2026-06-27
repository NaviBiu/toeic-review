export const SCENARIOS: Record<string, string[]> = {
  '企业发展': ['研究', '产品研发'],
  '外食': ['商务/非正式午餐', '宴会', '招待会', '餐厅订位'],
  '娱乐': ['电影', '剧场', '音乐', '艺术', '展览', '博物馆', '媒体'],
  '金融/预算': ['银行业务', '投资', '税务', '会计', '账单'],
  '一般商务': ['契约', '谈判', '并购', '行销', '销售', '保证', '商业企划', '会议', '劳动关系'],
  '保健': ['医疗保险', '看医生', '牙医', '诊所', '医院'],
  '房屋/公司地产': ['建筑', '规格', '购买租赁', '电力瓦斯服务'],
  '制造业': ['工厂管理', '生产线', '品管'],
  '办公室': ['董事会', '委员会', '信件', '备忘录', '电话', '传真', '电子邮件', '办公室器材与家具', '办公室流程'],
  '人事': ['招考', '雇用', '退休', '薪资', '升迁', '应征与广告', '津贴', '奖励'],
  '采购': ['购物', '订购物资', '送货', '发票'],
  '技术层面': ['电子', '科技', '电脑', '实验室与相关器材', '技术规格'],
  '旅游': ['火车', '飞机', '计程车', '巴士', '船只', '渡轮', '票务', '时刻表', '车站', '机场广播', '租车', '饭店', '预订', '脱班与取消'],
  '未分类': [],
};

const FALLBACK_MINOR = '未分类';

export function isValidScenario(major: string, minor: string): boolean {
  const minors = SCENARIOS[major];
  if (!minors) return false;
  if (major === FALLBACK_MINOR) return minor === FALLBACK_MINOR;
  return minors.includes(minor) || minor === FALLBACK_MINOR;
}

export function sanitizeScenario(major: string, minor: string): { major: string; minor: string } {
  if (!SCENARIOS[major]) {
    return { major: FALLBACK_MINOR, minor: FALLBACK_MINOR };
  }
  if (isValidScenario(major, minor)) {
    return { major, minor };
  }
  return { major, minor: FALLBACK_MINOR };
}
