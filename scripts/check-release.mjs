import { readFileSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'

const signingKeys = {
  mac: ['CSC_LINK', 'CSC_KEY_PASSWORD', 'APPLE_ID', 'APPLE_APP_SPECIFIC_PASSWORD', 'APPLE_TEAM_ID'],
  win: ['CSC_LINK', 'CSC_KEY_PASSWORD'],
}

/** Tag must match package.json. Signing secrets are optional; a partial set fails closed. */
export function assertReleaseReady({ refName, version, platform, env }) {
  if (refName !== `v${version}`) throw new Error(`Release tag must match package.json version v${version}`)
  const required = signingKeys[platform]
  if (!required) throw new Error(`Unknown release platform: ${platform}`)
  const present = required.filter(key => env[key])
  if (present.length === 0) return { signed: false }
  const missing = required.filter(key => !env[key])
  if (missing.length) throw new Error(`Incomplete release credentials: ${missing.join(', ')}`)
  return { signed: true }
}

const invoked = process.argv[1] && fileURLToPath(import.meta.url) === fileURLToPath(pathToFileURL(process.argv[1]))
if (invoked) {
  const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
  const result = assertReleaseReady({
    refName: process.env.GITHUB_REF_NAME,
    version,
    platform: process.env.RELEASE_PLATFORM,
    env: process.env,
  })
  console.log(result.signed ? 'Release credentials present; installers will be signed.' : 'No signing credentials; installers will be unsigned.')
}
