import catalog from '../../../shared/catalog.json'
import type { SelectOption } from '../../components/business/Select'

export type SupplyTypeItem = {
  code: string
  label: string
  parentCode: string | null
}

export const fallbackSupplyTypes: SupplyTypeItem[] = catalog.supplyTypes

export function supplyTypeOptions(items: SupplyTypeItem[] | null): SelectOption[] {
  const values = items ?? fallbackSupplyTypes
  const byCode = new Map(values.map((item) => [item.code, item]))
  const parents = values.filter((item) => !item.parentCode)
  const result: SelectOption[] = []
  for (const parent of parents) {
    result.push({ value: parent.code, label: parent.label })
    for (const child of values.filter((item) => item.parentCode === parent.code))
      result.push({ value: child.code, label: `${parent.label} · ${child.label}` })
  }
  for (const item of values)
    if (!byCode.has(item.parentCode ?? '') && item.parentCode)
      result.push({ value: item.code, label: item.label })
  return result
}

export function supplyTypeLabel(value: string, items: SupplyTypeItem[] | null) {
  if (value === '待确认') return '待核实（旧值）'
  return supplyTypeOptions(items).find((item) => item.value === value)?.label ?? value
}
