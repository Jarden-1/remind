import { execFileSync } from 'node:child_process'
import { mkdirSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { createRequire } from 'node:module'

const directory = resolve('desktop/native/bin')
mkdirSync(directory, { recursive: true })
if (process.platform === 'darwin') {
  const sdk = execFileSync('xcrun', ['--show-sdk-path'], { encoding: 'utf8' }).trim()
  const architectures = process.argv.includes('--universal') ? ['arm64', 'x86_64'] : [process.arch === 'arm64' ? 'arm64' : 'x86_64']
  const headers = resolve('node_modules/node-api-headers/include')
  for (const arch of architectures) {
    execFileSync('xcrun', ['swiftc', '-O', '-emit-library', '-sdk', sdk, '-target', `${arch}-apple-macos14.0`, '-framework', 'AppKit', '-framework', 'ApplicationServices', '-Xlinker', '-install_name', '-Xlinker', '@rpath/libmeeting-probe.dylib', 'desktop/native/meetings/MeetingProbe.swift', '-o', join(directory, `libmeeting-probe-${arch}.dylib`)], { stdio: 'inherit' })
    execFileSync('xcrun', ['clang++', '-std=c++17', '-dynamiclib', '-undefined', 'dynamic_lookup', '-arch', arch, '-mmacosx-version-min=14.0', '-isysroot', sdk, '-I', headers, '-D', 'NAPI_VERSION=8', '-D', 'NODE_GYP_MODULE_NAME=meeting_probe', 'desktop/native/meetings/MeetingAddon.cc', join(directory, `libmeeting-probe-${arch}.dylib`), '-Wl,-rpath,@loader_path', '-o', join(directory, `meeting-probe-${arch}.node`)], { stdio: 'inherit' })
  }
  for (const [name, parts] of [
    ['libmeeting-probe.dylib', architectures.map(arch => join(directory, `libmeeting-probe-${arch}.dylib`))],
    ['meeting-probe.node', architectures.map(arch => join(directory, `meeting-probe-${arch}.node`))],
  ]) {
    execFileSync('xcrun', ['lipo', '-create', ...parts, '-output', join(directory, name)])
    execFileSync('codesign', ['--sign', '-', '--force', join(directory, name)])
  }
  createRequire(import.meta.url)(join(directory, 'meeting-probe.node')).selfTest()
  console.log('meeting addon self-test passed')
} else if (process.platform === 'win32') {
  const framework = join(process.env.WINDIR ?? 'C:\\Windows', 'Microsoft.NET', 'Framework64', 'v4.0.30319')
  const wpf = join(framework, 'WPF')
  const executable = join(directory, 'meeting-probe.exe')
  if (!existsSync(join(framework, 'csc.exe'))) throw new Error('.NET Framework C# compiler is required')
  execFileSync(join(framework, 'csc.exe'), ['/nologo', '/codepage:65001', '/optimize+', '/platform:x64', '/target:exe', `/out:${executable}`, `/reference:${join(wpf, 'UIAutomationClient.dll')}`, `/reference:${join(wpf, 'UIAutomationTypes.dll')}`, `/reference:${join(wpf, 'WindowsBase.dll')}`, `/reference:${join(framework, 'System.Web.Extensions.dll')}`, resolve('desktop/native/meetings/MeetingProbe.cs')], { stdio: 'inherit' })
  execFileSync(executable, ['--self-test'], { stdio: 'inherit' })
} else {
  console.log('Native meeting probe unsupported on this platform')
}
