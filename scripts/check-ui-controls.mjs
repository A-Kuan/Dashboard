import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

function scan(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) scan(path)
    else if (entry.name.endsWith('.tsx')) {
      const content = readFileSync(path, 'utf8')
      if (/<select\b|<option\b|type=["']date["']/.test(content))
        throw new Error(`${path}: 业务界面应使用项目统一控件，不渲染原生下拉或日期弹窗`)
    }
  }
}

scan('src')
console.log('UI 控件检查通过')
