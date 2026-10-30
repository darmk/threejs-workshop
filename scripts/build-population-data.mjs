import { createReadStream, writeFileSync } from 'node:fs'
import { createGunzip } from 'node:zlib'
import { createInterface } from 'node:readline'
import { join } from 'node:path'

// 先下载 public/data/README.md 所列的两份 WPP 2024 官方 CSV 压缩包。
// 在仓库根目录运行：node scripts/build-population-data.mjs <source-directory>；输出会覆盖项目人口 JSON。
const sourceDirectory = process.argv[2]
if (!sourceDirectory) throw new Error('Provide the directory containing the two WPP2024 .csv.gz files.')

const firstYear = 1950
const lastYear = 2026
const lastAge = 100
const selected = [
  { id: 'world', locId: 900, label: '世界' },
  { id: 'china', locId: 156, label: '中国' },
  { id: 'india', locId: 356, label: '印度' },
  { id: 'japan', locId: 392, label: '日本' },
  { id: 'usa', locId: 840, label: '美国' },
]

const byLocId = new Map(selected.map(item => [item.locId, item.id]))
const locations = Object.fromEntries(selected.map(item => [item.id, {
  label: item.label,
  populationThousands: Array.from({ length: lastYear - firstYear + 1 }, () => Array(lastAge + 1).fill(null)),
}]))

for (const filename of [
  'WPP2024_PopulationBySingleAgeSex_Medium_1950-2023.csv.gz',
  'WPP2024_PopulationBySingleAgeSex_Medium_2024-2100.csv.gz',
]) {
  const stream = createReadStream(join(sourceDirectory, filename)).pipe(createGunzip())
  const lines = createInterface({ input: stream, crlfDelay: Infinity })
  for await (const line of lines) {
    if (!line || line.startsWith('SortOrder,')) continue
    // 固定列索引依赖当前官方 CSV 布局，且这里按逗号直接切分，不是通用的带引号 CSV 解析器。
    const columns = line.split(',')
    const id = byLocId.get(Number(columns[1]))
    if (!id) continue
    const year = Number(columns[12])
    if (year < firstYear || year > lastYear) continue
    const age = Number(columns[15])
    if (!Number.isInteger(age) || age < 0 || age > lastAge) continue
    const value = Number(columns[19])
    if (!Number.isFinite(value)) throw new Error(`Invalid population in ${filename}: ${line}`)
    locations[id].populationThousands[year - firstYear][age] = Math.round(value)
  }
}

// 输出前逐项检查完整性，防止缺失年份或年龄被静默当作零人口；100 岁档为开放年龄组。
for (const { id } of selected) {
  const rows = locations[id].populationThousands
  for (let y = 0; y < rows.length; y++) {
    for (let age = 0; age <= lastAge; age++) {
      if (rows[y][age] === null) throw new Error(`Missing ${id} ${firstYear + y} age ${age}`)
    }
  }
}

const result = {
  source: 'UN DESA Population Division, World Population Prospects 2024',
  sourceUrl: 'https://population.un.org/wpp/',
  firstYear,
  lastYear,
  lastEstimateYear: 2023,
  age100IsOpenEnded: true,
  unit: 'thousands of people, rounded to nearest thousand',
  locations,
}
writeFileSync('public/data/population-cohorts.json', JSON.stringify(result))
console.log(`Wrote public/data/population-cohorts.json (${selected.length} places, ${lastYear - firstYear + 1} years).`)
