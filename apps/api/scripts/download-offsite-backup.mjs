import { downloadLatestOffsiteBackup } from '../src/offsite-recovery.mjs'

const result = await downloadLatestOffsiteBackup({ targetDirectory: process.argv[2] })
process.stdout.write(`${JSON.stringify(result)}\n`)
