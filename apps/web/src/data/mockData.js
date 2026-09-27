import { assetPath } from '../utils/assetPath'

export const skuRows = [
  { id: '958-807-421', image: assetPath('assets/parts/trim-ring.png'), sku: '958-807-421', oe: '958 807 421', name: '前保险杠总成', category: '车身及内饰', brand: 'Porsche', vehicle: 'Cayenne (9YA)', stock: 8, purchasePrice: '3,200.00', salePrice: '4,880.00', source: 'Porsche EPC', status: '在售' },
  { id: '5111-8087-375', image: assetPath('assets/parts/brake-disc.png'), sku: '5111-8087-375', oe: '5111 8087 375', name: '前制动盘', category: '制动系统', brand: 'BMW', vehicle: '5系 (G30)', stock: 12, purchasePrice: '680.00', salePrice: '1,280.00', source: 'BMW EPC', status: '在售' },
  { id: 'A-247-880-12-04', image: assetPath('assets/parts/grille.png'), sku: 'A-247-880-12-04', oe: 'A 247 880 12 04', name: '前保险杠下格栅', category: '车身及内饰', brand: 'Mercedes', vehicle: 'C级 (W205)', stock: 6, purchasePrice: '950.00', salePrice: '1,680.00', source: 'Mercedes EPC', status: '在售' },
  { id: '95B-867-288-OM8', image: assetPath('assets/parts/cargo-trim.png'), sku: '95B-867-288-OM8', oe: '95B 867 288 OM8', name: '行李厢内饰板（黑色）', category: '车身及内饰', brand: 'Porsche', vehicle: 'Cayenne (9YA)', stock: 1, purchasePrice: '420.00', salePrice: '880.00', source: 'Porsche EPC', status: '在售' },
  { id: '95B-631-681-02', image: assetPath('assets/parts/tail-light.png'), sku: '95B-631-681-02', oe: '958 631 681 02', name: '尾灯总成 右', category: '车身及内饰', brand: 'Porsche', vehicle: 'Cayenne (9YA)', stock: 3, purchasePrice: '1,800.00', salePrice: '2,880.00', source: 'Porsche EPC', status: '在售' },
  { id: 'A-205-320-01-13', image: assetPath('assets/parts/compressor.png'), sku: 'A-205-320-01-13', oe: 'A 205 320 01 13', name: '前空气减震器', category: '底盘系统', brand: 'Mercedes', vehicle: 'C级 (W205)', stock: 5, purchasePrice: '3,600.00', salePrice: '5,980.00', source: 'Mercedes EPC', status: '在售' },
  { id: '3112-6794-991', image: assetPath('assets/parts/steering.png'), sku: '3112-6794-991', oe: '3112 6794 991', name: '转向机总成', category: '转向系统', brand: 'BMW', vehicle: '5系 (G30)', stock: 2, purchasePrice: '4,200.00', salePrice: '6,800.00', source: 'BMW EPC', status: '低库存' },
  { id: '958-121-251', image: assetPath('assets/parts/water-pump.png'), sku: '958-121-251', oe: '958 121 251', name: '水泵总成', category: '发动机系统', brand: 'Porsche', vehicle: 'Macan (95B)', stock: 15, purchasePrice: '760.00', salePrice: '1,280.00', source: 'Porsche OEM', status: '在售' },
]

export const fitmentRows = [
  ['Cayenne (9YA)', '2018–2023', '全部', 'SUV', '—'],
  ['Cayenne Coupe (9YB)', '2019–2023', '全部', 'Coupe', '—'],
  ['Cayenne E-Hybrid', '2019–2023', '3.0T Hybrid', 'SUV', '—'],
  ['Cayenne Turbo', '2018–2023', '4.0T', 'SUV', '—'],
]

export const inventoryRows = [
  ['华东仓', 8, 1, 6],
  ['华南仓', 3, 1, 12],
  ['华北仓', 0, 0, 0],
]
