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
  customerType: string
  projectStage: string
  contact: string
  phone: string
  source: string
  owner: string
  wechat: string
  email: string
  mainBrand: string
  tags: string
  invoiceTitle: string
  taxId: string
  settlementMethod: string
  region: string
  address: string
  additionalContacts: {
    id: string
    name: string
    phone: string
    wechat: string
    email: string
  }[]
  notes: string
  enabled: boolean
  version: number
  updatedAt: string
}
export type GarageOwner = {
  id: string
  customerId: string
  name: string
  phone: string
  wechat: string
  notes: string
  createdAt: string
  updatedAt: string
}
export type GarageVehicle = {
  id: string
  customerId: string
  ownerId: string
  brand: string
  series: string
  generationCode: string
  modelYear: string
  engine: string
  vin: string
  plateNumber: string
  notes: string
  enabled: boolean
  version: number
  updatedAt: string
}
export type GarageInquiryItem = {
  id: string
  skuId: string
  oeNumber: string
  name: string
  quantity: number
  priceMinor: number | null
  notes: string
}
export type GarageInquiry = {
  id: string
  customerId: string
  ownerId: string
  vehicleId: string
  code: string
  status: '待识别' | '待核价' | '待报价' | '已报价' | '已关闭'
  source: string
  notes: string
  quotedTotalMinor: number | null
  quotedAt: string | null
  version: number
  createdAt: string
  updatedAt: string
  items: GarageInquiryItem[]
}
export type CustomerGarage = {
  customer: Customer
  owners: GarageOwner[]
  vehicles: GarageVehicle[]
  inquiries: GarageInquiry[]
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
