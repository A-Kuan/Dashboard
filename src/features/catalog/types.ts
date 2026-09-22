export type User = {
  id: string
  username: string
  role: 'admin' | 'editor' | 'viewer'
  enabled: boolean
}
export type Customer = {
  id: string
  code: string
  name: string
  customerType: '同行' | '修理厂' | '待分类'
  projectStage: '待跟进' | '询价中' | '已报价' | '合作中'
  contact: string
  phone: string
  notes: string
  enabled: boolean
  version: number
  updatedAt: string
}
export type Fitment = {
  make: string
  series: string
  chassis: string
  yearFrom: string
  yearTo: string
  power: string
  engine: string
  notes: string
  verified: boolean
}
export type Sku = {
  id: string
  code: string
  name: string
  category: string
  brand: string
  sourceCategoryPath?: string
  sourceManufacturer?: string
  partNumber: string
  nature: string
  origin: string
  country: string
  unit: string
  specification: string
  position: string
  packQuantity: number
  imageUrl: string
  tradePriceMinor: number | null
  repairPriceMinor: number | null
  notes: string
  enabled: boolean
  version: number
  updatedAt: string
  numbers: { type: string; code: string }[]
  fitments: Fitment[]
  stocks: { warehouse: string; bin: string; quantity: number }[]
  prices: { customerId: string; amountMinor: number; updatedAt?: string }[]
  supplierQuotes: {
    id: string
    supplier: string
    quotedOn: string
    amountMinor: number
    notes: string
    createdAt: string
  }[]
}
