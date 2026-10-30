/** 将 public 目录内的相对路径拼接到 Vite 部署基础路径；参数不包含 public/ 前缀。 */
export function publicAsset(path: string): string {
  return `${import.meta.env.BASE_URL}${path.replace(/^\/+/, '')}`
}
