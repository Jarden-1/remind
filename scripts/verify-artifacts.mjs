import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { parse } from 'yaml'

/** Check every update payload before it can enter a Release, across both architectures. */
export async function verifyArtifacts(directory, version, platforms = ['mac', 'win']) {
  const verified = new Map()
  const nameOf = value => {
    if (typeof value !== 'string') throw new Error('Missing artifact URL')
    const name = decodeURIComponent(value)
    if (!/^[A-Za-z0-9._-]+$/.test(name) || !name.startsWith(`remind-${version}-`)) throw new Error(`Unsafe or mismatched artifact name: ${name}`)
    return name
  }
  async function verifyFile(entry) {
    const name = nameOf(entry.url), path = join(directory, name)
    if (!existsSync(path) || !statSync(path).isFile()) throw new Error(`Missing installer: ${name}`)
    if (!Number.isSafeInteger(entry.size) || entry.size <= 0 || statSync(path).size !== entry.size) throw new Error(`Installer size mismatch: ${name}`)
    let digest = verified.get(name)
    if (!digest) {
      const hash = createHash('sha512')
      for await (const chunk of createReadStream(path)) hash.update(chunk)
      digest = hash.digest('base64'); verified.set(name, digest)
    }
    if (digest !== entry.sha512) throw new Error(`Installer checksum mismatch: ${name}`)
    return name
  }
  for (const platform of platforms) {
    if (!['mac', 'win'].includes(platform)) throw new Error(`Unknown platform: ${platform}`)
    const manifestName = platform === 'mac' ? 'latest-mac.yml' : 'latest.yml'
    const manifest = parse(readFileSync(join(directory, manifestName), 'utf8'))
    if (!manifest || manifest.version !== version || !Array.isArray(manifest.files) || !manifest.files.length) throw new Error(`Invalid version or file list: ${manifestName}`)
    const listed = new Set()
    for (const entry of manifest.files) {
      if (!entry || typeof entry !== 'object') throw new Error(`Invalid file entry: ${manifestName}`)
      const name = await verifyFile(entry)
      if (listed.has(name)) throw new Error(`Duplicate installer: ${name}`)
      listed.add(name)
    }
    const required = platform === 'mac'
      ? ['mac-arm64.dmg', 'mac-arm64.zip', 'mac-x64.dmg', 'mac-x64.zip']
      : ['win-x64.exe']
    for (const suffix of required) {
      const name = `remind-${version}-${suffix}`
      if (!listed.has(name)) throw new Error(`Required installer is not in update manifest: ${name}`)
      if (!existsSync(join(directory, `${name}.blockmap`))) throw new Error(`Missing update blockmap: ${name}`)
    }
    const path = nameOf(manifest.path)
    if (!listed.has(path) || verified.get(path) !== manifest.sha512) throw new Error(`Primary update checksum mismatch: ${manifestName}`)
  }
  return [...verified.keys()]
}

const invoked = process.argv[1] && fileURLToPath(import.meta.url) === fileURLToPath(pathToFileURL(process.argv[1]))
if (invoked) {
  const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
  const files = await verifyArtifacts(resolve(process.argv[2] ?? 'release'), version, process.argv.includes('--mac') ? ['mac'] : ['mac', 'win'])
  console.log(`Verified ${files.length} installers for ${version}`)
}
