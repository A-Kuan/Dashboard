function text(value) {
  return value == null ? '' : String(value).trim()
}

function badRequest(message, statusCode = 400) {
  const error = new Error(message)
  error.statusCode = statusCode
  error.errorCode = 'INVALID_VEHICLE_INPUT'
  throw error
}

export function normalizeVehicleInput(input = {}) {
  const vehicle = {
    vehicleCode: text(input.vehicleCode),
    brand: text(input.brand),
    series: text(input.series),
    platform: text(input.platform),
    displayName: text(input.displayName),
    displacement: text(input.displacement),
    engineCode: text(input.engineCode),
    transmissionCode: text(input.transmissionCode),
    yearStart: input.yearStart === '' || input.yearStart == null ? null : Number(input.yearStart),
    yearEnd: input.yearEnd === '' || input.yearEnd == null ? null : Number(input.yearEnd),
    market: text(input.market),
    bodyType: text(input.bodyType),
    sampleVin: text(input.sampleVin).toUpperCase(),
    productionDate: text(input.productionDate) || null,
    dataSource: text(input.dataSource),
    verificationStatus: text(input.verificationStatus) || '待验证',
    imageUrl: text(input.imageUrl),
    sourceEvidence: input.sourceEvidence || null,
    lifecycleStatus: text(input.lifecycleStatus) || '草稿',
    version: Number(input.version || 0),
    requirements: Array.isArray(input.requirements) ? input.requirements.map((row, index) => ({
      id: text(row.id), category: text(row.category), itemCode: text(row.itemCode), itemName: text(row.itemName),
      position: text(row.position), side: text(row.side), quantity: Number(row.quantity || 1),
      partNumber: text(row.partNumber).toUpperCase(), partNumberType: text(row.partNumberType),
      fitmentCondition: text(row.fitmentCondition), source: text(row.source),
      verificationStatus: text(row.verificationStatus) || '待验证', sortOrder: index,
      candidates: Array.isArray(row.candidates) ? row.candidates.map((candidate, candidateIndex) => ({
        id: text(candidate.id), skuId: text(candidate.skuId) || null,
        partNumber: text(candidate.partNumber).toUpperCase(), role: text(candidate.role) || '备选',
        source: text(candidate.source), verificationStatus: text(candidate.verificationStatus) || '待验证',
        sortOrder: candidateIndex,
      })) : [],
    })) : [],
    packages: Array.isArray(input.packages) ? input.packages.map((row, index) => ({
      id: text(row.id), packageCode: text(row.packageCode), name: text(row.name),
      intervalText: text(row.intervalText), description: text(row.description),
      lifecycleStatus: text(row.lifecycleStatus) || '启用', sortOrder: index,
      items: Array.isArray(row.items) ? row.items.map((item, itemIndex) => ({
        requirementId: text(item.requirementId), quantity: Number(item.quantity || 1), sortOrder: itemIndex,
      })) : [],
    })) : [],
  }
  for (const [value, label] of [[vehicle.vehicleCode, '车型版本编码'], [vehicle.brand, '品牌'], [vehicle.series, '车系'], [vehicle.platform, '平台'], [vehicle.displayName, '车型名称']]) {
    if (!value) badRequest(`${label}不能为空`)
  }
  if (vehicle.sampleVin && !/^[A-HJ-NPR-Z0-9]{17}$/.test(vehicle.sampleVin)) badRequest('VIN 必须为 17 位有效字符')
  if (vehicle.yearStart && vehicle.yearEnd && vehicle.yearStart > vehicle.yearEnd) badRequest('起始年款不能晚于结束年款')
  vehicle.requirements.forEach((row, index) => {
    if (!row.itemName) badRequest(`第 ${index + 1} 条配件项目名称不能为空`)
    if (!Number.isFinite(row.quantity) || row.quantity <= 0) badRequest(`第 ${index + 1} 条配件用量必须大于 0`)
  })
  vehicle.packages.forEach((row, index) => {
    if (!row.packageCode || !row.name) badRequest(`第 ${index + 1} 个套餐需要编码和名称`)
  })
  return vehicle
}

export function requireVehicleVersion(input = {}) {
  if (!Number.isInteger(Number(input.version)) || Number(input.version) < 1) badRequest('缺少有效的车型数据版本')
}
