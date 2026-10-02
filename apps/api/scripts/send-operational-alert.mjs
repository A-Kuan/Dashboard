import { deliverOperationalAlert } from '../src/alert-delivery.mjs'

const source = String(process.argv[2] || 'unknown').slice(0, 160)
const result = await deliverOperationalAlert({ source })
process.stdout.write(`${JSON.stringify(result)}\n`)
