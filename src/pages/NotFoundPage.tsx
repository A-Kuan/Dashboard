import { Link } from 'react-router'

export function NotFoundPage() {
  return (
    <>
      <h1>404 · 页面未找到</h1>
      <Link to="/">返回首页</Link>
    </>
  )
}
