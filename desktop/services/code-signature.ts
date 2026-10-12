import { execFile } from 'node:child_process'
import { dirname, join } from 'node:path'

/** Squirrel.Mac installs updates only when the running app has a Developer ID signature. */
export function hasDeveloperIdSignature(output: string) {
  return /Authority=Developer ID Application:/.test(output)
}

export function macAppBundlePath(execPath: string) {
  return join(dirname(execPath), '..', '..')
}

export function macNativeUpdateSupported(execPath = process.execPath): Promise<boolean> {
  if (process.platform !== 'darwin') return Promise.resolve(false)
  return new Promise(resolve => {
    execFile('/usr/bin/codesign', ['-dv', '--verbose=4', macAppBundlePath(execPath)], { timeout: 5000 }, (error, stdout, stderr) => {
      resolve(!error && hasDeveloperIdSignature(`${stdout}\n${stderr}`))
    })
  })
}
