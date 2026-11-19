export type HeatSummer = { year: number; days: number[]; meanMax: number; hotDays: number; peak: number }
export type HeatCity = { name: string; country: string; latitude: number; longitude: number; timezone: string; summers: HeatSummer[] }

type GeocodingResult = { name: string; country?: string; latitude: number; longitude: number; timezone?: string; population?: number }
type ArchiveResponse = { daily?: { time?: string[]; temperature_2m_max?: Array<number | null> } }

const FIRST_YEAR = 1986
const LAST_YEAR = 2025

/** 按当地季节取连续 40 个完整夏季；南半球的年份按夏季结束的年份命名。 */
export function summersFromDaily(city: Omit<HeatCity, 'summers'>, daily: ArchiveResponse['daily']): HeatCity {
  if (!daily?.time || !daily.temperature_2m_max || daily.time.length !== daily.temperature_2m_max.length) throw new Error('历史气温数据不完整。')
  const groups = new Map<number, number[]>()
  for (let i = 0; i < daily.time.length; i++) {
    const date = daily.time[i]
    const value = daily.temperature_2m_max[i]
    if (!date || typeof value !== 'number' || !Number.isFinite(value)) continue
    const year = Number(date.slice(0, 4))
    const month = Number(date.slice(5, 7))
    const summerYear = city.latitude >= 0 ? year : month === 12 ? year + 1 : year
    const inSummer = city.latitude >= 0 ? month >= 6 && month <= 8 : month === 12 || month <= 2
    if (!inSummer || summerYear < FIRST_YEAR || summerYear > LAST_YEAR) continue
    const days = groups.get(summerYear) ?? []
    days.push(value)
    groups.set(summerYear, days)
  }
  const summers: HeatSummer[] = []
  for (let year = FIRST_YEAR; year <= LAST_YEAR; year++) {
    const days = groups.get(year)
    if (!days || days.length < 88) throw new Error(`${year} 年夏季数据不足，无法绘制。`)
    summers.push({ year, days, meanMax: days.reduce((sum, value) => sum + value, 0) / days.length, hotDays: days.filter(value => value >= 35).length, peak: Math.max(...days) })
  }
  return { ...city, summers }
}

/** 查询城市时只取位置匹配结果，不把用户输入写入 HTML 或外部脚本。 */
export async function findCity(query: string, signal: AbortSignal): Promise<Omit<HeatCity, 'summers'>> {
  const url = new URL('https://geocoding-api.open-meteo.com/v1/search')
  url.searchParams.set('name', query)
  url.searchParams.set('count', '10')
  url.searchParams.set('language', 'zh')
  url.searchParams.set('format', 'json')
  const response = await fetch(url, { signal })
  if (!response.ok) throw new Error('城市查询暂时不可用，请稍后重试。')
  const data = await response.json() as { results?: GeocodingResult[] }
  const candidates = (data.results ?? []).filter(item => Number.isFinite(item.latitude) && Number.isFinite(item.longitude))
  const city = candidates.sort((a, b) => (b.population ?? 0) - (a.population ?? 0))[0]
  if (!city) throw new Error('没有找到这座城市，请试试“城市名 + 国家”。')
  return { name: city.name, country: city.country ?? '', latitude: city.latitude, longitude: city.longitude, timezone: city.timezone ?? 'auto' }
}

export async function loadHeatCity(city: Omit<HeatCity, 'summers'>, signal: AbortSignal): Promise<HeatCity> {
  const url = new URL('https://archive-api.open-meteo.com/v1/archive')
  url.searchParams.set('latitude', String(city.latitude))
  url.searchParams.set('longitude', String(city.longitude))
  url.searchParams.set('start_date', '1985-12-01')
  url.searchParams.set('end_date', '2025-08-31')
  url.searchParams.set('daily', 'temperature_2m_max')
  url.searchParams.set('temperature_unit', 'celsius')
  url.searchParams.set('timezone', city.timezone)
  url.searchParams.set('models', 'era5')
  const response = await fetch(url, { signal })
  if (!response.ok) throw new Error('历史气温加载失败，请稍后重试。')
  const data = await response.json() as ArchiveResponse
  return summersFromDaily(city, data.daily)
}
