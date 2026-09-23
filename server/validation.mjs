import catalog from '../shared/catalog.json' with { type: 'json' }

export class ApiError extends Error {
  constructor(status, message) {
    super(message)
    this.status = status
  }
}
export function text(value, label, required = false, max = 200) {
  if (typeof value !== 'string' || value.length > max)
    throw new ApiError(400, `${label}格式不正确或过长`)
  const result = value.trim()
  if (required && !result) throw new ApiError(400, `请填写${label}`)
  return result
}
function choice(value, values, label) {
  if (!values.includes(value)) throw new ApiError(400, `${label}无效`)
  return value
}
function optionalChoice(value, values, label) {
  const result = text(value, label, false, 80)
  if (result && !values.includes(result)) throw new ApiError(400, `${label}无效`)
  return result
}
function compositeChoice(value, values, label) {
  const result = text(value, label, false, 80)
  if (!result) return result
  const selected = result.split('、').filter(Boolean)
  if (new Set(selected).size !== selected.length || selected.some((item) => !values.includes(item)))
    throw new ApiError(400, `${label}无效`)
  return selected.join('、')
}
function list(value, label, max = 100) {
  if (
    !Array.isArray(value) ||
    value.length > max ||
    value.some((item) => !item || typeof item !== 'object' || Array.isArray(item))
  )
    throw new ApiError(400, `${label}格式不正确或条目过多`)
  return value
}
function boolean(value) {
  if (typeof value !== 'boolean') throw new ApiError(400, '启用或核对状态无效')
  return value
}
function integer(value, label, min = 0, max = 100000000) {
  if (!Number.isSafeInteger(value) || value < min || value > max)
    throw new ApiError(400, `${label}须为 ${min} 至 ${max} 的整数`)
  return value
}
export function customerInput(body, dictionaries = {}) {
  const customerTypes = dictionaries.customerTypes ?? catalog.customerTypes
  const customerStages = dictionaries.customerStages ?? catalog.customerStages
  const value = {
    code: text(body.code, '客户编码', true, 50),
    name: text(body.name, '客户名称', true),
    customerType: choice(body.customerType, customerTypes, '客户类型'),
    projectStage: choice(body.projectStage ?? customerStages[0], customerStages, '跟进阶段'),
    contact: text(body.contact, '联系人'),
    phone: text(body.phone, '电话', false, 60),
    source: text(body.source ?? '', '客户来源', false, 120),
    owner: text(body.owner ?? '', '负责人', false, 120),
    wechat: text(body.wechat ?? '', '微信', false, 120),
    email: text(body.email ?? '', '邮箱', false, 200),
    mainBrand: text(body.mainBrand ?? '', '主营品牌', false, 120),
    tags: text(body.tags ?? '', '客户标签', false, 300),
    invoiceTitle: text(body.invoiceTitle ?? '', '发票抬头', false, 200),
    taxId: text(body.taxId ?? '', '税号', false, 100),
    settlementMethod: text(body.settlementMethod ?? '', '结算方式', false, 120),
    region: text(body.region ?? '', '所在地区', false, 200),
    address: text(body.address ?? '', '详细地址', false, 500),
    notes: text(body.notes, '备注', false, 2000),
    enabled: boolean(body.enabled),
    additionalContacts: list(body.additionalContacts ?? [], '其他联系人', 20).map((contact) => ({
      id: text(contact.id, '联系人编号', true, 36),
      name: text(contact.name, '联系人姓名', true, 120),
      phone: text(contact.phone ?? '', '联系人电话', false, 60),
      wechat: text(contact.wechat ?? '', '联系人微信', false, 120),
      email: text(contact.email ?? '', '联系人邮箱', false, 200),
    })),
  }
  for (const contact of value.additionalContacts)
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(contact.id)
    )
      throw new ApiError(400, '联系人编号无效')
  if (
    new Set(value.additionalContacts.map((contact) => contact.id)).size !==
    value.additionalContacts.length
  )
    throw new ApiError(400, '联系人编号不能重复')
  return value
}
export function quoteTemplateInput(body) {
  const value = {
    name: text(body.name, '模板名称', true, 120),
    customer: text(body.customer, '适用客户', false, 120),
    note: text(body.note, '模板备注', false, 500),
    isCommon: boolean(body.isCommon),
    parts: list(body.parts, '模板配件', 100).map((part) => {
      const id = text(part.id, '配件编号', true, 36)
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))
        throw new ApiError(400, '配件编号无效')
      return {
        id,
        vehicle: text(part.vehicle, '车型', false, 120),
        skuId: text(part.skuId, 'SKU 记录编号', false, 36),
        skuCode: text(part.skuCode, 'SKU 编码', false, 80),
        name: text(part.name, '配件名称', true, 120),
        brand: text(part.brand, '品牌', false, 120),
        priceMinor:
          part.priceMinor === null || part.priceMinor === undefined
            ? null
            : integer(part.priceMinor, '价格', 0, 10000000000),
        note: text(part.note, '配件备注', false, 500),
      }
    }),
  }
  if (new Set(value.parts.map((part) => part.id)).size !== value.parts.length)
    throw new ApiError(400, '模板配件编号不能重复')
  return value
}
export function skuInput(body, dictionaries = {}) {
  const value = {
    code: text(body.code, 'SKU 编码', true, 80),
    name: text(body.name, '配件名称', true),
    category: choice(
      body.category,
      [...catalog.categories, ...(dictionaries.categories ?? [])],
      '分类',
    ),
    brand: dictionaries.brands
      ? optionalChoice(body.brand, dictionaries.brands, '品牌')
      : text(body.brand, '品牌', false, 80),
    partNumber: text(body.partNumber, '厂家件号', false, 100),
    nature: choice(
      body.nature,
      dictionaries.natures ?? catalog.supplyTypes.map((item) => item.code),
      '供货性质',
    ),
    origin: choice(body.origin, catalog.origins, '产地属性'),
    country: text(body.country, '生产国家／地区', false, 80),
    unit: choice(body.unit, [...catalog.units, ...(dictionaries.units ?? [])], '销售单位'),
    specification: text(body.specification, '规格'),
    position: dictionaries.positions
      ? compositeChoice(body.position, dictionaries.positions, '安装位置')
      : text(body.position, '安装位置', false, 80),
    packQuantity: integer(body.packQuantity, '包装数量', 1, 100000),
    imageUrl: text(body.imageUrl, '图片地址', false, 2000),
    tradePriceMinor:
      body.tradePriceMinor == null
        ? null
        : integer(body.tradePriceMinor, '同行价分值', 0, 10000000000),
    repairPriceMinor:
      body.repairPriceMinor == null
        ? null
        : integer(body.repairPriceMinor, '修理厂价分值', 0, 10000000000),
    notes: text(body.notes, '备注', false, 2000),
    enabled: boolean(body.enabled),
    numbers: list(body.numbers, '关联件号').map((n) => ({
      type: choice(n.type, catalog.numberTypes, '件号类型'),
      code: text(n.code, '关联件号', true, 100),
    })),
    fitments: list(body.fitments, '适配车型').map((f) => {
      const yearFrom = text(f.yearFrom, '起始年款', false, 4)
      const yearTo = text(f.yearTo, '截止年款', false, 4)
      for (const year of [yearFrom, yearTo])
        if (year && (!/^\d{4}$/.test(year) || Number(year) < 1900 || Number(year) > 2100))
          throw new ApiError(400, '年款须为 1900 至 2100')
      if (yearFrom && yearTo && yearFrom > yearTo)
        throw new ApiError(400, '截止年款不能早于起始年款')
      return {
        make: dictionaries.vehicleBrands
          ? choice(f.make, dictionaries.vehicleBrands, '汽车品牌')
          : text(f.make, '汽车品牌', true, 80),
        series: text(f.series, '车系', true, 80),
        chassis: text(f.chassis, '车型代号', false, 80),
        yearFrom,
        yearTo,
        power: choice(f.power, ['', ...catalog.powerTypes], '动力类型'),
        engine: text(f.engine, '发动机', false, 100),
        notes: text(f.notes, '适配说明', false, 500),
        verified: boolean(f.verified),
      }
    }),
    stocks: list(body.stocks, '库存库位').map((s) => ({
      warehouse: text(s.warehouse, '仓库', true, 80),
      bin: text(s.bin, '库位', true, 80),
      quantity: integer(s.quantity, '库存数量'),
    })),
    prices: list(body.prices, '客户专属价', 1000).map((p) => ({
      customerId: text(p.customerId, '客户', true, 80),
      amountMinor: integer(p.amountMinor, '价格分值', 0, 10000000000),
    })),
  }
  if (
    ['进口原厂', 'imported_volkswagen', 'germany'].includes(value.nature) &&
    value.origin !== '进口'
  )
    throw new ApiError(400, '所选供货性质的产地属性须为进口')
  if (value.imageUrl && !/^https?:\/\//i.test(value.imageUrl))
    throw new ApiError(400, '图片地址须以 https:// 或 http:// 开头')
  for (const [items, key, label] of [
    [value.numbers, (n) => `${n.type}:${n.code}`, '关联件号'],
    [value.stocks, (s) => `${s.warehouse}:${s.bin}`, '仓库和库位'],
    [value.prices, (p) => p.customerId, '客户价格'],
  ])
    if (new Set(items.map(key)).size !== items.length) throw new ApiError(400, `${label}不能重复`)
  return value
}
