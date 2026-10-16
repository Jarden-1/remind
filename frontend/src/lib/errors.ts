export function errorMessage(error: unknown, fallback = '操作失败，请重试') {
  if (!(error instanceof Error) || !error.message.trim()) return fallback
  return error.message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '')
}
