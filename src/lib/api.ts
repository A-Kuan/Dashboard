export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`/api${path}`, {
    ...options,
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', 'X-Dashboard-Request': '1', ...options.headers },
  })
  const body = await response.json().catch(() => ({ error: '服务响应异常，请检查后端是否运行' }))
  if (!response.ok) {
    if (response.status === 401 && !path.startsWith('/auth/'))
      window.dispatchEvent(new Event('session-expired'))
    throw new Error(body.error ?? '请求失败')
  }
  return body as T
}
export const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : '操作失败，请重试'
