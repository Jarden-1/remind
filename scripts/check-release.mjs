import { readFileSync } from 'node:fs'

const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
if (process.env.GITHUB_REF_NAME !== `v${version}`) throw new Error('Release tag must match package.json version')
const required = ['CSC_LINK', 'CSC_KEY_PASSWORD']
if (process.env.RELEASE_PLATFORM === 'mac') required.push('APPLE_ID', 'APPLE_APP_SPECIFIC_PASSWORD', 'APPLE_TEAM_ID')
const missing = required.filter(key => !process.env[key])
if (missing.length) throw new Error(`Missing release credentials: ${missing.join(', ')}`)
