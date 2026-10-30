import { publicAsset } from '../utils/publicAsset'

export type ExperimentCategory = 'image' | 'particles' | 'space' | 'data'
export type ExperimentId =
  | 'particle' | 'liquid' | 'fireworks' | 'portal' | 'galaxy'
  | 'rain' | 'earth' | 'tunnel' | 'season' | 'city' | 'depth' | 'population' | 'airplane' | 'flowers'

export type Experiment = {
  id: ExperimentId
  number: string
  href: string
  title: string
  summary: string
  category: ExperimentCategory
  categoryLabel: string
  tags: string[]
  image: string
  imageAlt: string
}

// 首页与快捷导航共用的实验目录；路由、交互组件和封面就绪后再加入，避免出现无法体验的入口。
export const experiments: Experiment[] = [
  {
    id: 'particle', number: '01', href: '#/particle-photo', title: '照片粒子消散与重组',
    summary: '伸手拨开照片，再看它从数万颗色点里回来。',
    category: 'image', categoryLabel: '图像与材质', tags: ['照片', '粒子', '鼠标'],
    image: publicAsset('images/home/01.webp'), imageAlt: '红色花朵的照片粒子效果预览',
  },
  {
    id: 'liquid', number: '02', href: '#/liquid-poster', title: '鼠标拨动的液态海报',
    summary: '鼠标划过花瓣，画面像液体一样被轻轻推开。',
    category: 'image', categoryLabel: '图像与材质', tags: ['海报', '折射', '鼠标'],
    image: publicAsset('images/home/02.webp'), imageAlt: '花瓣被液态波纹拨动的画面',
  },
  {
    id: 'fireworks', number: '03', href: '#/text-fireworks', title: '文字变成烟花',
    summary: '写下一句话，让笔画散成夜空里的光点。',
    category: 'particles', categoryLabel: '粒子与光', tags: ['文字', '粒子', '烟花'],
    image: publicAsset('images/home/03.webp'), imageAlt: '彩色文字粒子在深色夜空绽放',
  },
  {
    id: 'portal', number: '04', href: '#/portal-journey', title: '穿越传送门',
    summary: '从这一侧走进去，镜头越过光圈抵达另一个世界。',
    category: 'space', categoryLabel: '空间与场景', tags: ['传送门', '镜头', '场景'],
    image: publicAsset('images/home/04.webp'), imageAlt: '蓝色光圈中的异世界传送门',
  },
  {
    id: 'galaxy', number: '05', href: '#/nebula-galaxy', title: '可交互的星云银河',
    summary: '拖动、缩放、触碰星核，看星尘沿旋臂流动。',
    category: 'particles', categoryLabel: '粒子与光', tags: ['星云', '粒子', '拖动'],
    image: publicAsset('images/home/05.webp'), imageAlt: '紫色旋臂与明亮星核组成的银河',
  },
  {
    id: 'rain', number: '06', href: '#/rain-window', title: '雨夜玻璃窗',
    summary: '雨滴贴着玻璃滑落，擦开一小片清晰的夜色。',
    category: 'image', categoryLabel: '图像与材质', tags: ['雨滴', '玻璃', '折射'],
    image: publicAsset('images/home/06.webp'), imageAlt: '布满雨滴的玻璃窗与夜间城市',
  },
  {
    id: 'earth', number: '07', href: '#/holographic-earth', title: '扫描中的全息地球',
    summary: '旋转地球，扫描光带从真实陆地轮廓上掠过。',
    category: 'space', categoryLabel: '空间与场景', tags: ['地球', '扫描', '定位'],
    image: publicAsset('images/home/07.webp'), imageAlt: '正在扫描的三维地球画面',
  },
  {
    id: 'tunnel', number: '08', href: '#/neon-tunnel', title: '无限延伸的霓虹隧道',
    summary: '沿着一层层光框持续向前，改变速度和视角。',
    category: 'space', categoryLabel: '空间与场景', tags: ['隧道', '霓虹', '速度'],
    image: publicAsset('images/home/08.webp'), imageAlt: '蓝紫色灯框无限延伸的隧道',
  },
  {
    id: 'season', number: '09', href: '#/season-glass', title: '击碎玻璃，露出另一个季节',
    summary: '点一下，裂痕从指尖蔓延，冬景后面是春天。',
    category: 'image', categoryLabel: '图像与材质', tags: ['玻璃', '裂变', '换季'],
    image: publicAsset('images/home/09.webp'), imageAlt: '湖边从冬雪过渡到春景的画面',
  },
  {
    id: 'city', number: '10', href: '#/miniature-city', title: '一张照片立成微缩街道',
    summary: '从俯拍照片里，慢慢升起楼房、街道和小车。',
    category: 'image', categoryLabel: '图像与材质', tags: ['照片', '城市', '建模'],
    image: publicAsset('images/home/10.webp'), imageAlt: '从城市俯拍照片立起的微缩街区',
  },
  {
    id: 'depth', number: '11', href: '#/photo-depth', title: '让一张照片有真正的前后层次',
    summary: '花蕊、花瓣、叶片和背景各占一个平面，转动视角，看遮挡与视差出现。',
    category: 'image', categoryLabel: '图像与材质', tags: ['照片', '视差', '景深'],
    image: publicAsset('images/home/11.webp'), imageAlt: '花朵照片分出清晰花瓣与虚化叶片的空间层次',
  },
  {
    id: 'population', number: '12', href: '#/population-tide', title: '输入出生年份，看你这一代人穿过人口潮',
    summary: '选一年出生，沿着三维人口地形走到现在，看同岁人口怎样变化。',
    category: 'data', categoryLabel: '数据与叙事', tags: ['人口', '出生年份', '数据可视化'],
    image: publicAsset('images/home/12.webp'), imageAlt: '深色三维人口地形上，一条金色轨迹随出生年份穿过人口潮',
  },
  {
    id: 'airplane', number: '13', href: '#/photo-airplane', title: '一张照片，被你折成纸飞机飞走',
    summary: '换上自己的照片，沿折痕收起双翼，按住向后拉，再松手放飞。',
    category: 'image', categoryLabel: '图像与材质', tags: ['照片', '折纸', '放飞'],
    image: publicAsset('images/home/13.webp'), imageAlt: '暖白工作台上，一张山水照片被折成带有照片纹理的纸飞机',
  },
  {
    id: 'flowers', number: '14', href: '#/flower-trail', title: '鼠标经过，荒地上长出一条花路',
    summary: '划过一片空地，嫩芽跟着指尖生长，花瓣慢慢展开，留下一路春天。',
    category: 'space', categoryLabel: '空间与场景', tags: ['花路', '生长', '鼠标', '自然'],
    image: publicAsset('images/home/14.webp'), imageAlt: '暖色荒地上，白色雏菊、橘色野花和粉色波斯菊沿弯曲小径生长',
  },
]

export const experimentCategories: Array<{ id: 'all' | ExperimentCategory; label: string }> = [
  { id: 'all', label: '全部' },
  { id: 'image', label: '图像与材质' },
  { id: 'particles', label: '粒子与光' },
  { id: 'space', label: '空间与场景' },
  { id: 'data', label: '数据与叙事' },
]
