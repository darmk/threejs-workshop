import { writeFileSync } from 'node:fs'

// 重建默认城市示例：node scripts/build-heat-wall-data.mjs
const city = { name: '北京', country: '中国', latitude: 39.9075, longitude: 116.39723, timezone: 'Asia/Shanghai' }
const url = new URL('https://archive-api.open-meteo.com/v1/archive')
for (const [key, value] of Object.entries({ latitude: city.latitude, longitude: city.longitude, start_date: '1986-06-01', end_date: '2025-08-31', daily: 'temperature_2m_max', temperature_unit: 'celsius', timezone: city.timezone, models: 'era5' })) url.searchParams.set(key, String(value))
const response = await fetch(url)
if (!response.ok) throw new Error(`Open-Meteo HTTP ${response.status}`)
const { daily } = await response.json()
if (!daily?.time || !daily.temperature_2m_max || daily.time.length !== daily.temperature_2m_max.length) throw new Error('Invalid daily data')
const summers = []
for (let year = 1986; year <= 2025; year++) {
  const days = daily.time.flatMap((date, index) => date.startsWith(`${year}-06-`) || date.startsWith(`${year}-07-`) || date.startsWith(`${year}-08-`) ? [daily.temperature_2m_max[index]] : [])
  if (days.length !== 92 || days.some(value => !Number.isFinite(value))) throw new Error(`Missing summer days in ${year}`)
  summers.push({ year, days, meanMax: days.reduce((sum, value) => sum + value, 0) / 92, hotDays: days.filter(value => value >= 35).length, peak: Math.max(...days) })
}
writeFileSync('public/data/heat-wall-beijing.json', JSON.stringify({ ...city, summers }))
console.log('Wrote public/data/heat-wall-beijing.json: Beijing summers 1986–2025')
